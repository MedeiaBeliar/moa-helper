// Fixed generated boards, not scored games. No browser, server or user save.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cpus} from 'node:os';
import assert from 'node:assert/strict';
import {startSolverRequest} from '../public/solver-session.js';
import {SOLVER_MAX_MS} from '../public/native-engine.js';
import {place,variants} from '../public/solver.js';
import {scoreMoves} from '../public/targets.js';
import {completePlan,applyReroll,applyPartialPlan} from '../public/plan.js';
import {initialState} from '../public/state-schema.js';
import {nodeSolverWorker} from './fixtures/node-solver-worker.mjs';

const catalogue=JSON.parse(await readFile(new URL('../public/example-blocks.json',import.meta.url))).blocks;
let seed=20261004;
const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
const pick=items=>items[Math.floor(random()*items.length)];
const fixtures=[];
for(let i=0;i<24;i++){
  let board=Array(16).fill(0);
  for(let n=0;n<i%9;n++){
    const shape=pick(variants(pick(catalogue).cells));
    for(let attempt=0;attempt<80;attempt++){
      const next=place(board,10,shape.cells,Math.floor(random()*(11-shape.width)),Math.floor(random()*(17-shape.height)));
      if(next){board=next.board;break;}
    }
  }
  const icons=i%3===0?[{x:0,y:0,kind:'dot'},{x:5,y:8,kind:'reroll'}]:[];
  fixtures.push({board,cols:10,pieces:Array.from({length:3},(_,id)=>({...pick(catalogue),id})),catalogue,
    skills:i%5===0?{dot:7,reroll:0}:i%5===1?{dot:0,reroll:7}:{dot:i%3,reroll:i%4},skillIcons:icons,
    clearedLines:[0,31,61,101,151][i%5],currentScore:i%4===0?99999:50000+i*300,targetEnabled:i%2===0,manualTargets:[100000],
    statistics:{entries:catalogue.map((p,index)=>({blockId:p.id,normal:(index+1)*10,reroll:index,
      stages:{[i%5+1]:{normal:(index+1)*10,reroll:index}}}))},options:{rotate:true,reflect:true,gravity:false}});
}
async function check(input,id,parallel){
  const started=performance.now();let worker;
  try{
    const result=await new Promise((resolve,reject)=>startSolverRequest(input,{id,
      createWorker:()=>worker=nodeSolverWorker(),onFinish:data=>data.error?reject(new Error(data.error)):resolve(data.result)}));
    const elapsed=performance.now()-started;
    assert.ok(elapsed<SOLVER_MAX_MS,`case ${id} exceeded one second: ${elapsed.toFixed(1)}ms`);
    assert.ok(result.moves.length||result.reroll,`case ${id} did not yield an action`);
    const replay=scoreMoves(input.currentScore,result.moves,{skills:input.skills,skillIcons:input.skillIcons});
    assert.equal(replay.score,result.score);
    const state={...initialState(),...input,blocks:catalogue,
      slots:input.pieces.map(p=>({...p,instanceId:p.id,blockId:catalogue.find(b=>b.name===p.name).id,used:false}))};
    if(result.complete)completePlan(state,result);
    else if(result.reroll)applyReroll(state,result,catalogue[0].id);
    else applyPartialPlan(state,result);
    return {id,parallel,ms:Math.round(elapsed),method:result.method,complete:result.complete,reroll:!!result.reroll,
      timedOut:result.timedOut,beam:result.strategy?.settings?.beam??null};
  }finally{await worker?.terminate();}
}
const reports=[];
for(let i=0;i<8;i++)reports.push(await check(fixtures[i],i,1));
for(let i=8;i<fixtures.length;i+=2)reports.push(...await Promise.all([check(fixtures[i],i,2),check(fixtures[i+1],i+1,2)]));
const sorted=reports.map(r=>r.ms).sort((a,b)=>a-b);
const summary={date:new Date().toISOString(),node:process.version,cpu:cpus()[0].model,fullGame:false,cases:reports.length,
  minMs:sorted[0],maxMs:sorted.at(-1),p95Ms:sorted[Math.ceil(sorted.length*.95)-1],
  meanMs:Math.round(sorted.reduce((a,b)=>a+b,0)/sorted.length),native:reports.filter(r=>r.method==='native').length,
  watchdogs:reports.filter(r=>r.timedOut).length};
await mkdir('test-results',{recursive:true});await writeFile('test-results/native-one-second-check.json',JSON.stringify({summary,reports},null,2));
console.table(reports);console.log(JSON.stringify(summary));
