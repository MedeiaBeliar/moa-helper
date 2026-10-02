import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPlacements,compilePlacements,countLegalPlacements} from '../public/search.js';
import {variants,canPlace,place} from '../public/solver.js';

function input(board,cols,shapes,skills={dot:0,reroll:0}) {
  return {board,cols,pieces:shapes.map((cells,id)=>({id:`piece-${id}`,cells})),skills,options:{rotate:false,reflect:false}};
}
function replay(source,candidate) {
  let board=source.board,score=0,dots=0;const ids=new Set();
  for(const move of candidate.moves) {
    assert.deepEqual(move.boardBefore,board);
    const next=place(board,source.cols,move.cells,move.x,move.y,source.options?.gravity);assert.ok(next);
    assert.deepEqual(move.cleared,next.cleared);assert.deepEqual(move.boardAfter,next.board);
    assert.equal(move.lineScore,300*next.cleared.length**2);
    assert.equal(move.placementScore,move.kind==='dot'?1:move.cells.length);
    assert.equal(move.score,move.lineScore+move.placementScore);
    if(move.kind==='dot')dots++;else{assert.equal(ids.has(move.pieceId),false);ids.add(move.pieceId);}
    board=next.board;score+=move.score;
  }
  assert.deepEqual(board,candidate.board);assert.equal(score,candidate.score);assert.equal(dots,candidate.dots);
  assert.equal(ids.size,candidate.depth);assert.ok(dots<=source.skills.dot);
}
test('compiled masks count every legal rotated/reflected placement exactly',()=>{
  const cells=[[0,0],[0,1],[0,2],[1,2]],board=[2,0,8,0,0],cols=5;
  for(const rotate of [false,true])for(const reflect of [false,true]) {
    let expected=0;
    for(const variant of variants(cells,rotate,reflect))for(let y=0;y<=board.length-variant.height;y++)for(let x=0;x<=cols-variant.width;x++)if(canPlace(board,cols,variant.cells,x,y))expected++;
    const compiled=compilePlacements(cells,cols,board.length,{rotate,reflect});
    assert.equal(countLegalPlacements(board,compiled),expected);
    assert.equal(countLegalPlacements(board,compiled,1),Math.min(expected,1));
  }
});

// Independent exhaustive search on a tiny board. This checks that mask/dot
// partitioning and identical-shape symmetry pruning preserve attainable scores.
function oracle(source) {
  const full=(1<<source.cols)-1,all=(1<<source.pieces.length)-1,memo=new Map();
  function visit(board,used) {
    if(used===all)return 0;
    const key=`${board}/${used}`;if(memo.has(key))return memo.get(key);
    let best=-Infinity;
    for(let index=0;index<source.pieces.length;index++)if(!(used&(1<<index))) {
      const cells=source.pieces[index].cells;
      for(let y=0;y<board.length;y++)for(let x=0;x<source.cols;x++) {
        const next=board.slice();let valid=true;
        for(const [dx,dy] of cells){if(y+dy>=board.length||x+dx>=source.cols||(next[y+dy]&(1<<(x+dx)))){valid=false;break;}next[y+dy]|=1<<(x+dx);}
        if(!valid)continue;
        let lines=0;for(let row=0;row<next.length;row++)if(next[row]===full){next[row]=0;lines++;}
        best=Math.max(best,cells.length+300*lines**2+visit(next,used|(1<<index)));
      }
    }
    memo.set(key,best);return best;
  }
  return visit(source.board,0);
}
test('fast no-skill search matches an independent score oracle on small boards',()=>{
  const shapes=[[[0,0]],[[0,0],[1,0]],[[0,0],[0,1]]];
  for(const board of [[0,0],[1,2],[5,2],[3,4],[5,5],[6,3]])for(const pieces of [shapes,[shapes[0],shapes[0],shapes[1]]]) {
    const source=input(board,3,pieces),before=structuredClone(source),expected=oracle(source);
    const result=searchPlacements(source,{deadline:performance.now()+1000,width:600,evaluate:()=>0});
    assert.equal(result.candidates[0]?.score??-Infinity,expected,JSON.stringify(source));
    for(const candidate of result.candidates)replay(source,candidate);
    assert.deepEqual(source,before);
  }
});
test('dot preparations create two-row combos and all seven dots can rescue a batch',()=>{
  const combo=input([0,0],3,[[[0,0],[0,1]],[[0,0]],[[0,0]]],{dot:2,reroll:0});
  const result=searchPlacements(combo,{deadline:performance.now()+1000,width:100,evaluate:()=>0});
  assert.equal(result.candidates[0].score,1206);assert.equal(result.candidates[0].dots,2);
  for(const candidate of result.candidates)replay(combo,candidate);
  const line=Array.from({length:8},(_,x)=>[x,0]),rescue=input([1,1],8,[line,line,line],{dot:7,reroll:0});
  const rescued=searchPlacements(rescue,{deadline:performance.now()+1000,width:100,evaluate:()=>0});
  assert.equal(rescued.candidates[0].dots,7);assert.equal(rescued.candidates[0].depth,3);
  assert.equal(rescued.candidates[0].score,1231);replay(rescue,rescued.candidates[0]);
});
test('seven skills require a spent dot; unknown rerolls never become complete candidates',()=>{
  const source=input([0,0],10,Array(3).fill([[0,0]]),{dot:1,reroll:6});
  let snapshots=0;
  const result=searchPlacements(source,{deadline:performance.now()+1000,width:40,onCandidate:c=>{snapshots++;assert.equal(c.dots,1);replay(source,c);}});
  assert.ok(snapshots>0);assert.ok(result.candidates.length>0);
  for(const candidate of result.candidates){assert.equal(candidate.dots,1);replay(source,candidate);}
  source.skills={dot:0,reroll:7};
  const unknown=searchPlacements(source,{deadline:performance.now()+1000,width:40});
  assert.deepEqual(unknown.candidates,[]);assert.equal(unknown.bestPartial.depth,3);
});
test('search respects absolute deadlines and callbacks retain a replayable complete witness',()=>{
  const source=input(Array(16).fill(0),10,Array(3).fill([[0,0],[0,1],[1,1]]),{dot:3,reroll:0});
  source.options={rotate:true,reflect:true};
  const started=performance.now(),snapshots=[];
  const result=searchPlacements(source,{deadline:started+200,width:600,onCandidate:c=>snapshots.push(c)});
  assert.ok(performance.now()-started<750);
  assert.equal(result.timedOut,true);assert.ok(snapshots.length>0);
  for(const candidate of [...snapshots,...result.candidates])replay(source,candidate);
  assert.ok(result.candidates.length<=81);
});
