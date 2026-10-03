import test from 'node:test';
import assert from 'node:assert/strict';
import {fork,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {benchmarkPreset,benchmarkJobs,benchmarkStopStatus} from './target-benchmark-support.mjs';
import {renderProgress} from './target-progress.mjs';

test('500k preset fixes two target-enabled games, distinct seeds, no rest and a separate cap endpoint',()=>{
  const preset=benchmarkPreset('500k');
  assert.equal(preset.parallel,2);assert.equal(preset.maxSpeed,true);assert.equal(preset.stopAtCap,true);
  assert.deepEqual(benchmarkJobs({seed:509,pairs:4,preset:'500k'}),[
    {gameId:'1-target',mode:'target',seed:509},{gameId:'2-target',mode:'target',seed:510}
  ]);
  assert.equal(benchmarkJobs({seed:509,pairs:3}).length,6);
  assert.equal(benchmarkStopStatus(500000,false,true),'cap-reached');
  assert.equal(benchmarkStopStatus(500000,false,false),null);
  assert.equal(benchmarkStopStatus(499999,true,true),'dead');
  assert.equal(benchmarkStopStatus(499999,false,true),null);
  assert.throws(()=>benchmarkPreset('unknown'));
  const output=renderProgress({stopAtCap:true,maxSpeed:true,jobs:2,limit:2,games:[{gameId:'1-target',mode:'target',score:250000,status:'running',hits:[{score:200000}]}]});
  assert.match(output,/50\.0%/);assert.match(output,/최종 목표 500,000점 · 250,000점 남음/);assert.match(output,/200,000/);
  assert.doesNotMatch(output,/사망까지 계속/);
});

test('one-click entry describes its preset without opening a browser, server or setup menu',()=>{
  const result=spawnSync(process.execPath,['tests/500k-runner.mjs','--help'],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:5000,windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/목표 ON 2게임/);assert.match(result.stdout,/50만점 또는 사망/);
});

// A lifecycle fixture, not a scored performance run. Seed checkpoints after
// one decision, then construct cap/death endpoints to test resume and stopping.
test('two-worker preset saves, resumes and distinguishes reaching the cap from death',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'moa-500k-'));
  const script=fileURLToPath(new URL('./target-benchmark.mjs',import.meta.url));
  async function run(args,{stopAfterFirst=false}={}){
    const seen=new Set();let output='',sent=false;
    const child=fork(script,args,{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    child.on('message',message=>{
      if(message.type!=='progress'||message.calls<1)return;seen.add(message.gameId);
      if(stopAfterFirst&&!sent&&seen.size===2){sent=true;child.send({type:'stop'});}
    });
    const stop=setTimeout(()=>{if(child.connected)child.send({type:'stop'});},20000);
    const failSafe=setTimeout(()=>child.kill(),30000);
    let code;
    try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}
    finally{clearTimeout(stop);clearTimeout(failSafe);}
    assert.equal(code,0,output);if(stopAfterFirst)assert.equal(sent,true,output);
    return output;
  }
  try{
    const input=path.join(directory,'input.json');await writeFile(input,JSON.stringify({catalogue:[{id:'dot',name:'.',cells:[[0,0]],normal:10,reroll:1}]}));
    await run(['--preset','500k','--input',input,'--output-dir',directory],{stopAfterFirst:true});
    const files=await readdir(directory),snapshot=files.find(name=>name.endsWith('-input.json'));
    const runId=snapshot.slice('targets-'.length,-'-input.json'.length),base=path.join(directory,`targets-${runId}`);
    const first=JSON.parse(await readFile(`${base}-1-target-checkpoint.json`,'utf8'));
    const second=JSON.parse(await readFile(`${base}-2-target-checkpoint.json`,'utf8'));
    for(const saved of [first,second]){
      assert.equal(saved.status,'stopped-by-user');assert.equal(saved.mode,'target');assert.ok(saved.ledger.calls>=1);
    }
    const calls=first.ledger.calls;
    first.game.score=499999;first.game.rawScore=499999;
    first.game.lineScore=499999-first.game.placementScore-first.game.acquisitionScore;
    first.ledger.hits=[{score:100000,canStopBelowSkillCap:true}];
    second.game.board=Array(16).fill(341);second.game.skills={dot:0,reroll:0};
    second.game.pieces=[{id:'blocked',cells:[[0,0],[1,0],[0,1],[1,1]],used:false}];
    await writeFile(`${base}-1-target-checkpoint.json`,JSON.stringify(first));
    await writeFile(`${base}-2-target-checkpoint.json`,JSON.stringify(second));
    await run(['--run',runId,'--output-dir',directory]);
    const cap=JSON.parse(await readFile(`${base}-1-target.json`,'utf8')),dead=JSON.parse(await readFile(`${base}-2-target.json`,'utf8'));
    assert.equal(cap.status,'cap-reached');assert.equal(cap.score,500000);assert.equal(cap.deathVerified,false);
    assert.equal(cap.timing.calls,calls+1);assert.ok(cap.capReached);assert.equal(cap.targetEnabled,true);
    const capCheckpoint=JSON.parse(await readFile(`${base}-1-target-checkpoint.json`,'utf8'));
    assert.equal(capCheckpoint.game.placements,first.game.placements+1,'stop on the first action reaching the cap');
    assert.equal(cap.resources.maxParallel,2);assert.equal(cap.resources.maxSpeed,true);assert.equal(cap.preset,'500k');
    assert.equal(cap.hits[0].score,100000,'prior exact arrivals survive reaching the cap');
    assert.equal(dead.status,'dead');assert.equal(dead.deathVerified,true);assert.equal(dead.timing.calls,second.ledger.calls);
    const report=await readFile(`${base}-comparison.md`,'utf8');assert.match(report,/cap-reached/);assert.doesNotMatch(report,/[가-힣]/);
  }finally{
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});
  }
});
