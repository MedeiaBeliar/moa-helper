import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import {completePlan} from '../public/plan.js';
import {initialState} from '../public/state-schema.js';
import {SOLVER_WATCHDOG_MS} from '../public/native-engine.js';

const catalogue=JSON.parse(await readFile(new URL('../public/example-blocks.json',import.meta.url))).blocks;
function inputFor(names){
  return {board:Array(16).fill(0),cols:10,pieces:names.map((name,id)=>({...catalogue.find(p=>p.name===name),id})),
    catalogue,skills:{dot:0,reroll:0},skillIcons:[],currentScore:0,clearedLines:0,targetEnabled:true,
    options:{rotate:true,reflect:true,gravity:false,timeLimit:850}};
}
function request(worker,input,id){
  return new Promise((resolve,reject)=>{
    let latest=null,loading=false,settled=false;
    const finish=(result,error=null)=>{
      if(settled)return;settled=true;clearTimeout(timer);worker.off('message',message);worker.off('error',failed);
      if(error)reject(error);else resolve({result,loading});
    };
    const failed=error=>finish(null,error);
    const message=data=>{
      if(data.testEvent==='engine-loading'){loading=true;return;}
      if(data.testEvent==='unhandled-input'){failed(new Error('Request was dropped while the engine was loading'));return;}
      if(data.id!==id)return;
      if(data.error){failed(new Error(data.error));return;}
      if(data.progress){if(!latest?.complete||data.result.complete)latest=data.result;}
      else finish(data.result);
    };
    const timer=setTimeout(()=>finish(latest),SOLVER_WATCHDOG_MS);
    worker.on('message',message);worker.on('error',failed);
    worker.postMessage({id,input});
  });
}
function verifyComplete(input,result){
  assert.ok(result,'a recommendation must survive the five-second deadline');
  assert.equal(result.complete,true);assert.equal(result.moves.filter(m=>m.kind==='piece').length,3);
  const state={...initialState(),...input,blocks:catalogue,
    slots:input.pieces.map(piece=>({...piece,instanceId:piece.id,blockId:catalogue.find(b=>b.name===piece.name).id,used:false}))};
  const committed=completePlan(state,result);
  assert.deepEqual(committed.slots,[null,null,null]);assert.ok(committed.currentScore>0);
}

test('production worker keeps the first ㅡ ㅣ ㄹ request during async native startup',async()=>{
  const worker=new Worker(new URL('./fixtures/web-worker-host.mjs',import.meta.url),{workerData:{compileDelayMs:150}});
  try{
    const input=inputFor(['ㅡ','ㅣ','ㄹ']),{result,loading}=await request(worker,input,1);
    assert.equal(loading,true);verifyComplete(input,result);assert.equal(result.method,'native');
  }finally{await worker.terminate();}
});

test('production worker handles a different first batch and repeated requests after initialization',async()=>{
  const worker=new Worker(new URL('./fixtures/web-worker-host.mjs',import.meta.url));
  try{
    // A small catalogue lets both calls finish without the host watchdog.
    const input={...inputFor(['.','.','.']),catalogue:catalogue.filter(p=>p.name==='.')};
    for(const id of [1,2])verifyComplete(input,(await request(worker,input,id)).result);
  }finally{await worker.terminate();}
});

test('production worker retains the JavaScript recommendation if native initialization fails',async()=>{
  const worker=new Worker(new URL('./fixtures/web-worker-host.mjs',import.meta.url),{workerData:{compileDelayMs:150,failCompile:true}});
  try{
    const input=inputFor(['ㅡ','ㅣ','ㄹ']),{result}=await request(worker,input,1);
    verifyComplete(input,result);assert.equal(result.method,'fast');
  }finally{await worker.terminate();}
});
