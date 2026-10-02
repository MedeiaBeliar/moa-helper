import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {solve,clearScore,actionScore,findSurvival,skillCounts,place} from '../public/solver.js';
import {completePlan,applyReroll,overlayCells} from '../public/plan.js';
import {initialState,validateState,createStore} from '../storage.mjs';

const options={rotate:false,reflect:false,gravity:false,beamWidth:600,timeLimit:5000};
function stateFor(board,cols,shapes,skills){
  const state=initialState();Object.assign(state,{board,cols,rows:board.length,skills,options});
  state.blocks=shapes.map((cells,i)=>({id:`b${i}`,name:`블록${i}`,cells}));
  state.slots=state.blocks.map((block,i)=>({...block,blockId:block.id,instanceId:`s${i}`,used:false}));
  return state;
}
function recommend(state){return solve({...state,pieces:state.slots.filter(s=>!s.used).map(s=>({id:s.instanceId,cells:s.cells}))});}

test('combo points match the supplied 1–5 row table',()=>{
  assert.deepEqual([0,1,2,3,4,5].map(clearScore),[0,300,1200,2700,4800,7500]);
  assert.ok(clearScore(2)>clearScore(1)+clearScore(1));
});

test('piece area and per-action clears are separate; skill use never invents acquisition points',()=>{
  assert.deepEqual(actionScore(6,0),{placementScore:6,lineScore:0,score:6});
  assert.deepEqual(actionScore(8,3),{placementScore:8,lineScore:2700,score:2708});
  assert.deepEqual(actionScore(1,2,'dot'),{placementScore:1,lineScore:1200,score:1201});
  const state=stateFor([0,0],10,[[[0,0]],[[0,0],[1,0]],[[0,0],[1,0],[2,0]]],{dot:0,reroll:0});
  const result=recommend(state),fallback=findSurvival({...state,pieces:state.slots.map(s=>({id:s.instanceId,cells:s.cells}))});
  for(const moves of [result.moves,fallback.moves]){
    assert.equal(moves.reduce((sum,m)=>sum+m.score,0),6);
    for(const move of moves)assert.equal(move.score,move.cells.length+300*move.cleared.length**2);
  }
  assert.equal(result.placementScore,6);assert.equal(result.lineScore,0);assert.equal(result.score,6);
});

test('skills improve a safe batch instead of waiting for trouble or a full inventory',()=>{
  const state=stateFor([0,0],3,[[[0,0],[0,1]],[[0,0]],[[0,0]]],{dot:2,reroll:0});
  const ordinary=recommend({...state,skills:{dot:0,reroll:0}}),result=recommend(state);
  assert.equal(ordinary.complete,true);assert.equal(ordinary.score,304);
  assert.equal(result.complete,true);assert.equal(result.score,1206);assert.equal(result.skillsUsed.dot,2);
  assert.equal(result.placementScore,6);assert.equal(result.lineScore,1200);
  assert.ok(result.moves.some(m=>m.cleared.length===2));assert.equal(result.reroll,null);
  const before=structuredClone(state),next=completePlan(state,result);
  assert.deepEqual(next.board,[0,0]);assert.deepEqual(next.slots,[null,null,null]);assert.deepEqual(next.skills,{dot:0,reroll:0});
  assert.deepEqual(state,before);assert.deepEqual(next.blocks,state.blocks);
});

test('all seven dots can be needed, ordered and replayed; insufficient inventory cannot commit',()=>{
  const line=Array.from({length:8},(_,x)=>[x,0]);
  const state=stateFor([1,1],8,[line,line,line],{dot:7,reroll:0});
  const result=recommend(state);
  assert.equal(result.complete,true);assert.equal(result.skillsUsed.dot,7);assert.equal(result.moves.length,10);
  assert.equal(result.depth,3);assert.equal(result.score,1231);
  assert.equal(result.placementScore,31);assert.equal(result.lineScore,1200);
  const cells=overlayCells(result.moves);assert.ok([...cells.values()].some(orders=>orders.includes(10)));
  assert.deepEqual(completePlan(state,result).skills,{dot:0,reroll:0});
  const fewer={...state,skills:{dot:6,reroll:0}},before=structuredClone(fewer);
  assert.equal(recommend(fewer).complete,false);assert.throws(()=>completePlan(fewer,result),/부족/);assert.deepEqual(fewer,before);
});

test('below seven, retain skills when one placement point does not justify spending them',()=>{
  const state=stateFor([0,0],10,Array(3).fill([[0,0]]),{dot:2,reroll:4});
  const result=recommend(state);assert.equal(result.complete,true);assert.equal(result.score,3);
  assert.deepEqual(result.skillsUsed,{dot:0,reroll:0});assert.equal(result.reroll,null);
});

test('at seven, spend a dot for one point; future ranking cannot restore a full inventory',()=>{
  for(const dot of [1,2])for(const safetyFirst of [false,true]){
    const state=stateFor([0,0],10,Array(3).fill([[0,0]]),{dot,reroll:7-dot});
    state.options={...state.options,lookAhead:true,safetyFirst};
    const before=structuredClone(state),result=solve({...state,catalogue:state.blocks,pieces:state.slots.map(s=>({id:s.instanceId,cells:s.cells}))});
    assert.equal(result.complete,true);assert.equal(result.score,4);assert.equal(result.reroll,null);
    assert.deepEqual(result.skillsUsed,{dot:1,reroll:0});assert.equal(result.moves.length,4);
    const next=completePlan(state,result);assert.equal(next.skills.dot+next.skills.reroll,6);
    assert.deepEqual(next.slots,[null,null,null]);assert.deepEqual(state,before);
  }
});

test('seven rerolls require an actual draw before any placement, even when all pieces fit',()=>{
  const state=stateFor([0,0],10,Array(3).fill([[0,0]]),{dot:0,reroll:7});
  const before=structuredClone(state),result=recommend(state);
  assert.equal(result.complete,false);assert.equal(result.reroll.reason,'capacity');
  assert.equal(result.moves.length,0);assert.deepEqual(result.skillsUsed,{dot:0,reroll:1});
  assert.deepEqual(state,before);assert.throws(()=>completePlan(state,result));
  const next=applyReroll(state,result,'b0');
  assert.deepEqual(next.skills,{dot:0,reroll:6});assert.deepEqual(next.board,state.board);
  assert.ok(next.slots.every(slot=>!slot.used));
  const followup=recommend(next);assert.equal(followup.complete,true);assert.equal(followup.reroll,null);
  assert.deepEqual(completePlan(next,followup).skills,{dot:0,reroll:6});
  const partial={...state,board:[1,0],slots:state.slots.map((slot,i)=>({...slot,used:i===0}))};
  const partialResult=recommend(partial);
  assert.equal(partialResult.reroll.reason,'capacity');assert.notEqual(partialResult.reroll.pieceId,'s0');
  assert.equal(partialResult.moves.length,0);
});

test('completion checks actual remaining inventory, including stale skill-free recommendations',()=>{
  const state=stateFor([0,0],10,Array(3).fill([[0,0]]),{dot:0,reroll:0}),result=recommend(state);
  const full={...state,skills:{dot:1,reroll:6}},before=structuredClone(full);
  assert.throws(()=>completePlan(full,result),/7개 미만/);assert.deepEqual(full,before);
  assert.equal(completePlan({...state,skills:{dot:1,reroll:5}},result).skills.reroll,5);
});

test('short search budgets never declare a seven-skill unchanged plan complete',()=>{
  const state=stateFor(Array(16).fill(0),10,Array(3).fill([[0,0],[0,1],[1,1]]),{dot:1,reroll:6});
  state.options={...state.options,timeLimit:20,beamWidth:8};
  const result=recommend(state);
  if(result.complete){
    assert.equal(result.skillsUsed.dot,1);
    const next=completePlan(state,result);assert.equal(next.skills.dot+next.skills.reroll,6);
  }else{
    assert.throws(()=>completePlan(state,result));
    if(result.reroll)assert.ok(result.skillsUsed.dot+result.skillsUsed.reroll>=1);
  }
});

// Exhaustive independent bit-grid oracle: no solver placement/ranking code is reused.
function oracle(board,cols,shapes,dots){
  const memo=new Map(),full=2**cols-1;
  function visit(rows,mask,left){
    const key=`${rows}/${mask}/${left}`;if(memo.has(key))return memo.get(key);
    const depth=shapes.length-Array.from({length:shapes.length},(_,i)=>Number(!!(mask&(1<<i)))).reduce((a,b)=>a+b,0);
    let best={depth,score:0,dots:0};if(!mask)return best;
    function attempt(cells,x,y,nextMask,nextLeft){
      const next=rows.slice();
      for(const[dx,dy]of cells){if(x+dx>=cols||y+dy>=next.length||(next[y+dy]&(1<<(x+dx))))return;next[y+dy]|=1<<(x+dx);}
      let removed=0;for(let j=0;j<next.length;j++)if(next[j]===full){next[j]=0;removed++;}
      const tail=visit(next,nextMask,nextLeft),candidate={depth:tail.depth,score:300*removed**2+(nextMask!==mask?cells.length:1)+tail.score,dots:tail.dots+Number(nextMask===mask)};
      // A spare skill is worth more than its single placement point. Among
      // equally surviving, equally clearing paths, preserve the most dots.
      const value=candidate.score-candidate.dots,previous=best.score-best.dots;
      if(candidate.depth>best.depth || (candidate.depth===best.depth&&(value>previous||(value===previous&&candidate.dots<best.dots))))best=candidate;
    }
    for(let y=0;y<rows.length;y++)for(let x=0;x<cols;x++){
      for(let i=0;i<shapes.length;i++)if(mask&(1<<i))attempt(shapes[i],x,y,mask^(1<<i),left);
      if(left)attempt([[0,0]],x,y,mask,left-1);
    }
    memo.set(key,best);return best;
  }
  return visit(board,(1<<shapes.length)-1,dots);
}
test('small-board survival and combo score agree with an exhaustive oracle that preserves spare dots',()=>{
  const shapes=[[[0,0]],[[0,0],[1,0]],[[0,0],[0,1]]];
  for(const board of [[0,0],[1,2],[5,2],[3,4],[5,5]])for(const dot of [0,1,2]){
    const expected=oracle(board,3,shapes,dot),result=recommend(stateFor(board,3,shapes,{dot,reroll:0}));
    assert.deepEqual({depth:result.depth,score:result.score,dots:result.skillsUsed.dot},expected,JSON.stringify({board,dot}));
    let current=board;for(const move of result.moves){const next=place(current,3,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(move.boardBefore,current);current=next.board;}
  }
});

test('reroll stops at an unknown outcome, spends only on apply and supports repeated rerolls',()=>{
  const big=Array.from({length:4},(_,x)=>[x,0]),state=stateFor([0,0],3,[big,[[0,0]],[[0,0]]],{dot:0,reroll:2});
  const result=recommend(state),before=structuredClone(state);
  assert.equal(result.complete,false);assert.equal(result.reroll.pieceId,'s0');assert.equal(result.depth,2);
  assert.equal(result.placementScore,2);assert.equal(result.lineScore,0);assert.equal(result.score,2);
  assert.deepEqual(state,before);assert.throws(()=>completePlan(state,result));
  assert.throws(()=>applyReroll(state,result,'missing'));assert.deepEqual(state,before);
  // An unlucky draw can repeat the same shape, with no guessed probabilities.
  const first=applyReroll(state,result,'b0');assert.equal(first.skills.reroll,1);assert.equal(first.slots.filter(s=>s.used).length,2);
  const repeated=recommend(first);assert.equal(repeated.reroll.pieceId,'s0');assert.equal(repeated.moves.length,0);
  const second=applyReroll(first,repeated,'b0');assert.equal(second.skills.reroll,0);assert.equal(recommend(second).reroll,null);
  // Or an actual usable result continues the same batch and can then complete it.
  const success=applyReroll(first,repeated,'b1');assert.equal(success.slots[0].name,'블록1');
  const finish=recommend(success);assert.equal(finish.complete,true);assert.equal(finish.depth,1);
  assert.equal(finish.placementScore,1);assert.equal(finish.score,finish.lineScore+1);
  assert.deepEqual(completePlan(success,finish).slots,[null,null,null]);
  assert.throws(()=>applyReroll(second,repeated,'b1'),/부족/);
});

test('legacy saves default to zero skills, total limit is seven, inventory persists',async()=>{
  const old=initialState();delete old.skills;assert.deepEqual(validateState(old).skills,{dot:0,reroll:0});
  for(const skills of [{dot:8,reroll:0},{dot:4,reroll:4},{dot:-1},{reroll:1.2},{dot:'2'}]){
    assert.throws(()=>skillCounts(skills));assert.throws(()=>validateState({...old,skills}));
  }
  assert.deepEqual(skillCounts({dot:3,reroll:4}),{dot:3,reroll:4});
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-skills-'));
  try{await createStore(dir).write({...old,skills:{dot:3,reroll:4}});assert.deepEqual((await createStore(dir).read()).skills,{dot:3,reroll:4});}
  finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});
