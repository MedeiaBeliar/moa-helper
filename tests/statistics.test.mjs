import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initialState,validateState,createStore} from '../storage.mjs';
import {recordNormalDraws,statisticsRows,statisticsView,setObservationCounts,resetStatistics,observedPercent} from '../public/statistics.js';
import {applyReroll,completePlan} from '../public/plan.js';
import {stateFromCapture,rerollFromCapture} from '../public/capture-state.js';
import {solve} from '../public/solver.js';

function fixture(){
  const state=initialState();
  Object.assign(state,{cols:3,rows:2,board:[0,0],skills:{dot:0,reroll:3}});
  Object.assign(state.options,{rotate:false,reflect:false,timeLimit:800,lookAhead:false});
  state.blocks=[{id:'a',name:'ㅡ',cells:[[0,0],[1,0],[2,0],[3,0]]},{id:'b',name:'ㅅ',cells:[[0,0]]},{id:'c',name:'ㅁ',cells:[[0,0],[1,0],[0,1],[1,1]]}];
  state.slots=[state.blocks[0],state.blocks[1],state.blocks[1]].map((block,i)=>({instanceId:`s${i}`,blockId:block.id,name:block.name,cells:block.cells,used:false}));
  return state;
}
const recommend=state=>solve({...state,pieces:state.slots.filter(s=>!s.used).map(s=>({id:s.instanceId,cells:s.cells}))});
const totals=state=>statisticsRows(state).totals;

test('normal draws include duplicates and never-placed pieces, count once, and survive restart',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-statistics-'));
  try{
    const state=fixture(),before=structuredClone(state),recorded=recordNormalDraws(state);
    assert.deepEqual(state,before);assert.deepEqual(totals(recorded),{normal:3,reroll:0,total:3});
    assert.equal(recordNormalDraws(recorded),recorded);
    assert.deepEqual(statisticsRows(recorded).rows.map(r=>[r.name,r.normal]),[['ㅡ',1],['ㅅ',2],['ㅁ',0]]);
    assert.equal(observedPercent(2,3),'66.7%');assert.equal(observedPercent(0,3),'0.0%');assert.equal(observedPercent(0,0),'—');
    await createStore(dir).write(recorded);
    const restored=await createStore(dir).read();assert.equal(recordNormalDraws(restored),restored);
    assert.deepEqual(totals(restored),totals(recorded));
    const legacy=fixture();delete legacy.statistics;
    assert.deepEqual(validateState(legacy).statistics,{entries:[]});
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});

test('actual repeated rerolls count once each; invalid results are atomic and completion adds no draws',()=>{
  const state=fixture(),before=structuredClone(state),result=recommend(state);
  assert.ok(result.reroll);
  assert.throws(()=>applyReroll(state,result,'missing'));assert.deepEqual(state,before);
  const first=applyReroll(state,result,'a');
  assert.deepEqual(totals(first),{normal:3,reroll:1,total:4});assert.equal(first.slots.filter(s=>s.used).length,2);
  const second=applyReroll(first,recommend(first),'a');
  assert.deepEqual(totals(second),{normal:3,reroll:2,total:5});
  assert.deepEqual(totals(recordNormalDraws(second)),totals(second));
  assert.throws(()=>applyReroll(second,result,'b'),/변경/);assert.deepEqual(totals(second),{normal:3,reroll:2,total:5});
  const third=applyReroll(second,recommend(second),'b');
  assert.deepEqual(totals(third),{normal:3,reroll:3,total:6});assert.equal(third.skills.reroll,0);
  assert.deepEqual(statisticsRows(third).rows.map(r=>[r.normal,r.reroll]),[[1,2],[2,1],[0,0]]);
  const finished=completePlan(third,recommend(third));assert.deepEqual(totals(finished),totals(third));
  const nextBatch=recordNormalDraws({...finished,slots:fixture().slots});
  assert.deepEqual(totals(nextBatch),{normal:6,reroll:3,total:9});
});

test('statistics retain renamed and deleted blocks, and validation rejects invalid counters',()=>{
  const state=recordNormalDraws(fixture());
  state.blocks=state.blocks.filter(b=>b.id!=='a').map(b=>({...b,name:b.id==='b'?'가':b.name}));
  const {rows,totals:total}=statisticsRows(state);
  assert.deepEqual(rows.map(r=>[r.name,r.normal]),[['가',2],['ㅁ',0],['ㅡ',1]]);
  assert.equal(total.total,3);
  for(const bad of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>validateState({...state,statistics:{entries:[{blockId:'b',name:'ㅅ',normal:bad,reroll:0}]}}));
  }
  assert.throws(()=>validateState({...state,statistics:{entries:[state.statistics.entries[0],state.statistics.entries[0]]}}));
  assert.throws(()=>validateState({...state,statistics:{entries:[{blockId:'b',name:'ㅅ',normal:Number.MAX_SAFE_INTEGER,reroll:1}]}}));
  const used=fixture();used.slots[0].used=true;
  assert.equal(totals(recordNormalDraws(used)).normal,2); // Don't invent legacy used draws.
  const incomplete=fixture();incomplete.slots[2]=null;
  assert.equal(recordNormalDraws(incomplete),incomplete);
});

test('screen rereads and rotations do not duplicate draws; demo and ambiguous shapes do not skew named odds',()=>{
  const state=initialState();state.rows=2;state.board=[0,0];
  state.blocks=[{id:'line',name:'ㅡ',cells:[[0,0],[1,0]]}];
  const ready=cells=>({status:'ready',cells}),observation={safe:true,board:[0,0],pieces:Array(3).fill(ready([[0,0],[1,0]]))};
  let id=0;const makeId=()=>String(id++);
  const first=recordNormalDraws(stateFromCapture(state,observation,makeId));
  const rotated={...observation,pieces:Array(3).fill(ready([[0,0],[0,1]]))};
  const reread=recordNormalDraws(stateFromCapture(first,rotated,makeId));assert.deepEqual(totals(reread),totals(first));
  assert.equal(reread.slots[0].instanceId,first.slots[0].instanceId);
  const demo=recordNormalDraws(stateFromCapture(state,observation,makeId,{demo:true}));assert.equal(totals(demo).total,0);
  assert.equal(totals(completePlan(demo,recommend(demo))).total,0);
  const live=recordNormalDraws(stateFromCapture(demo,observation,makeId));assert.equal(totals(live).total,0);
  assert.equal(totals(recordNormalDraws(live,{confirmedIds:live.slots.map(s=>s.instanceId)})).total,3);
  const ambiguous={...state,blocks:[...state.blocks,{id:'vertical',name:'ㅣ',cells:[[0,0],[0,1]]}]};
  const uncertain=stateFromCapture(ambiguous,observation,makeId);assert.equal(totals(recordNormalDraws(uncertain)).total,0);
  const unknown=recordNormalDraws(uncertain,{confirmedIds:uncertain.slots.map(s=>s.instanceId)});
  assert.equal(unknown.statistics.entries.length,1);assert.equal(unknown.statistics.entries[0].blockId,null);
  assert.equal(unknown.statistics.entries[0].normal,3);assert.equal(statisticsRows(unknown).rows[0].normal,0);
});

test('screen reroll uses the saved identity while keeping the actual orientation and draw source',()=>{
  const state=fixture(),result=recommend(state);
  const observation={safe:true,board:result.moves.at(-1).boardAfter,pieces:[{status:'ready',cells:[[0,0]]},{status:'used'},{status:'used'}]};
  const next=rerollFromCapture(state,result,observation);
  assert.equal(next.slots[0].blockId,'b');assert.deepEqual(next.blocks,state.blocks);
  assert.deepEqual(totals(next),{normal:3,reroll:0,total:3});
  assert.equal(next.slots[0].capturePending,true);assert.equal(next.slots[0].drawSource,'reroll');
  const finished=completePlan(next,recommend(next));
  assert.deepEqual(totals(finished),{normal:3,reroll:1,total:4});
  assert.equal(finished.statistics.entries.find(e=>e.blockId==='b').reroll,1);
});

test('manual totals replace counts atomically and automatic draws continue without recounting the current batch',()=>{
  const state=recordNormalDraws(fixture()),before=structuredClone(state);
  const edited=setObservationCounts(state,'b',{normal:20,reroll:5});
  assert.deepEqual(state,before);assert.deepEqual(totals(edited),{normal:21,reroll:5,total:26});
  assert.equal(recordNormalDraws(edited),edited);
  assert.deepEqual(edited.slots,state.slots);assert.deepEqual(edited.board,state.board);assert.deepEqual(edited.skills,state.skills);
  assert.deepEqual(validateState(edited).statistics,edited.statistics);
  const nextBatch=recordNormalDraws({...edited,slots:fixture().slots});
  assert.deepEqual(totals(nextBatch),{normal:24,reroll:5,total:29});
  const rerolled=applyReroll(edited,recommend(edited),'b');
  assert.equal(rerolled.statistics.entries.find(e=>e.blockId==='b').reroll,6);
  assert.equal(rerolled.statistics.entries.find(e=>e.blockId==='b').normal,20);
  for(const counts of [{normal:-1,reroll:0},{normal:1.5,reroll:0},{normal:1,reroll:NaN},{normal:'1',reroll:0},{normal:Number.MAX_SAFE_INTEGER,reroll:1}])assert.throws(()=>setObservationCounts(edited,'b',counts));
  assert.throws(()=>setObservationCounts(edited,'missing',{normal:0,reroll:0}));
  assert.equal(setObservationCounts(edited,'c',{normal:0,reroll:0}).statistics.entries.length,3);
  const unknown={...edited,statistics:{entries:[...edited.statistics.entries,{blockId:null,name:'미분류 (화면 인식)',normal:3,reroll:0}]}};
  assert.equal(setObservationCounts(unknown,null,{normal:7,reroll:2}).statistics.entries.at(-1).normal,7);
});

test('statistics search retains full denominators and high-first sort compares the selected source',()=>{
  let state=fixture();
  state=setObservationCounts(state,'a',{normal:30,reroll:0});
  state=setObservationCounts(state,'b',{normal:2,reroll:35});
  state=setObservationCounts(state,'c',{normal:0,reroll:0});
  const ids=options=>statisticsView(state,options).rows.map(row=>row.blockId);
  assert.deepEqual(ids({sort:'total'}),['b','a','c']);assert.deepEqual(ids({sort:'normal'}),['a','b','c']);assert.deepEqual(ids({sort:'reroll'}),['b','c','a']);
  assert.deepEqual(ids({sort:'name'}),['c','b','a']);
  const filtered=statisticsView(state,{query:' ㅡ ',sort:'normal'});
  assert.deepEqual(filtered.rows.map(r=>r.blockId),['a']);assert.equal(filtered.totals.normal,32);
  assert.equal(observedPercent(filtered.rows[0].normal,filtered.totals.normal),'93.8%');
  assert.deepEqual(statisticsView(state,{query:'missing'}).rows,[]);
  assert.equal(statisticsView(state,{query:'missing'}).totals.total,67);
});

test('bulk reset removes all counts but never changes the game or recounts current draws',()=>{
  const state=setObservationCounts(recordNormalDraws(fixture()),'b',{normal:20,reroll:7}),before=structuredClone(state);
  const reset=resetStatistics(state);
  assert.deepEqual(state,before);assert.deepEqual(reset.statistics,{entries:[]});
  for(const key of ['blocks','board','slots','skills','options'])assert.deepEqual(reset[key],state[key]);
  assert.equal(recordNormalDraws(reset),reset);assert.deepEqual(totals(reset),{normal:0,reroll:0,total:0});
  const afterReroll=applyReroll(reset,recommend(reset),'b');assert.deepEqual(totals(afterReroll),{normal:0,reroll:1,total:1});
  const nextBatch=recordNormalDraws({...reset,slots:fixture().slots});assert.deepEqual(totals(nextBatch),{normal:3,reroll:0,total:3});
});
