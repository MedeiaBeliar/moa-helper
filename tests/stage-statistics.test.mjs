import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validateState,createStore} from '../storage.mjs';
import {recordNormalDraws,statisticsRows,statisticsView,setObservationCounts,resetStatistics,stageForLines,addClearedLines} from '../public/statistics.js';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
function fixture(){
  const state=initialState();
  state.blocks=[{id:'a',name:'ㄱ',cells:[[0,0]]},{id:'b',name:'ㄴ',cells:[[0,0],[1,0]]}];
  state.slots=[0,1,1].map((n,i)=>({...state.blocks[n],instanceId:`s${i}`,blockId:state.blocks[n].id,used:false}));
  return state;
}
const total=(state,stage='all')=>statisticsRows(state,stage).totals;

test('all five boundaries and unknown line totals are explicit; overflow never wraps',()=>{
  assert.deepEqual([0,30,31,60,61,100,101,150,151].map(stageForLines),[1,1,2,2,3,3,4,4,5]);
  for(const value of [undefined,null,-1,1.2,'30',Infinity])assert.equal(stageForLines(value),null);
  assert.equal(addClearedLines(30,2),32);assert.equal(addClearedLines(null,4),null);
  assert.throws(()=>addClearedLines(Number.MAX_SAFE_INTEGER,1));assert.throws(()=>addClearedLines(0,-1));
});

test('legacy totals are unknown while stage draws add to both scopes and persist',async()=>{
  const legacy=fixture();delete legacy.clearedLines;
  legacy.statistics={entries:[{blockId:'a',name:'ㄱ',normal:10,reroll:2}]};
  const migrated=validateState(legacy);assert.equal(migrated.clearedLines,null);assert.deepEqual(migrated.statistics,legacy.statistics);
  const recorded=recordNormalDraws({...migrated,clearedLines:31});
  assert.deepEqual(total(recorded),{normal:13,reroll:2,total:15});
  assert.deepEqual(total(recorded,'unknown'),{normal:10,reroll:2,total:12});
  assert.deepEqual(total(recorded,2),{normal:3,reroll:0,total:3});
  assert.deepEqual(total(recorded,1),{normal:0,reroll:0,total:0});
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-stage-'));
  try{await createStore(dir).write(recorded);const restored=await createStore(dir).read();assert.deepEqual(restored.statistics,recorded.statistics);assert.equal(restored.clearedLines,31);assert.equal(recordNormalDraws(restored),restored);}
  finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});

test('editing a stage applies its delta to all, preserves unknown, and uses scoped denominators',()=>{
  let state=fixture();state=setObservationCounts(state,'a',{normal:10,reroll:2});
  state=setObservationCounts(state,'a',{normal:2,reroll:1},1);
  state=setObservationCounts(state,'b',{normal:6,reroll:0},'1');
  state=setObservationCounts(state,'b',{normal:1,reroll:3},2);
  const before=structuredClone(state),edited=setObservationCounts(state,'a',{normal:4,reroll:0},1);
  assert.deepEqual(state,before);assert.deepEqual(total(edited),{normal:21,reroll:5,total:26});
  assert.deepEqual(total(edited,'unknown'),{normal:10,reroll:2,total:12});
  const view=statisticsView(edited,{stage:1,query:'ㄱ',sort:'normal'});
  assert.equal(view.rows[0].normal,4);assert.equal(view.totals.normal,10);
  assert.deepEqual(statisticsView(edited,{stage:1,sort:'normal'}).rows.map(r=>r.blockId),['b','a']);
  assert.throws(()=>setObservationCounts(edited,'a',{normal:3,reroll:2},'all'));
  const unknown=setObservationCounts(edited,'a',{normal:0,reroll:0},'unknown');
  assert.deepEqual(total(unknown),{normal:11,reroll:3,total:14});
  assert.deepEqual(validateState(unknown).statistics,unknown.statistics);
  const reset=resetStatistics(recordNormalDraws(unknown));assert.deepEqual(reset.statistics,{entries:[]});assert.equal(recordNormalDraws(reset),reset);
});

test('validation rejects inconsistent, malformed or overflowing stage ledgers',()=>{
  const state=fixture();
  for(const stages of [{0:{normal:0,reroll:0}},{6:{normal:0,reroll:0}},{'01':{normal:0,reroll:0}},{1:{normal:2,reroll:0}},{1:{normal:-1,reroll:0}},{1:{normal:0}},{1:{normal:0,reroll:.5}},[],null]){
    assert.throws(()=>validateState({...state,statistics:{entries:[{blockId:'a',name:'ㄱ',normal:1,reroll:0,stages}]}}));
  }
  for(const n of [-1,.5,Infinity,'1'])assert.throws(()=>validateState({...state,clearedLines:n}));
  for(const n of [0,6,'1',NaN])assert.throws(()=>validateState({...state,slots:state.slots.map(s=>({...s,drawStage:n}))}));
  const large=setObservationCounts(state,'a',{normal:Number.MAX_SAFE_INTEGER,reroll:0});
  assert.throws(()=>setObservationCounts(large,'b',{normal:1,reroll:0},5));
});
