import test from 'node:test';
import assert from 'node:assert/strict';
import {solve,findSurvival,place} from '../public/solver.js';
const options={rotate:false,reflect:false,gravity:false};
const cells=[[[0,0]],[[0,0],[1,0]],[[0,0],[0,1]]];
const blocks=cells.map((cells,i)=>({name:String(i),cells}));
// Independent exhaustive oracle for the current batch, including repeat shapes.
function possible(board,remaining,gravity=false){
  if(!remaining.length)return true;
  for(let i=0;i<remaining.length;i++)for(let y=0;y<board.length;y++)for(let x=0;x<3;x++){
    const next=board.slice();let valid=true;
    for(const[dx,dy]of remaining[i]){if(x+dx>=3||y+dy>=next.length||(next[y+dy]&(1<<(x+dx)))){valid=false;break;}next[y+dy]|=1<<(x+dx);}
    if(!valid)continue;const cleared=[];for(let row=0;row<next.length;row++)if(next[row]===7){next[row]=0;cleared.push(row);}
    if(gravity&&cleared.length){const keep=next.filter((_,i)=>!cleared.includes(i));next.splice(0,next.length,...Array(cleared.length).fill(0),...keep);}
    if(possible(next,remaining.filter((_,j)=>j!==i),gravity))return true;
  }
  return false;
}

test('one-second ranking retains the high combo score when final boards coincide',()=>{
  const pieces=blocks.map((b,i)=>({id:i,cells:i===0?[[0,0],[0,1]]:[[0,0]]}));
  const result=solve({board:[0,0],cols:3,pieces,catalogue:pieces,skills:{dot:2,reroll:0},options});
  assert.equal(result.complete,true);assert.equal(result.score,1206);assert.equal(result.lineScore,1200);assert.equal(result.method,'fast');
});

test('current survival fallback replays real moves and distinguishes timeout from proven failure',()=>{
  for(const gravity of [false,true])for(const board of [[0,0],[5,5],[3,4],[7,7]])for(const indexes of [[0,1,2],[0,0,1]]){
    const pieces=indexes.map((index,id)=>({...blocks[index],id})),shapes=pieces.map(p=>p.cells);
    const result=findSurvival({board,cols:3,pieces,options:{...options,gravity}},performance.now()+1000);
    assert.equal(!!result.moves,possible(board,shapes,gravity));assert.equal(result.provedImpossible,!result.moves);
    if(result.moves){let current=board;const used=new Set();for(const move of result.moves){assert.deepEqual(move.boardBefore,current);current=place(current,3,move.cells,move.x,move.y,gravity).board;used.add(move.pieceId);}assert.equal(used.size,3);}
  }
  const expired=findSurvival({board:[0,0],cols:3,pieces:blocks,options},performance.now()-1);
  assert.equal(expired.timedOut,true);assert.equal(expired.provedImpossible,false);
});
