import test from 'node:test';
import assert from 'node:assert/strict';
import {place,variants} from '../public/solver.js';
import {optimizeMoveOrder} from '../public/move-order.js';
import {solveFast} from '../public/fast.js';
import {scoreMoves,targetPath} from '../public/targets.js';
import {completePlan} from '../public/plan.js';
import {initialState} from '../storage.mjs';

function plan(input,actions){
  let board=input.board;
  const moves=actions.map(action=>{
    const placed=place(board,input.cols,action.cells,action.x,action.y,input.options?.gravity);
    assert.ok(placed,'fixture move must be legal');
    const move={...action,cleared:placed.cleared,boardBefore:board,boardAfter:placed.board};
    board=placed.board;return move;
  });
  const scored=scoreMoves(input.currentScore,moves,{skills:input.skills,skillIcons:input.skillIcons});
  return {...scored,board,depth:input.pieces.length,dots:actions.filter(m=>m.kind==='dot').length,
    lines:moves.reduce((sum,m)=>sum+m.cleared.length,0),complete:true,remaining:0};
}
function screenshot(extra={}){
  const shapes=[[[0,0],[2,0],[4,0],[0,1],[1,1],[2,1],[3,1],[4,1]],
    [[0,0],[2,0],[1,1],[0,2],[1,2],[2,2]],[[1,0],[0,1],[1,2]]];
  const pieces=shapes.map((cells,id)=>({id,...variants(cells,false,false)[0]}));
  const input={board:[253,0,320,1008,588,4,76,0,0,170,96,0,0,120,32,0],cols:10,pieces,
    skills:{dot:1,reroll:5},currentScore:0,targetEnabled:false,options:{gravity:false},...extra};
  const actions=pieces.map((piece,i)=>({...piece,kind:'piece',pieceId:piece.id,x:[0,6,8][i],y:9}));
  actions.push({kind:'dot',cells:[[0,0]],x:9,y:10});
  return {input,candidate:plan(input,actions)};
}
function verify(input,candidate){
  const replayed=plan(input,candidate.moves);
  for(let i=0;i<candidate.moves.length;i++){
    assert.deepEqual(candidate.moves[i].boardBefore,replayed.moves[i].boardBefore);
    assert.deepEqual(candidate.moves[i].boardAfter,replayed.moves[i].boardAfter);
    assert.deepEqual(candidate.moves[i].cleared,replayed.moves[i].cleared);
    assert.equal(candidate.moves[i].score,replayed.moves[i].score);
  }
  assert.equal(candidate.score,replayed.score);assert.equal(candidate.lines,replayed.lines);
  return replayed;
}

test('reported 618-point plan becomes 1218 by placing the dot before the last piece',()=>{
  const {input,candidate}=screenshot(),original=structuredClone(candidate);
  assert.equal(candidate.score,618);assert.equal(candidate.lineScore,600);
  const improved=optimizeMoveOrder(input,candidate),replay=verify(input,improved);
  assert.equal(improved.score,1218);assert.equal(improved.lineScore,1200);assert.equal(improved.placementScore,18);
  assert.deepEqual(improved.board,candidate.board);assert.deepEqual(replay.skillsAfter,candidate.skillsAfter);
  assert.ok(improved.moves.findIndex(m=>m.kind==='dot')<improved.moves.findIndex(m=>m.pieceId===2));
  assert.deepEqual(improved.moves.at(-1).cleared,[9,10]);
  assert.deepEqual(candidate,original,'refinement must not mutate the original plan');
  const state={...initialState(),cols:10,rows:16,board:input.board,skills:input.skills,currentScore:0,clearedLines:0,
    slots:input.pieces.map(piece=>({instanceId:piece.id,cells:piece.cells,used:false,drawRecorded:true}))};
  const completed=completePlan(state,improved);
  assert.equal(completed.currentScore,1218);assert.equal(completed.clearedLines,2);
  assert.deepEqual(completed.board,candidate.board);assert.deepEqual(completed.slots,[null,null,null]);
});

test('fixed-order refinement preserves exact targets and approaches that a combo would overshoot',()=>{
  for(const target of [618,1000]){
    const {input,candidate}=screenshot({manualTargets:[target]});
    const improved=optimizeMoveOrder(input,candidate);verify(input,improved);
    assert.equal(improved.score,618);
    if(target===618)assert.equal(targetPath(0,improved.moves,[target]).hit,618);
  }
  const {input,candidate}=screenshot({manualTargets:[1218]});
  const improved=optimizeMoveOrder(input,candidate);verify(input,improved);
  assert.equal(improved.score,1218);assert.equal(targetPath(0,improved.moves,[1218]).hit,1218);
});

test('refinement preserves acquired skills and refuses an order that fills capacity',()=>{
  const skillIcons=[{x:0,y:9,kind:'reroll'}];
  const full=screenshot({skills:{dot:1,reroll:6},skillIcons});
  const kept=optimizeMoveOrder(full.input,full.candidate);verify(full.input,kept);
  assert.equal(kept.score,618);assert.equal(kept.held,6);assert.equal(kept.acquiredCount,0);
  const free=screenshot({skills:{dot:1,reroll:4},skillIcons:[...skillIcons,{x:0,y:10,kind:'dot'}]});
  const improved=optimizeMoveOrder(free.input,free.candidate),replay=verify(free.input,improved);
  assert.equal(improved.score,1318);assert.equal(improved.acquisitionScore,100);
  assert.equal(replay.held,6);assert.deepEqual(replay.skillsAfter,free.candidate.skillsAfter);
});

test('cell reuse and gravity are replayed instead of swapping only display labels',()=>{
  const unit={kind:'piece',cells:[[0,0]],x:1,y:0};
  const input={cols:2,board:[1,0],pieces:[{id:0},{id:1}],skills:{dot:0,reroll:0},options:{gravity:false}};
  const candidate=plan(input,[{...unit,pieceId:0},{...unit,pieceId:1}]);
  const improved=optimizeMoveOrder(input,candidate);verify(input,improved);assert.equal(improved.score,302);
  const gravity={...input,options:{gravity:true}};
  const falling=plan(gravity,[{...unit,pieceId:0},{...unit,pieceId:1,cells:[[0,0],[0,1]],x:0}]);
  const result=optimizeMoveOrder(gravity,falling);verify(gravity,result);assert.deepEqual(result.board,[1,1]);
});

test('deadline and node limits return the original legal plan',()=>{
  const {input,candidate}=screenshot();
  assert.equal(optimizeMoveOrder(input,candidate,{deadline:0}),candidate);
  assert.equal(optimizeMoveOrder(input,candidate,{maxNodes:1}),candidate);
});

test('a three-piece, seven-dot plan reaches its provable fixed-placement score bound',()=>{
  const input={cols:3,board:[0,0,0],pieces:[{id:0},{id:1},{id:2}],skills:{dot:7,reroll:0},currentScore:0,targetEnabled:false};
  const actions=[{kind:'piece',pieceId:0,cells:[[0,0],[0,1]],x:0,y:0},
    {kind:'piece',pieceId:1,cells:[[0,0]],x:1,y:0},
    {kind:'piece',pieceId:2,cells:[[0,0]],x:1,y:1},
    ...[[2,0],[2,1],[0,2],[1,2],[2,2],[0,0],[1,0]].map(([x,y])=>({kind:'dot',cells:[[0,0]],x,y}))];
  const candidate=plan(input,actions),result=optimizeMoveOrder(input,candidate);verify(input,result);
  // Only the vertical piece can clear two rows together; the last row is a
  // separate clear. This is also the upper bound for these fixed placements.
  assert.equal(result.score,1511);assert.equal(result.dots,7);assert.equal(result.held,0);
  assert.deepEqual(result.board,candidate.board);
});

test('published and final fast recommendations have no higher-scoring fixed order',()=>{
  const {input}=screenshot();input.options.timeLimit=250;
  let updates=0;
  function check(result){
    if(!result.complete)return;
    updates++;verify(input,result);
    const improved=optimizeMoveOrder(input,result);
    assert.equal(result.score,improved.score,'refine before exposing a recommendation');
  }
  check(solveFast(input,{onProgress:check}));assert.ok(updates>0);
});
