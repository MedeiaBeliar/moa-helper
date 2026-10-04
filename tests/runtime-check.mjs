// Real wall-clock checks on the current host; no server or user save access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {place} from '../public/solver.js';
import {SOLVER_MAX_MS,SOLVER_WATCHDOG_MS} from '../public/native-engine.js';
const catalogue=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8'));
const fixtures=[
  {name:'reported-first-batch',board:Array(16).fill(0),batch:[5,9,15],skills:{dot:0,reroll:0}},
  {name:'empty-large-shapes',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:0}},
  {name:'screen-seven-dots',board:[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0],batch:[11,19,11],skills:{dot:7,reroll:0}},
  {name:'seven-rerolls',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:7}},
  {name:'fragmented-board',board:[127,481,486,480,448,462,399,398,393,480,0,0,0,0,0,0],batch:[12,18,20],skills:{dot:1,reroll:2}},
];
const reports=[];
async function recommend(input){
  const started=performance.now(),worker=new Worker(new URL('./fixtures/web-worker-host.mjs',import.meta.url));
  let latest=null,firstPlanMs=null,firstNativeMs=null,updates=0,timer;
  try{return await new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(result,timedOut=false,error=null)=>{
      if(settled)return;settled=true;clearTimeout(timer);
      worker.removeAllListeners();
      if(error){reject(error);return;}
      resolve({result,wallMs:performance.now()-started,firstPlanMs,firstNativeMs,updates,timedOut});
    };
    worker.on('message',message=>{
      if(message.testEvent==='unhandled-input'){finish(null,false,new Error('Worker dropped the calculation request'));return;}
      if(message.testEvent)return;
      if(message.error){finish(null,false,new Error(message.error));return;}
      if(message.progress){
        updates++;
        if(message.result.complete&&firstPlanMs===null)firstPlanMs=performance.now()-started;
        if(message.result.method==='native'&&firstNativeMs===null)firstNativeMs=performance.now()-started;
        if(!latest?.complete||message.result.complete)latest=message.result;
      }else finish(message.result);
    });
    worker.on('error',error=>finish(null,false,error));
    worker.on('exit',code=>finish(null,false,new Error(`Worker exited without a result: ${code}`)));
    timer=setTimeout(()=>finish(latest,true),SOLVER_WATCHDOG_MS);
    worker.postMessage({id:1,input});
  });}finally{clearTimeout(timer);await worker.terminate();}
}
for(const fixture of fixtures){
  const pieces=fixture.batch.map((index,id)=>({...catalogue[index],id})),input={...fixture,cols:10,pieces,catalogue,options:{timeLimit:850}};
  const {result,wallMs,firstPlanMs,firstNativeMs,updates,timedOut}=await recommend(input);
  assert.ok(wallMs<SOLVER_MAX_MS,`${fixture.name} exceeded the five-second limit: ${wallMs}`);
  assert.ok(result,`${fixture.name} produced no plan before the deadline`);
  assert.equal(result.method,'native',`${fixture.name} did not finish even the first native pass`);
  let board=fixture.board,score=0,dots=0;const used=new Set();
  for(const move of result.moves){
    assert.deepEqual(move.boardBefore,board);const next=place(board,10,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(next.board,move.boardAfter);
    if(move.kind==='dot')dots++;else{assert.ok(!used.has(move.pieceId));used.add(move.pieceId);}
    score+=(move.kind==='dot'?1:move.cells.length)+300*next.cleared.length**2;board=next.board;
  }
  assert.equal(score,result.score);assert.ok(dots<=fixture.skills.dot);
  if(result.complete){assert.equal(used.size,3);assert.ok(fixture.skills.dot+fixture.skills.reroll-dots<7);}
  const report={name:fixture.name,wallMs:Math.round(wallMs),firstPlanMs:firstPlanMs===null?null:Math.round(firstPlanMs),firstNativeMs:firstNativeMs===null?null:Math.round(firstNativeMs),updates,timedOut,complete:result.complete,score:result.score,skillsUsed:result.skillsUsed,strategy:result.strategy};
  reports.push(report);console.log(JSON.stringify(report));
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/runtime-check-native-default.json',JSON.stringify({engine:'native25',fullGame:false,wallLimitMs:SOLVER_MAX_MS,watchdogMs:SOLVER_WATCHDOG_MS,reports},null,2));
