import test from 'node:test';
import assert from 'node:assert/strict';
import { completePlan, applyPartialPlan, overlayCells, isOrderIndependent } from '../public/plan.js';
import { initialState,validateState } from '../storage.mjs';
import {solve,place} from '../public/solver.js';

function reusedRowPlan() {
  const state=initialState();state.cols=4;state.rows=3;state.board=[7,7,7];
  const shapes=[[[0,0]],[[0,0],[1,0],[2,0],[3,0]],[[0,0],[1,0],[2,0],[3,0]]];
  state.blocks=shapes.slice(0,2).map((cells,i)=>({id:`b${i}`,name:`블록 ${i}`,cells}));
  state.slots=shapes.map((cells,i)=>({instanceId:`s${i}`,blockId:`b${i?1:0}`,name:`블록 ${i}`,cells,used:false}));
  const moves=shapes.map((cells,i)=>({pieceId:`s${i}`,cells,x:i?0:3,y:0,boardBefore:i?[0,7,7]:[7,7,7],cleared:[0]}));
  return {state,result:{moves,complete:true,lines:3}};
}
test('overview preserves every order at a location reused after clearing',()=>{
  const {result}=reusedRowPlan();const cells=overlayCells(result.moves);
  assert.deepEqual(cells.get('3,0'),[1,2,3]);assert.deepEqual(cells.get('0,0'),[2,3]);
  assert.deepEqual(overlayCells(result.moves,1).get('3,0'),[2]);assert.equal(overlayCells(result.moves,-1).size,0);
});
test('complete replays all clears, resets exactly the tray, and preserves the library',()=>{
  const {state,result}=reusedRowPlan(),original=structuredClone(state),next=completePlan(state,result);
  assert.deepEqual(next.board,[0,7,7]);assert.deepEqual(next.slots,[null,null,null]);assert.deepEqual(next.blocks,original.blocks);assert.deepEqual(state,original);
});
test('incomplete, stale or duplicate recommendations cannot partially commit or reset',()=>{
  const {state,result}=reusedRowPlan(),original=structuredClone(state);
  assert.throws(()=>completePlan(state,{...result,complete:false}));
  assert.throws(()=>completePlan(state,{...result,moves:result.moves.slice(0,2)}));
  const stale=structuredClone(result);stale.moves[1].boardBefore=[7,7,7];assert.throws(()=>completePlan(state,stale));
  const duplicate=structuredClone(result);duplicate.moves[2].pieceId='s1';assert.throws(()=>completePlan(state,duplicate));
  assert.deepEqual(state,original);
});

test('explicit partial apply preserves remaining pieces and never double counts draws',()=>{
  const {state,result}=reusedRowPlan(),original=structuredClone(state);
  const partial={...result,complete:false,moves:result.moves.slice(0,1)};
  const next=applyPartialPlan(state,partial);
  assert.deepEqual(next.board,[0,7,7]);assert.deepEqual(next.slots.map(s=>s.used),[true,false,false]);
  assert.deepEqual(next.blocks,state.blocks);assert.deepEqual(state,original);
  assert.throws(()=>applyPartialPlan(next,partial));
  const finished=completePlan(next,{...result,moves:result.moves.slice(1)});
  assert.deepEqual(finished.statistics,next.statistics);assert.deepEqual(finished.slots,[null,null,null]);
  assert.throws(()=>applyPartialPlan(state,{...partial,reroll:{pieceId:'s1'}}));
  assert.throws(()=>applyPartialPlan({...state,skills:{dot:7,reroll:0}},partial));
});
test('complete honors intermediate gravity and can finish a partly used batch',()=>{
  const {state,result}=reusedRowPlan();state.rows=4;state.board=[1,7,1,1];state.options.gravity=true;
  result.moves[0].y=1;result.moves[0].boardBefore=[1,7,1,1];
  result.moves[1].boardBefore=[0,1,1,1];result.moves[2].boardBefore=[0,1,1,1];
  assert.deepEqual(completePlan(state,result).board,[0,1,1,1]);
  state.board=[0,1,1,1];state.slots[0].used=true;result.moves.shift();
  assert.deepEqual(completePlan(state,result).slots,[null,null,null]);
});

test('game completion leaves untouched rows in place across multiple line clears',()=>{
  const state=initialState();Object.assign(state,{cols:4,rows:5,board:[1,7,4,7,2]});state.options.gravity=true;
  state.blocks=[{id:'dot',name:'.',cells:[[0,0]]}];state.slots=[0,1,2].map(i=>({instanceId:`p${i}`,blockId:'dot',name:'.',cells:[[0,0]],used:false}));
  const game=validateState(state),moves=[
    {pieceId:'p0',cells:[[0,0]],x:3,y:1,boardBefore:[1,7,4,7,2]},
    {pieceId:'p1',cells:[[0,0]],x:3,y:3,boardBefore:[1,0,4,7,2]},
    {pieceId:'p2',cells:[[0,0]],x:2,y:1,boardBefore:[1,0,4,0,2]}
  ];
  assert.deepEqual(completePlan(game,{complete:true,moves}).board,[1,4,4,0,2]);
});

test('number-free plans can be replayed in all orders; skills and incomplete plans retain numbers',()=>{
  const board=[0,0,0],pieces=[{id:'a',cells:[[0,0]]},{id:'b',cells:[[0,0],[1,0]]},{id:'c',cells:[[0,0],[0,1],[1,1]]}];
  const result=solve({board,cols:10,pieces,options:{lookAhead:false,timeLimit:1000}});
  assert.equal(isOrderIndependent(result),true);assert.equal(result.lines,0);
  const orders=[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  for(const order of orders){
    let current=board;
    for(const index of order){const move=result.moves[index],next=place(current,10,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(next.cleared,[]);current=next.board;}
    assert.deepEqual(current,result.moves.at(-1).boardAfter);
  }
  assert.equal(isOrderIndependent({...result,complete:false}),false);
  assert.equal(isOrderIndependent({...result,reroll:{pieceId:'a'}}),false);
  assert.equal(isOrderIndependent({...result,moves:result.moves.map((m,i)=>i===1?{...m,kind:'dot'}:m)}),false);
  assert.equal(isOrderIndependent({...result,moves:result.moves.map((m,i)=>i===1?{...m,cleared:[0]}:m)}),false);
  assert.equal(isOrderIndependent({...result,moves:[]}),false);
  assert.equal(isOrderIndependent(null),false);
  const clears=solve({board:[7,7,7],cols:4,pieces:Array.from({length:3},(_,id)=>({id,cells:[[0,0]]}))});
  assert.ok(clears.lines);assert.equal(isOrderIndependent(clears,4),true);
});

function positionedPlan(board,cols,placements){
  let current=board;
  const moves=placements.map(([cells,x,y],i)=>{
    const next=place(current,cols,cells,x,y);assert.ok(next);
    const move={kind:'piece',pieceId:`p${i}`,cells,x,y,boardBefore:current,boardAfter:next.board,cleared:next.cleared};
    current=next.board;return move;
  });
  return {complete:true,moves,lines:moves.reduce((sum,move)=>sum+move.cleared.length,0)};
}

test('disjoint clears and independent simultaneous clears hide order numbers',()=>{
  const unit=[[0,0]],vertical=[[0,0],[0,1]];
  const separate=positionedPlan([7,7,0],4,[[unit,3,0],[unit,3,1],[unit,0,2]]);
  assert.equal(isOrderIndependent(separate,4),true);
  const combo=positionedPlan([7,7,0,0],4,[[vertical,3,0],[unit,0,2],[unit,1,3]]);
  assert.equal(combo.lines,2);assert.equal(isOrderIndependent(combo,4),true);
  const shared=positionedPlan([3,0,0],4,[[unit,2,0],[unit,3,0],[unit,0,1]]);
  assert.equal(isOrderIndependent(shared,4),true,'which piece finishes an identical one-row clear can change');
  assert.equal(isOrderIndependent({...shared,target:{hit:111111,hitStep:2}},4),false,'exact target stopping keeps its sequence');
});

test('identical removed rows retain order when changing order splits a combo',()=>{
  const unit=[[0,0]],vertical=[[0,0],[0,1]];
  const combo=positionedPlan([3,3,0],4,[[unit,2,0],[unit,2,1],[vertical,3,0]]);
  assert.deepEqual(combo.moves.map(move=>move.cleared.length),[0,0,2]);
  assert.equal(overlayCells(combo.moves).size,4,'all placement cells are disjoint');
  assert.equal(isOrderIndependent(combo,4),false,'1,200 vs 600 points still requires order');
});

test('clearing occupied cells before reuse requires order even with disjoint recommendation cells',()=>{
  const unit=[[0,0]];
  const dependent=positionedPlan([7,0,0],4,[[unit,3,0],[unit,0,0],[unit,0,1]]);
  assert.equal(overlayCells(dependent.moves).size,3);
  assert.equal(isOrderIndependent(dependent,4),false);
  const {result}=reusedRowPlan();assert.equal(isOrderIndependent(result,4),false);
});
