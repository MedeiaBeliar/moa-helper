import assert from 'node:assert/strict';
import {place,variants} from '../public/solver.js';
export function assertPlan(input,result){
  assert.ok(result&&Array.isArray(result.moves));
  let board=input.board,score=0,dots=0;const used=new Set();
  for(const move of result.moves){
    assert.deepEqual(move.boardBefore,board);
    if(move.kind==='dot'){dots++;assert.deepEqual(move.cells,[[0,0]]);}else{
      const piece=input.pieces.find(p=>p.id===move.pieceId);assert.ok(piece);assert.ok(!used.has(piece.id));used.add(piece.id);
      assert.ok(variants(piece.cells,input.options.rotate,input.options.reflect).some(v=>JSON.stringify(v.cells)===JSON.stringify(move.cells)));
    }
    const next=place(board,input.cols,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(move.boardAfter,next.board);assert.deepEqual(move.cleared,next.cleared);
    score+=(move.kind==='dot'?1:move.cells.length)+300*next.cleared.length**2;board=next.board;
  }
  assert.equal(result.score,score);assert.equal(result.skillsUsed.dot,dots);assert.ok(dots<=input.skills.dot);
  if(result.reroll){assert.ok(input.skills.reroll>0);assert.ok(input.pieces.some(p=>p.id===result.reroll.pieceId&&!used.has(p.id)));}
  if(result.complete){assert.equal(used.size,input.pieces.length);assert.ok(input.skills.dot+input.skills.reroll-dots<7);}
  return board;
}
