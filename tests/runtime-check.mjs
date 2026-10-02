// Real wall-clock checks on the current host; no server or user save access.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {solve,place} from '../public/solver.js';
const catalogue=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8'));
const fixtures=[
  {name:'empty-large-shapes',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:0}},
  {name:'screen-seven-dots',board:[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0],batch:[11,19,11],skills:{dot:7,reroll:0}},
  {name:'seven-rerolls',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:7}},
  {name:'fragmented-board',board:[127,481,486,480,448,462,399,398,393,480,0,0,0,0,0,0],batch:[12,18,20],skills:{dot:1,reroll:2}},
];
const reports=[];
for(const fixture of fixtures){
  const pieces=fixture.batch.map((index,id)=>({...catalogue[index],id})),input={...fixture,cols:10,pieces,catalogue,options:{timeLimit:850}};
  const started=performance.now();let firstPlanMs=null,updates=0;
  const result=solve(input,{onProgress:r=>{updates++;if(r.complete&&firstPlanMs===null)firstPlanMs=performance.now()-started;}}),wallMs=performance.now()-started;
  assert.ok(wallMs<1000,`${fixture.name} exceeded one second: ${wallMs}`);
  let board=fixture.board,score=0,dots=0;const used=new Set();
  for(const move of result.moves){
    assert.deepEqual(move.boardBefore,board);const next=place(board,10,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(next.board,move.boardAfter);
    if(move.kind==='dot')dots++;else{assert.ok(!used.has(move.pieceId));used.add(move.pieceId);}
    score+=(move.kind==='dot'?1:move.cells.length)+300*next.cleared.length**2;board=next.board;
  }
  assert.equal(score,result.score);assert.ok(dots<=fixture.skills.dot);
  if(result.complete){assert.equal(used.size,3);assert.ok(fixture.skills.dot+fixture.skills.reroll-dots<7);}
  const report={name:fixture.name,wallMs:Math.round(wallMs),firstPlanMs:firstPlanMs===null?null:Math.round(firstPlanMs),updates,complete:result.complete,score:result.score,skillsUsed:result.skillsUsed,strategy:result.strategy};
  reports.push(report);console.log(JSON.stringify(report));
}
await mkdir('test-results',{recursive:true});await writeFile('test-results/runtime-check-fast-default.json',JSON.stringify({internalLimitMs:850,wallLimitMs:1000,reports},null,2));
