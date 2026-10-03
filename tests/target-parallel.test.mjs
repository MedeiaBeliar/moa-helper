import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Isolated harness check: request a graceful stop through IPC after every game
// reports one decision. This is explicitly not a scored game or death test.
test('parallel runner checkpoints every game, stops honestly, and resumes each seed separately',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'moa-parallel-'));
  const script=fileURLToPath(new URL('./target-benchmark.mjs',import.meta.url));
  async function run(args,minimums){
    const seen=new Map();let output='',sent=false;
    const child=fork(script,args,{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
    child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{output+=chunk;});
    const timer=setTimeout(()=>{child.send({type:'stop'});},25000);
    const failSafe=setTimeout(()=>child.kill(),35000);
    child.on('message',message=>{
      if(message.type!=='progress')return;seen.set(message.gameId,message.calls);
      if(!sent&&minimums.every(([id,min])=>(seen.get(id)||0)>=min)){sent=true;child.send({type:'stop'});}
    });
    let code;
    try{code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});}
    finally{clearTimeout(timer);clearTimeout(failSafe);}
    assert.equal(code,0,output);assert.equal(sent,true,'every game must make progress before the controlled stop');
    assert.match(output,/목표 점수 병렬 테스트/);assert.match(output,/점 남음/);assert.match(output,/사용자 중지/);
  }
  try{
    const input=path.join(directory,'input.json');
    await writeFile(input,JSON.stringify({catalogue:Array.from({length:21},(_,i)=>({id:`dot-${i}`,name:String(i),cells:[[0,0]],normal:1,reroll:1}))}));
    const ids=['1-normal','1-target','2-normal','2-target'];
    await run(['--input',input,'--output-dir',directory,'--pairs','2','--parallel','2'],ids.map(id=>[id,1]));
    const files=await readdir(directory),snapshot=files.find(name=>name.endsWith('-input.json'));
    assert.ok(snapshot);const runId=snapshot.slice('targets-'.length,-'-input.json'.length),base=path.join(directory,`targets-${runId}`);
    const before=[];
    for(const id of ids){
      const saved=JSON.parse(await readFile(`${base}-${id}.json`,'utf8'));
      assert.equal(saved.status,'stopped-by-user');assert.equal(saved.deathVerified,false);assert.equal(saved.gameId,id);
      assert.equal(saved.seed,id.startsWith('1-')?509:510);assert.ok(saved.timing.calls>=1);before.push([id,saved.timing.calls]);
    }
    await run(['--run',runId,'--output-dir',directory,'--parallel','2'],before.map(([id,calls])=>[id,calls+1]));
    for(const [id,calls] of before){
      const saved=JSON.parse(await readFile(`${base}-${id}.json`,'utf8'));
      assert.ok(saved.timing.calls>calls);assert.equal(saved.deathVerified,false);assert.equal(saved.status,'stopped-by-user');
    }
    assert.match(await readFile(`${base}-comparison.md`,'utf8'),/interrupted/);
  }finally{
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));await rm(directory,{recursive:true,force:true});
  }
});
