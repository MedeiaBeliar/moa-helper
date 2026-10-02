import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validateState} from '../storage.mjs';
import {place} from '../public/solver.js';
import {completePlan,applyPartialPlan,applyReroll} from '../public/plan.js';
import {stateFromCapture,rerollFromCapture} from '../public/capture-state.js';
import {recordNormalDraws,statisticsRows,stageForLines} from '../public/statistics.js';

const single=[[0,0]],vertical=[[0,0],[0,1]],corner=[[0,0],[0,1],[1,1]];
function game({board=[3,0,0],cols=3,clearedLines=30,shapes=[single,single,single],skills={dot:0,reroll:1}}={}) {
  const state=initialState();
  Object.assign(state,{board:board.slice(),cols,rows:board.length,clearedLines,skills,
    options:{...state.options,rotate:false,reflect:false,gravity:false}});
  state.blocks=shapes.map((cells,i)=>({id:`b${i}`,name:String(i),cells:structuredClone(cells)}));
  state.slots=state.blocks.map((block,i)=>({...block,instanceId:`s${i}`,blockId:block.id,used:false,drawStage:stageForLines(clearedLines)}));
  return state;
}
function movesFor(state,placements) {
  let board=state.board.slice();
  return placements.map(([index,x,y])=>{
    const dot=index==='dot',cells=dot?single:state.slots[index].cells;
    const next=place(board,state.cols,cells,x,y,false);assert.ok(next,'The test plan itself must be legal.');
    const move={kind:dot?'dot':'piece',...(dot?{}:{pieceId:state.slots[index].instanceId}),cells:structuredClone(cells),x,y,
      boardBefore:board,boardAfter:next.board,cleared:next.cleared};
    board=next.board;return move;
  });
}
function totals(state,stage) {return statisticsRows(state,stage).totals;}

test('a batch drawn at 30 lines stays in stage one while a reroll after the 31st line enters stage two',()=>{
  const state=game(),original=structuredClone(state);
  const result={complete:false,moves:movesFor(state,[[0,2,0]]),reroll:{pieceId:'s1'}};
  const next=applyReroll(state,result,'b1');
  assert.equal(next.clearedLines,31);
  assert.deepEqual(next.slots.map(slot=>slot.used),[true,false,false]);
  assert.deepEqual(next.slots.map(slot=>slot.drawStage),[1,2,1]);
  assert.deepEqual(totals(next,1),{normal:3,reroll:0,total:3});
  assert.deepEqual(totals(next,2),{normal:0,reroll:1,total:1});
  assert.deepEqual(totals(next,'all'),{normal:3,reroll:1,total:4});
  assert.equal(next.skills.reroll,0);assert.deepEqual(state,original);

  const finished=completePlan(next,{complete:true,moves:movesFor(next,[[1,0,1],[2,1,1]])});
  assert.equal(finished.clearedLines,31);assert.deepEqual(finished.statistics,next.statistics);
  assert.deepEqual(finished.slots,[null,null,null]);assert.deepEqual(state,original);
  // The original snapshot remains a valid undo target, including its draw tags.
  assert.deepEqual(recordNormalDraws(original).slots.map(slot=>slot.drawStage),[1,1,1]);
});

test('multi-row clears, dot skills and partial completion add actual removed rows exactly once',()=>{
  const state=game({board:[3,3,6],clearedLines:59,shapes:[vertical,single,single],skills:{dot:1,reroll:0}});
  const original=structuredClone(state),moves=movesFor(state,[[0,2,0],['dot',0,2],[1,0,0],[2,1,0]]);
  // External result summaries are display data; only validated board replay is authoritative.
  const misleading=moves.map(move=>({...move,cleared:Array(9).fill(0)}));
  const completed=completePlan(state,{complete:true,moves:misleading,lines:999});
  assert.equal(completed.clearedLines,62);assert.equal(completed.skills.dot,0);
  assert.deepEqual(totals(completed,2),{normal:3,reroll:0,total:3});

  const partial=applyPartialPlan(state,{complete:false,moves:misleading.slice(0,2),lines:999});
  assert.equal(partial.clearedLines,62);assert.deepEqual(partial.slots.map(s=>s.used),[true,false,false]);
  assert.deepEqual(partial.slots.map(s=>s.drawStage),[2,2,2]);
  assert.deepEqual(totals(partial,2),{normal:3,reroll:0,total:3});
  const partialSnapshot=structuredClone(partial);
  const continued=completePlan(partial,{complete:true,moves:misleading.slice(2),lines:999});
  assert.equal(continued.clearedLines,62);assert.deepEqual(continued,completed);
  assert.deepEqual(partial,partialSnapshot);assert.deepEqual(state,original);
  assert.throws(()=>applyPartialPlan(partial,{complete:false,moves:misleading.slice(0,2)}));
  assert.deepEqual(partial,partialSnapshot);
});

test('already-used slots do not create fresh observations or repeat their old clears',()=>{
  const state=game({board:[3,3,0],clearedLines:100});
  state.slots[0]={...state.slots[0],used:true,drawRecorded:true,drawStage:3};
  state.statistics={entries:[{blockId:'b0',name:'0',normal:1,reroll:0,stages:{3:{normal:1,reroll:0}}}]};
  const original=structuredClone(state);
  const finished=completePlan(state,{complete:true,moves:movesFor(state,[[1,2,0],[2,2,1]])});
  assert.equal(finished.clearedLines,102);
  assert.deepEqual(totals(finished,3),{normal:3,reroll:0,total:3});
  assert.deepEqual(totals(finished,4),{normal:0,reroll:0,total:0});
  assert.deepEqual(state,original);
});

test('unknown and legacy line totals remain unknown through real multi-row clears and rerolls',()=>{
  for(const legacy of [false,true]) {
    let state=game({board:[3,3,0],clearedLines:null,shapes:[vertical,single,single]});
    if(legacy){delete state.clearedLines;for(const slot of state.slots)delete slot.drawStage;state=validateState(state);}
    const original=structuredClone(state);
    const next=applyReroll(state,{complete:false,moves:movesFor(state,[[0,2,0]]),reroll:{pieceId:'s1'}},'b1');
    assert.equal(next.clearedLines,null);assert.ok(next.slots.every(s=>s.drawStage===null));
    assert.deepEqual(totals(next,'unknown'),{normal:3,reroll:1,total:4});
    for(let stage=1;stage<=5;stage++)assert.equal(totals(next,stage).total,0);
    const finished=completePlan(next,{complete:true,moves:movesFor(next,[[1,0,0],[2,1,0]])});
    assert.equal(finished.clearedLines,null);assert.deepEqual(finished.statistics,next.statistics);assert.deepEqual(state,original);
  }
});

test('capture preserves a known draw stage on recognition and tags genuinely new pieces at the current stage',()=>{
  const state=game({board:[0,0,0],clearedLines:30,shapes:[single,vertical,corner]});state.slots=[null,null,null];
  const original=structuredClone(state),observation={safe:true,board:[0,0,0],pieces:state.blocks.map(block=>({status:'ready',cells:block.cells}))};
  let serial=0;const makeId=()=>`capture-${serial++}`;
  const captured=stateFromCapture(state,observation,makeId);
  assert.deepEqual(captured.slots.map(slot=>slot.drawStage),[1,1,1]);
  const reread=stateFromCapture({...captured,clearedLines:61},observation,makeId);assert.equal(totals(recordNormalDraws(reread),'all').total,0);
  const delayed=recordNormalDraws(reread,{confirmedIds:reread.slots.map(s=>s.instanceId)});
  assert.deepEqual(totals(delayed,1),{normal:3,reroll:0,total:3});assert.equal(totals(delayed,3).total,0);
  const recorded=recordNormalDraws(captured,{confirmedIds:captured.slots.map(s=>s.instanceId)});
  const later={...recorded,clearedLines:61};
  const rotated={...observation,pieces:[observation.pieces[0],{status:'ready',cells:[[0,0],[1,0]]},observation.pieces[2]]};
  const same=stateFromCapture(later,rotated,makeId);
  assert.deepEqual(same.slots.map(s=>s.instanceId),recorded.slots.map(s=>s.instanceId));
  assert.deepEqual(same.slots.map(s=>s.drawStage),[1,1,1]);assert.ok(same.slots.every(s=>s.drawRecorded));
  assert.deepEqual(recordNormalDraws(same).statistics,recorded.statistics);

  const changed=stateFromCapture(same,{...rotated,pieces:[{status:'ready',cells:corner},...rotated.pieces.slice(1)]},makeId);
  assert.notEqual(changed.slots[0].instanceId,same.slots[0].instanceId);assert.equal(changed.slots[0].drawStage,3);
  assert.deepEqual(totals(recordNormalDraws(changed,{confirmedIds:[changed.slots[0].instanceId]}),3),{normal:1,reroll:0,total:1});

  const previousUsed={...same,slots:same.slots.map((slot,i)=>i===0?{...slot,used:true}:slot)};
  const fresh=stateFromCapture(previousUsed,rotated,makeId);
  assert.notEqual(fresh.slots[0].instanceId,same.slots[0].instanceId);assert.equal(fresh.slots[0].drawStage,3);
  assert.deepEqual(fresh.slots.slice(1).map(s=>s.drawStage),[1,1]);
  const counted=recordNormalDraws(fresh,{confirmedIds:[fresh.slots[0].instanceId]});
  assert.deepEqual(totals(counted,1),{normal:3,reroll:0,total:3});
  assert.deepEqual(totals(counted,3),{normal:1,reroll:0,total:1});
  assert.deepEqual(state,original);
});

test('an observed screen reroll crosses the stage boundary only after its validated prefix',()=>{
  const state=game({shapes:[single,vertical,corner]}),original=structuredClone(state);
  const moves=movesFor(state,[[0,2,0]]),result={complete:false,moves,reroll:{pieceId:'s1'}};
  const observation={safe:true,board:moves.at(-1).boardAfter,pieces:[{status:'used',cells:[]},{status:'ready',cells:single},{status:'ready',cells:corner}]};
  const next=rerollFromCapture(state,result,observation);
  assert.equal(next.clearedLines,31);assert.deepEqual(next.slots.map(s=>s.drawStage),[1,2,1]);
  assert.deepEqual(totals(next,1),{normal:3,reroll:0,total:3});assert.deepEqual(totals(next,2),{normal:0,reroll:0,total:0});
  const finished=completePlan(next,{complete:true,moves:movesFor(next,[[1,0,0],[2,1,1]])});
  assert.deepEqual(totals(finished,2),{normal:0,reroll:1,total:1});
  assert.equal(finished.statistics.entries.find(entry=>entry.blockId==='b0').stages[2].reroll,1);
  const corrected=stateFromCapture({...next,clearedLines:61},{...observation,pieces:[observation.pieces[0],{status:'ready',cells:vertical},observation.pieces[2]]},()=> 'corrected-reroll');
  assert.equal(corrected.slots[1].drawStage,2);assert.equal(corrected.slots[1].drawSource,'reroll');
  assert.equal(corrected.slots[1].capturePending,true);assert.equal(totals(recordNormalDraws(corrected),2).total,0);
  const correctedDone=completePlan(corrected,{complete:true,moves:movesFor(corrected,[[1,0,0],[2,1,1]])});
  assert.deepEqual(totals(correctedDone,2),{normal:0,reroll:1,total:1});
  assert.equal(correctedDone.statistics.entries.find(entry=>entry.blockId==='b1').stages[2].reroll,1);
  assert.throws(()=>rerollFromCapture(state,result,{...observation,board:state.board}));
  assert.deepEqual(state,original);
});
