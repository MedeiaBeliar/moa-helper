import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {startSolverRequest} from '../public/solver-session.js';
import {solveFast} from '../public/fast.js';
import {completePlan} from '../public/plan.js';
import {initialState} from '../public/state-schema.js';
import {nodeSolverWorker} from './fixtures/node-solver-worker.mjs';

const catalogue=JSON.parse(await readFile(new URL('../public/example-blocks.json',import.meta.url))).blocks;
const input={board:Array(16).fill(0),cols:10,pieces:['ㅡ','ㅣ','ㄹ'].map((name,id)=>({...catalogue.find(b=>b.name===name),id})),
  catalogue,skills:{dot:0,reroll:0},skillIcons:[],currentScore:0,clearedLines:0,options:{rotate:true,reflect:true,gravity:false}};
function verify(result){
  assert.ok(result.complete);
  const state={...initialState(),...input,blocks:catalogue,
    slots:input.pieces.map(p=>({...p,instanceId:p.id,blockId:catalogue.find(b=>b.name===p.name).id,used:false}))};
  assert.deepEqual(completePlan(state,result).slots,[null,null,null]);
}
function run(createWorker){return new Promise((resolve,reject)=>startSolverRequest(input,{id:7,createWorker,
  onFinish:data=>data.error?reject(new Error(data.error)):resolve(data.result)}));}

test('UI transport reuses the compiled engine and commits the reported first batch',async()=>{
  const worker=nodeSolverWorker({failCompile:true,compileDelayMs:2000});
  try{
    const result=await run(()=>worker);verify(result);
    assert.equal(result.method,'native');assert.equal(worker.compilations,0,'no refetch or recompilation in the worker');
  }finally{await worker.terminate();}
});

test('a silent worker still returns a legal backup at the host deadline',async()=>{
  let terminated=false;
  const result=await run(()=>({postMessage(){},terminate(){terminated=true;}}));
  verify(result);assert.equal(result.timedOut,true);assert.equal(result.nativeFallback,true);assert.equal(terminated,true);
});

test('a later partial update cannot discard a complete plan at the deadline',async()=>{
  const plan=solveFast({...input,options:{...input.options,timeLimit:45}});
  const worker={terminate(){},postMessage({id}){
    this.onmessage({data:{id,progress:true,result:plan}});
    this.onmessage({data:{id,progress:true,result:{moves:[],complete:false}}});
    this.onmessage({data:{id:id+1,result:{moves:[],complete:false}}});
  }};
  const result=await run(()=>worker);verify(result);assert.equal(result.timedOut,true);assert.deepEqual(result.moves,plan.moves);
});

test('worker creation failures recover and cancellation suppresses late replies',async()=>{
  verify(await run(()=>{throw new Error('Worker startup failed');}));
  let finishCount=0,progressCount=0;
  const worker={terminate(){},postMessage(){}};
  const handle=startSolverRequest(input,{id:8,createWorker:()=>worker,onFinish:()=>finishCount++,onProgress:()=>progressCount++});
  const late=worker.onmessage;handle.terminate();late({data:{id:8,result:{complete:true}}});
  assert.equal(finishCount,0);assert.equal(progressCount,0);
});
