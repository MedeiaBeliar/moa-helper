import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {catalogueFromState,createDrawModel,validateResume,predictionAtStep,recordTargetArrival} from './target-benchmark-support.mjs';

test('benchmark copies all 21 blocks and observed stage counts without changing saved state',()=>{
  const state={blocks:Array.from({length:21},(_,i)=>({id:`b${i}`,name:String(i),cells:[[0,0]]})),statistics:{entries:[{blockId:'b0',normal:20,reroll:3,stages:{1:{normal:8,reroll:2}}}]}};
  const before=structuredClone(state),catalogue=catalogueFromState(state);
  assert.equal(catalogue.length,21);assert.equal(catalogue[0].normal,20);assert.equal(catalogue[1].normal,0);
  assert.deepEqual(catalogue[0].stages,{1:{normal:8,reroll:2}});
  catalogue[0].cells[0][0]=9;assert.deepEqual(state,before);
});

test('benchmark accepts a deduplicated catalogue and rejects empty or oversized libraries',()=>{
  const state={blocks:Array.from({length:19},(_,i)=>({id:`unique-${i}`,name:String(i),cells:[[0,0]]})),statistics:{entries:[]}};
  assert.equal(catalogueFromState(state).length,19);
  assert.throws(()=>catalogueFromState({...state,blocks:[]}));
  assert.throws(()=>catalogueFromState({...state,blocks:Array(501).fill(state.blocks[0])}));
});

test('stage draws use observations where available and aggregate fallback otherwise',()=>{
  const model=createDrawModel([{normal:9,reroll:1,stages:{1:{normal:10,reroll:4}}},{normal:1,reroll:0,stages:{}}]);
  assert.deepEqual(model.weights(2,'normal'),[10,2]);
  assert.deepEqual(model.weights(1,'normal'),[35,5]);
  assert.equal(model.description[1].normal.stageSamples,10);
  assert.equal(model.description[2].normal.source,'overall');
  assert.ok(model.weights(1,'reroll')[0]>model.weights(2,'reroll')[0]);
});

test('resume rejects mismatched inputs or code before accepting a checkpoint',()=>{
  const expected={mode:'target',seed:509,hashes:{solver:'one',input:'two'}};
  const saved={version:1,...expected,game:{},ledger:{},rng:{normal:1,reroll:2,icon:3,type:4}};
  assert.doesNotThrow(()=>validateResume(saved,expected));
  assert.throws(()=>validateResume(saved,{...expected,hashes:{solver:'changed',input:'two'}}));
  assert.throws(()=>validateResume({...saved,mode:'normal'},expected));
  assert.throws(()=>validateResume({...saved,rng:{...saved.rng,icon:-1}},expected));
  assert.equal(predictionAtStep({target:{hit:111111,hitStep:2}},0),null);
  assert.equal(predictionAtStep({target:{hit:111111,hitStep:2}},1),111111);
});

test('standalone CMD runner exits and benchmark help does not start a game or server',()=>{
  const run=(file,args=[],input)=>spawnSync(process.execPath,[file,...args],{cwd:new URL('../',import.meta.url),encoding:'utf8',input,timeout:5000,windowsHide:true});
  const help=run('tests/target-benchmark.mjs',['--help']);assert.equal(help.status,0,help.stderr);assert.match(help.stdout,/Ctrl\+C/);
  const menu=run('tests/target-runner.mjs',[],'q\n');assert.equal(menu.status,0,menu.stderr);assert.match(menu.stdout,/짧은 기능 검증/);
});

test('only exact action scores add persistent hits while later play keeps all previous achievements',()=>{
  const hits=[];
  for(const score of [99999,100001,111110,111112])assert.equal(recordTargetArrival(hits,{score,skillTotal:0,action:1}),false);
  assert.deepEqual(hits,[]);
  assert.equal(recordTargetArrival(hits,{score:120200,skillTotal:7,action:5}),true);
  assert.equal(recordTargetArrival(hits,{score:120200,skillTotal:6,action:6}),false);
  recordTargetArrival(hits,{score:123456,skillTotal:4,action:9});
  recordTargetArrival(hits,{score:500000,skillTotal:0,action:100});
  assert.deepEqual(hits.map(hit=>hit.score),[120200,123456]);
  assert.equal(hits[0].action,5);assert.equal(hits[0].stopAction,6);assert.equal(hits[0].canStopBelowSkillCap,true);
});
