import test from 'node:test';
import assert from 'node:assert/strict';
import {solveFast} from '../public/fast.js';
import {searchPlacements} from '../public/search.js';
import {place} from '../public/solver.js';
import {scoreMoves,targetPath,activeTargets} from '../public/targets.js';

const unit=[[0,0]],domino=[[0,0],[1,0]],vertical=[[0,0],[0,1]],square=[[0,0],[1,0],[0,1],[1,1]];
function source(board,cols,shapes,currentScore,extra={}){
  return {board,cols,pieces:shapes.map((cells,id)=>({id,cells})),skills:{dot:0,reroll:0},
    targetEnabled:true,currentScore,options:{rotate:false,reflect:false,timeLimit:300},...extra};
}
function verify(input,result){
  let board=input.board;const used=new Set();let dots=0;
  for(const move of result.moves){
    assert.deepEqual(move.boardBefore,board);
    const placed=place(board,input.cols,move.cells,move.x,move.y);assert.ok(placed);
    assert.deepEqual(move.cleared,placed.cleared);assert.deepEqual(move.boardAfter,placed.board);board=placed.board;
    if(move.kind==='dot')dots++;else{assert.ok(!used.has(move.pieceId));used.add(move.pieceId);}
  }
  const replay=scoreMoves(input.currentScore,result.moves,{skills:input.skills,skillIcons:input.skillIcons});
  assert.equal(result.score,replay.score);assert.equal(result.acquisitionScore,replay.acquisitionScore);
  assert.ok(dots<=input.skills.dot,'newly acquired skills are not speculated into the current plan');
  if(result.complete){assert.equal(used.size,input.pieces.length);assert.ok(replay.held<7);}
  if(result.target?.status==='hit'){
    const path=targetPath(input.currentScore,replay.moves,activeTargets(input));assert.equal(result.target.hit,path.hit);assert.equal(result.target.hitStep,path.hitStep);
    assert.ok(replay.moves[path.hitStep-1].heldSkills<7);
  }
  return replay;
}

test('a target prefix is chosen while retaining a legal plan for all three pieces',()=>{
  const input=source([1,1],2,[vertical,unit,unit],110810);
  const result=solveFast(input);verify(input,result);
  assert.equal(result.complete,true);assert.equal(result.target.status,'hit');assert.equal(result.target.hit,111111);
  assert.equal(result.target.hitStep,1);assert.equal(result.moves[0].score,301);
});

test('manual-only and combined target lists participate in safe prefix search',()=>{
  for(const targetEnabled of [false,true]){
    const input=source([1,1],2,[vertical,unit,unit],476,{targetEnabled,manualTargets:[777,123456]});
    const result=solveFast(input);verify(input,result);
    assert.equal(result.complete,true);assert.equal(result.target.status,'hit');assert.equal(result.target.hit,777);assert.equal(result.target.hitStep,1);
  }
  const input=source([0,0],5,[unit,unit,unit],99999,{manualTargets:[222223]});
  const result=solveFast(input);verify(input,result);assert.equal(result.target.hit,100000);
});

test('equal boards retain distinct prefix hits and lower scoring split-clear paths',()=>{
  const input=source([1,1],2,[vertical,unit,unit],110810);
  const result=searchPlacements(input,{deadline:performance.now()+1000,width:600,evaluate:()=>0});
  const hit=c=>targetPath(input.currentScore,c.moves).hit;
  assert.ok(result.candidates.some(a=>hit(a)&&result.candidates.some(b=>!hit(b)&&a.score===b.score&&String(a.board)===String(b.board))),
    'equal total scores must not erase different intermediate targets');
  assert.ok(result.candidates.some(a=>hit(a)&&result.candidates.some(b=>!hit(b)&&a.score<b.score&&String(a.board)===String(b.board))),
    'higher combo score must not erase a lower combo that hits the target');
});

test('retained goals from 100000 are accepted automatically',()=>{
  for(const score of [99999,111110,120199]){
    const input=source([0,0],5,[unit,unit,unit],score),result=solveFast(input);verify(input,result);
    assert.equal(result.target.status,'hit');assert.equal(result.target.hit,score+1);
  }
});

test('removed targets below 100000 do not alter the ordinary scoring policy',()=>{
  for(const score of [69739,77776,88887,99998]){
    const input=source([0,0],5,[unit,unit,unit],score),result=solveFast(input);verify(input,result);
    const ordinary=solveFast({...input,targetEnabled:false});
    if(score===99998){assert.equal(result.target.hit,100000);continue;}
    assert.equal(result.target.hit,null);assert.equal(result.target.status,'fallback');
    assert.equal(result.score,ordinary.score);assert.equal(result.target.next,100000);
  }
});

test('an exact target on a dead-end partial path never replaces a complete batch',()=>{
  // Unit + domino can total 3, but on this board doing so leaves no place for
  // the square. The surviving order passes the target instead.
  const input=source([0,0],3,[unit,domino,square],111108),result=solveFast(input);verify(input,result);
  assert.equal(result.complete,true);assert.equal(result.target.status,'fallback');assert.equal(result.target.hit,null);
  assert.ok(result.score>=307);
});

test('near targets avoid overshooting only when the geometry remains safe',()=>{
  const input=source([3,0,0,0],4,[domino,domino,domino],111034),result=solveFast(input);verify(input,result);
  assert.equal(result.target.status,'approach');assert.equal(result.score,6);assert.equal(result.target.after,111040);
  const guarded={...input,catalogue:[{id:'square',cells:square}]},normal=solveFast({...guarded,targetEnabled:false}),safe=solveFast(guarded);
  verify(guarded,safe);assert.equal(safe.target.status,'fallback');assert.equal(safe.score,normal.score);
  assert.ok(safe.score>result.score);
});

test('distant and passed goals keep the high-score policy, unknown scores are explicit',()=>{
  const input=source([1,1],2,[vertical,unit,unit],100),ordinary=solveFast({...input,targetEnabled:false}),far=solveFast(input);
  verify(input,far);assert.equal(far.target.status,'fallback');assert.equal(far.score,ordinary.score);
  assert.equal(ordinary.target,undefined);
  const unknown=solveFast({...input,currentScore:null});assert.equal(unknown.target.status,'unknown');assert.equal(unknown.target.after,null);
  const passed=solveFast({...input,currentScore:450001});assert.equal(passed.target.status,'complete');assert.equal(passed.target.next,null);
});

test('known skill acquisition contributes 50 points to target matching',()=>{
  const input=source([1,0],2,[unit,unit,unit],110760,{skillIcons:[{x:0,y:0,kind:'dot'}]}),result=solveFast(input);
  const replay=verify(input,result);assert.equal(result.target.status,'hit');assert.equal(result.target.hit,111111);
  assert.equal(result.moves[0].score,351);assert.equal(result.acquisitionScore,50);assert.equal(replay.acquiredCount,1);
  assert.equal(result.skillsUsed.dot,0);
});

test('a dot alone can supply the one point needed for an exact target',()=>{
  const input=source([0,0],10,[domino,domino,domino],111110,{skills:{dot:1,reroll:0}});
  const result=solveFast(input);verify(input,result);
  assert.equal(result.complete,true);assert.equal(result.target.status,'hit');
  assert.equal(result.target.hit,111111);assert.equal(result.target.hitStep,1);
  assert.equal(result.moves[0].kind,'dot');assert.equal(result.moves[0].score,1);
  assert.equal(result.moves[0].acquisitionScore,0);assert.deepEqual(result.moves[0].cleared,[]);
});

test('target stopping waits for seven-skill capacity to be spent down',()=>{
  const input=source([1,0],2,[unit,unit,unit],110760,{skills:{dot:1,reroll:5},skillIcons:[{x:0,y:0,kind:'reroll'}]});
  const result=solveFast(input),replay=verify(input,result);
  assert.equal(result.complete,true);assert.equal(result.skillsUsed.dot,1);assert.equal(result.target.status,'hit');
  assert.equal(result.target.hit,111111);assert.ok(replay.moves[result.target.hitStep-1].heldSkills<7);
  for(const move of replay.moves.slice(0,result.target.hitStep-1))if(move.scoreAfter===111111)assert.equal(move.heldSkills,7);
});

test('a full reroll inventory still requires an actual reroll before any target plan',()=>{
  const input=source([0,0],5,[unit,unit,unit],99999,{skills:{dot:0,reroll:7}}),result=solveFast(input);verify(input,result);
  assert.equal(result.complete,false);assert.equal(result.reroll.reason,'capacity');assert.equal(result.target.status,'fallback');
});

test('discarded markers do not merge different held-skill counts on the same board',()=>{
  // Both paths can clear the same marked rows after using the same pieces and
  // dots. A marker discarded at capacity and one acquired before a dot is spent
  // leave different inventories. Keeping only the higher-score prefix used to
  // erase the legal continuation below and reduce the best utility to 1904.
  const input=source([3,6,1],3,[vertical,domino,square],0,{
    targetEnabled:false,skills:{dot:2,reroll:4},
    skillIcons:[0,1,2].map(y=>({x:0,y,kind:'dot'}))
  });
  const found=searchPlacements(input,{deadline:performance.now()+1000,width:1200,
    evaluate:board=>-board.reduce((sum,row)=>sum+row,0)});
  const complete=found.candidates.find(candidate=>candidate.score===2210&&candidate.board.every(row=>row===0));
  assert.ok(complete,'retain the 2210-point empty-board continuation with six held skills');
  assert.equal(complete.depth,3);assert.equal(complete.dots,2);assert.equal(complete.acquiredCount,2);
  const replay=scoreMoves(input.currentScore,complete.moves,{skills:input.skills,skillIcons:input.skillIcons});
  assert.equal(replay.score,2210);assert.equal(replay.held,6);assert.deepEqual(replay.icons,[]);
  let board=input.board;const used=new Set();
  for(const move of complete.moves){
    const placed=place(board,input.cols,move.cells,move.x,move.y);assert.ok(placed);
    assert.deepEqual(move.boardBefore,board);assert.deepEqual(move.cleared,placed.cleared);board=placed.board;
    if(move.kind==='piece'){assert.ok(!used.has(move.pieceId));used.add(move.pieceId);}
  }
  assert.equal(used.size,3);assert.deepEqual(board,[0,0,0]);
});

test('an incomplete exact-score prefix never announces a safe target stop',()=>{
  const oversizedHorizontal=[[0,0],[1,0],[2,0]],oversizedVertical=[[0,0],[0,1],[0,2]];
  const input=source([0,0],2,[unit,oversizedHorizontal,oversizedVertical],99999),result=solveFast(input);
  verify(input,result);
  assert.equal(result.complete,false);assert.equal(result.depth,1);assert.equal(result.target.after,100000);
  assert.equal(result.target.status,'fallback');assert.equal(result.target.hit,null);assert.equal(result.target.hitStep,null);
});
