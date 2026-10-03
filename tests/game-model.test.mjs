import test from 'node:test';import assert from 'node:assert/strict';
import {createGame,deal,legalMoves,isDead,playMove,rerollPiece,stageFor} from './game-model.mjs';
const dot={name:'.',cells:[[0,0]]},line={name:'ㅡ',cells:[[0,0],[1,0]]};
test('stage boundaries match cumulative cleared lines',()=>{
  assert.deepEqual([0,30,31,60,61,100,101,150,151].map(stageFor),[1,1,2,2,3,3,4,4,5]);
});

test('malformed coordinates cannot silently become a legal placement',()=>{
  const game=createGame();game.pieces=[{...dot,id:'x'}];const before=structuredClone(game);
  for(const value of [.5,NaN,undefined,'0'])assert.throws(()=>playMove(game,{pieceId:'x',cells:[[0,0]],x:value,y:0},()=>0,()=>0));
  assert.throws(()=>playMove(game,{kind:'unexpected',pieceId:'x',cells:[[0,0]],x:0,y:0},()=>0,()=>0));
  assert.deepEqual(game,before);
});
test('search failure and a partly used batch are not death; legal moves and held skills decide',()=>{
  const game=createGame();game.board=[341,682];game.pieces=[{...line,id:'x'}];
  assert.equal(legalMoves(game).length,0);assert.equal(isDead(game),true);
  game.skills.reroll=1;assert.equal(isDead(game),false);rerollPiece(game,'x',[dot],[1],()=>0);
  assert.equal(isDead(game),false);assert.ok(legalMoves(game).length);
  game.pieces[0].used=true;assert.equal(isDead(game),false);deal(game,[dot],[1],()=>0);assert.equal(game.pieces.length,3);
  assert.throws(()=>deal(game,[dot],[1],()=>0));
});
test('seven piece placements spawn an icon; dot skills do not advance spawn count',()=>{
  const game=createGame();game.skills.dot=1;game.placements=6;game.pieces=[{...dot,id:'x'}];
  playMove(game,{kind:'dot',cells:[[0,0]],x:0,y:1},()=>0,()=>0);assert.equal(game.placements,6);assert.equal(game.icons.length,0);
  assert.equal(game.score,1);assert.equal(game.placementScore,1);assert.equal(game.dotsUsed,1);
  playMove(game,{kind:'piece',pieceId:'x',cells:[[0,0]],x:0,y:0},()=>0,()=>.39);
  assert.equal(game.icons.length,1);assert.equal(game.icons[0].kind,'dot');assert.equal(game.placements,7);
  assert.equal(game.board[game.icons[0].y]&(1<<game.icons[0].x),0);
});

test('dot placement adds one point alongside clear and acquisition bonuses, with the score cap intact',()=>{
  const game=createGame();game.board[0]=511;game.skills={dot:2,reroll:5};
  game.icons=[{x:0,y:0,kind:'reroll'}];
  playMove(game,{kind:'dot',cells:[[0,0]],x:9,y:0},()=>0,()=>0);
  assert.equal(game.score,351);assert.equal(game.rawScore,351);
  assert.equal(game.placementScore,1);assert.equal(game.lineScore,300);assert.equal(game.acquisitionScore,50);
  assert.equal(game.placements,0);assert.equal(game.dotsUsed,1);assert.equal(game.icons.length,0);
  assert.deepEqual(game.skills,{dot:1,reroll:6});
  game.score=500000;game.rawScore=500000;
  playMove(game,{kind:'dot',cells:[[0,0]],x:0,y:0},()=>0,()=>0);
  assert.equal(game.score,500000);assert.equal(game.rawScore,500001);assert.equal(game.placementScore,2);
});
test('at capacity a cleared icon stays on its cell and the seventh placement cannot spawn another',()=>{
  const game=createGame();game.board[0]=511;game.icons=[{x:0,y:0,kind:'reroll'}];game.pieces=[{...dot,id:'x'}];
  playMove(game,{pieceId:'x',cells:[[0,0]],x:9,y:0},()=>0,()=>0);
  assert.equal(game.skills.reroll,1);assert.equal(game.icons.length,0);assert.equal(game.score,351);
  game.board[0]=511;game.icons=[{x:4,y:0,kind:'dot'}];game.skills={dot:3,reroll:4};game.placements=6;game.pieces=[{...dot,id:'y'}];
  playMove(game,{pieceId:'y',cells:[[0,0]],x:9,y:0},()=>0,()=>0);
  assert.equal(game.icons.length,1);assert.equal(game.expired,0);assert.equal(game.skills.dot+game.skills.reroll,7);assert.equal(game.spawned,0);assert.equal(game.acquisitionScore,50);
  assert.deepEqual(game.icons[0],{x:4,y:0,kind:'dot'});
  game.board[0]=511;
  playMove(game,{kind:'dot',cells:[[0,0]],x:9,y:0},()=>0,()=>0);
  assert.equal(game.icons.length,0);assert.equal(game.acquisitionScore,100);
  assert.equal(game.placements,7);assert.equal(game.spawned,0);
  assert.deepEqual(game.skills,{dot:3,reroll:4},'spending a dot makes room to collect the retained icon');
});
test('fourth spawn expires the oldest icon and a 40 percent boundary selects reroll',()=>{
  const game=createGame();game.icons=[{x:5,y:1,kind:'dot'},{x:6,y:1,kind:'dot'},{x:7,y:1,kind:'dot'}];game.placements=6;game.pieces=[{...dot,id:'x'}];
  playMove(game,{pieceId:'x',cells:[[0,0]],x:0,y:0},()=>0,()=>.4);
  assert.equal(game.icons.length,3);assert.equal(game.icons[0].x,6);assert.equal(game.icons.at(-1).kind,'reroll');assert.equal(game.expired,1);
});

test('every seventh ordinary placement spawns an icon and only the oldest expires on the fourth spawn',()=>{
  for(const held of [0,7]){
    const game=createGame(),appearances=[];
    game.skills.reroll=held;
    for(let index=0;index<28;index++){
      game.pieces=[{...dot,id:`p${index}`}];
      // Half-filled rows never clear; icons spawn at the opposite end of the board.
      playMove(game,{pieceId:`p${index}`,cells:[[0,0]],x:index%5,y:Math.floor(index/5)},()=>.999,()=>.4);
      if(held<7&&(index+1)%7===0)appearances.push({...game.icons.at(-1)});
      assert.equal(game.spawned,held<7?Math.floor((index+1)/7):0);
      assert.deepEqual(game.icons,appearances.slice(-3));
      assert.equal(game.expired,Math.max(0,appearances.length-3));
      assert.equal(game.score,index+1);assert.equal(game.skillsAcquired,0);
    }
    assert.equal(appearances.length,held<7?4:0);assert.equal(game.icons.length,held<7?3:0);
    if(held<7)assert.equal(game.icons.some(icon=>icon.x===appearances[0].x&&icon.y===appearances[0].y),false);
  }
});

test('collection fills the last inventory slot before the spawn attempt; skipped spawns consume no randomness',()=>{
  const game=createGame();game.skills={dot:0,reroll:6};game.placements=6;
  game.icons=[{x:0,y:0,kind:'dot'},{x:2,y:0,kind:'reroll'},{x:5,y:1,kind:'dot'}];
  game.board[0]=511;game.pieces=[{...dot,id:'x'}];
  const noDraw=()=>assert.fail('a blocked spawn must not draw a position or type');
  playMove(game,{pieceId:'x',cells:[[0,0]],x:9,y:0},noDraw,noDraw);
  assert.deepEqual(game.skills,{dot:1,reroll:6});assert.equal(game.acquisitionScore,50);
  assert.deepEqual(game.icons,[{x:2,y:0,kind:'reroll'},{x:5,y:1,kind:'dot'}]);
  assert.equal(game.expired,0);assert.equal(game.spawned,0);
  // Ordinary placements keep advancing the seven-placement cycle at capacity.
  game.placements=13;game.pieces=[{...dot,id:'y'}];
  rerollPiece(game,'y',[dot],[1],()=>0);
  playMove(game,{pieceId:'y',cells:[[0,0]],x:0,y:2},()=>.999,()=>.4);
  assert.equal(game.spawned,1);assert.equal(game.icons.length,3);assert.equal(game.icons.at(-1).kind,'reroll');
});

test('collecting a middle icon preserves age order, and clearing an expired icon location grants no skill or bonus',()=>{
  const game=createGame(),oldest={x:5,y:1,kind:'dot'},newest={x:7,y:3,kind:'dot'};
  game.icons=[oldest,{x:6,y:2,kind:'reroll'},newest];game.spawned=3;
  game.placements=6;game.board[2]=511;game.pieces=[{...dot,id:'collect'}];
  playMove(game,{pieceId:'collect',cells:[[0,0]],x:9,y:2},()=>.999,()=>.4);
  assert.deepEqual(game.icons,[oldest,newest,{x:9,y:15,kind:'reroll'}]);
  assert.equal(game.expired,0);assert.equal(game.acquisitionScore,50);assert.equal(game.skillsAcquired,1);
  game.placements=13;game.pieces=[{...dot,id:'expire'}];
  playMove(game,{pieceId:'expire',cells:[[0,0]],x:0,y:0},()=>.999,()=>.4);
  assert.deepEqual(game.icons,[newest,{x:9,y:15,kind:'reroll'},{x:8,y:15,kind:'reroll'}]);
  assert.equal(game.expired,1);
  const score=game.score;game.board[1]=511;game.pieces=[{...dot,id:'clear-expired'}];
  playMove(game,{pieceId:'clear-expired',cells:[[0,0]],x:9,y:1},()=>.999,()=>.4);
  assert.equal(game.score,score+301);assert.equal(game.acquisitionScore,50);assert.equal(game.skillsAcquired,1);
  assert.deepEqual(game.skills,{dot:0,reroll:1});
  assert.equal(game.spawned,game.icons.length+game.skillsAcquired+game.expired);
});
