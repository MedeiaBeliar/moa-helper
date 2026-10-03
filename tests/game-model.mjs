// Simulator rules transcribed from the user-supplied official event image.
// Probability tables by stage are unpublished. The runner supplies observed
// weights; icon coordinates use an explicitly labelled uniform-empty-cell model.
import {variants,canPlace,place} from '../public/solver.js';

export const stageFor=lines=>lines<=30?1:lines<=60?2:lines<=100?3:lines<=150?4:5;
export function randomStream(seed){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296;};}
export function drawIndex(weights,random){let value=random()*weights.reduce((s,n)=>s+n,0);for(let i=0;i<weights.length;i++){value-=weights[i];if(value<0)return i;}return weights.length-1;}
export function createGame(){return {board:Array(16).fill(0),cols:10,skills:{dot:0,reroll:0},icons:[],pieces:[],nextId:0,placements:0,lines:0,score:0,rawScore:0,placementScore:0,lineScore:0,acquisitionScore:0,batches:0,dotsUsed:0,rerollsUsed:0,skillsAcquired:0,spawned:0,expired:0,stage:1};}
export function deal(game,catalogue,weights,random){
  if(game.pieces.some(p=>!p.used))throw new Error('Cannot draw a new batch before consuming all three pieces.');
  game.pieces=Array.from({length:3},()=>{const index=drawIndex(weights,random);return {...catalogue[index],id:`p${game.nextId++}`,catalogueIndex:index,used:false};});
  game.batches++;
}
export function legalMoves(game){
  const moves=[];
  for(const p of game.pieces)if(!p.used)for(const v of variants(p.cells))for(let y=0;y<=game.board.length-v.height;y++)for(let x=0;x<=game.cols-v.width;x++)
    if(canPlace(game.board,game.cols,v.cells,x,y))moves.push({kind:'piece',pieceId:p.id,...v,x,y});
  return moves;
}
export function isDead(game){return game.pieces.some(p=>!p.used)&&game.skills.dot+game.skills.reroll===0&&legalMoves(game).length===0;}
function addScore(game,amount,key){game[key]+=amount;game.rawScore+=amount;game.score=Math.min(500000,game.rawScore);}
export function playMove(game,move,randomIcon,randomType){
  if(!Number.isInteger(move.x)||!Number.isInteger(move.y))throw new Error('Non-integer placement coordinates');
  if(move.kind&&move.kind!=='piece'&&move.kind!=='dot')throw new Error('Unknown move kind');
  const isDot=move.kind==='dot',piece=game.pieces.find(p=>p.id===move.pieceId&&!p.used);
  if(isDot){if(game.skills.dot<1)throw new Error('No dot skill');if(JSON.stringify(move.cells)!=='[[0,0]]')throw new Error('Invalid dot shape');}
  else if(!piece||!variants(piece.cells).some(v=>JSON.stringify(v.cells)===JSON.stringify(move.cells)))throw new Error('Illegal piece or transformation');
  const placed=place(game.board,game.cols,move.cells,move.x,move.y);if(!placed)throw new Error('Collision in simulator');
  if(isDot){game.skills.dot--;game.dotsUsed++;addScore(game,1,'placementScore');}else{piece.used=true;game.placements++;addScore(game,piece.cells.length,'placementScore');}
  game.board=placed.board;game.lines+=placed.cleared.length;game.stage=stageFor(game.lines);addScore(game,300*placed.cleared.length**2,'lineScore');
  // A full inventory leaves the icon on its original cell, even after a clear.
  const kept=[];
  for(const icon of game.icons){
    if(!placed.cleared.includes(icon.y)){kept.push(icon);continue;}
    if(game.skills.dot+game.skills.reroll<7){game.skills[icon.kind]++;game.skillsAcquired++;addScore(game,50,'acquisitionScore');}
    else kept.push(icon);
  }
  game.icons=kept;
  // Resolve the placement/clear first, then spawn on a remaining empty tile.
  if(!isDot&&game.placements%7===0&&game.skills.dot+game.skills.reroll<7){
    const empty=[];for(let y=0;y<game.board.length;y++)for(let x=0;x<game.cols;x++)
      if(!(game.board[y]&(1<<x))&&!game.icons.some(icon=>icon.x===x&&icon.y===y))empty.push({x,y});
    if(empty.length){
      const position=empty[Math.min(empty.length-1,Math.floor(randomIcon()*empty.length))];
      game.icons.push({...position,kind:randomType()<.4?'dot':'reroll'});game.spawned++;
      if(game.icons.length>3){game.icons.shift();game.expired++;}
    }
  }
  return placed;
}
export function rerollPiece(game,pieceId,catalogue,weights,random){
  const index=game.pieces.findIndex(p=>p.id===pieceId&&!p.used);if(index<0||game.skills.reroll<1)throw new Error('Invalid reroll');
  const next=drawIndex(weights,random);game.pieces[index]={...catalogue[next],id:pieceId,catalogueIndex:next,used:false};game.skills.reroll--;game.rerollsUsed++;
}
