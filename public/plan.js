import { place, variants, skillCounts } from './solver.js';
import { recordNormalDraws, recordRerollDraw, addClearedLines,stageForLines } from './statistics.js';
import {scoreMoves,isTargetScore,activeTargets} from './targets.js';
import {advanceSpawnRemaining,remainingIconOrder} from './abilities.js';

// Three ordinary pieces have at most six orders. Hide labels only when all of
// them work at the shown coordinates and preserve the clear/combo result.
// Skills and exact-score stopping points still carry an execution order.
export function isOrderIndependent(result, cols) {
  if(!result?.complete||result.reroll||result.target?.hit||!result.moves?.length||result.moves.length>3
    ||result.moves.some(move=>move.kind&&move.kind!=='piece'||!Array.isArray(move.cleared)))return false;
  const moves=result.moves,occupied=new Set();
  for(const move of moves){
    if(!Number.isInteger(move.x)||!Number.isInteger(move.y)||!move.cells?.length)return false;
    for(const [dx,dy] of move.cells){
      const key=`${move.x+dx},${move.y+dy}`;
      if(occupied.has(key))return false;occupied.add(key);
    }
  }
  // No row removal can change cells or placement order in an already verified
  // complete plan; keep this common path cheap for repeated canvas redraws.
  if(result.lines===0&&moves.every(move=>move.cleared.length===0))return true;
  const initial=moves[0].boardBefore;
  if(!Number.isInteger(cols)||cols<2||cols>20||!Array.isArray(initial))return false;
  const expectedClears=moves.flatMap(move=>move.cleared).sort((a,b)=>a-b);
  const expectedScore=moves.reduce((sum,move)=>sum+300*move.cleared.length**2,0);
  let expectedBoard=initial;
  for(const move of moves){
    const placed=place(expectedBoard,cols,move.cells,move.x,move.y);
    if(!placed||String(placed.cleared)!==String(move.cleared))return false;
    expectedBoard=placed.board;
  }
  function check(board,mask,clears,score){
    if(mask===(1<<moves.length)-1)return String(board)===String(expectedBoard)
      &&String(clears.sort((a,b)=>a-b))===String(expectedClears)&&score===expectedScore;
    for(let i=0;i<moves.length;i++)if(!(mask&(1<<i))){
      const move=moves[i],next=place(board,cols,move.cells,move.x,move.y);
      if(!next||!check(next.board,mask|(1<<i),clears.concat(next.cleared),score+300*next.cleared.length**2))return false;
    }
    return true;
  }
  return check(initial,0,[],0);
}

// A cell can be reused after a line clears. Keep every order label at that location.
export function overlayCells(moves, selected = -2) {
  const cells = new Map();
  moves.forEach((move, index) => {
    if (selected !== -2 && selected !== index) return;
    for (const [dx, dy] of move.cells) {
      const key = `${move.x + dx},${move.y + dy}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(index + 1);
    }
  });
  return cells;
}

// Replay before committing anything, including intermediate clears and skill costs.
function replay(state, result) {
  const remaining = state.slots.filter(slot => slot && !slot.used);
  if(!remaining.length || state.slots.some(slot=>!slot) || !Array.isArray(result?.moves)) throw new Error('보유 조각을 확인하고 추천을 다시 찾아 주세요.');
  let board = state.board.slice(),clearedLines=state.clearedLines??null;
  const used = new Set(), skills=skillCounts(state.skills),actualMoves=[];
  for (const move of result.moves) {
    if (JSON.stringify(move.boardBefore) !== JSON.stringify(board)) throw new Error('보드가 변경됐습니다. 추천을 다시 찾아 주세요.');
    let allowed;
    if(move.kind==='dot') {
      if(skills.dot<1)throw new Error('점 찍기 스킬이 부족합니다. 보유 개수를 확인해 주세요.');
      allowed=[{cells:[[0,0]]}];skills.dot--;
    } else {
      if(move.kind && move.kind!=='piece')throw new Error('알 수 없는 추천 동작입니다.');
      const slot = remaining.find(slot => slot.instanceId === move.pieceId);
      if (!slot || used.has(move.pieceId)) throw new Error('보유 조각이 변경됐습니다. 추천을 다시 찾아 주세요.');
      allowed = variants(slot.cells, state.options.rotate, state.options.reflect);
      used.add(move.pieceId);
    }
    if (!allowed.some(shape => JSON.stringify(shape.cells) === JSON.stringify(move.cells))) throw new Error('블록 모양이 변경됐습니다. 추천을 다시 찾아 주세요.');
    if (!Number.isInteger(move.x) || !Number.isInteger(move.y)) throw new Error('추천 좌표가 올바르지 않습니다.');
    const next = place(board, state.cols, move.cells, move.x, move.y, state.options.gravity);
    if (!next) throw new Error('추천 위치에 배치할 수 없습니다. 추천을 다시 찾아 주세요.');
    board = next.board;
    clearedLines=addClearedLines(clearedLines,next.cleared.length);
    actualMoves.push({...move,cleared:next.cleared});
    // A native plan may spend a known dot acquired by an earlier row clear.
    Object.assign(skills,scoreMoves(state.currentScore,actualMoves,{skillIcons:state.skillIcons,skills:state.skills}).skillsAfter);
  }
  const scored=scoreMoves(state.currentScore,actualMoves,{skillIcons:state.skillIcons,skills:state.skills});
  return {...state,board,skills:scored.skillsAfter,skillIcons:scored.icons,skillIconOrder:remainingIconOrder(state,scored.icons),
    skillSpawnRemaining:advanceSpawnRemaining(state.skillSpawnRemaining,used.size),currentScore:scored.after,clearedLines,slots:state.slots.map(slot=>({...slot,used:slot.used||used.has(slot.instanceId)}))};
}

export function completePlan(state, result) {
  if(!result?.complete || result.reroll)throw new Error('남은 조각을 모두 배치하는 추천을 찾은 뒤 완료해 주세요.');
  const next=replay(confirmPlacedDraws(state,result.moves),result);
  if(next.slots.some(slot=>!slot.used))throw new Error('남은 조각을 모두 배치하는 추천을 찾은 뒤 완료해 주세요.');
  if(next.skills.dot+next.skills.reroll>=7)throw new Error('스킬을 최소 1개 사용해 합계 7개 미만으로 만드는 추천을 다시 찾아 주세요.');
  return {...next,slots:[null,null,null]};
}
function confirmPlacedDraws(state,moves){
  return recordNormalDraws(state,{confirmedIds:(moves||[]).filter(move=>move.kind!=='dot').map(move=>move.pieceId)});
}

// The whole batch still has a verified continuation, but the player can stop
// at an intermediate exact score instead of accidentally playing past it.
export function applyTargetPlan(state,result){
  const step=result?.target?.hitStep;
  if(!result?.complete||result.reroll||!Number.isInteger(step)||step<1||step>result.moves.length||state.currentScore!==result.target.currentScore)throw new Error('현재 점수와 목표 추천을 다시 확인하세요.');
  const full=replay(confirmPlacedDraws(state,result.moves),result);
  if(full.slots.some(slot=>!slot.used)||full.skills.dot+full.skills.reroll>=7)throw new Error('세 조각의 생존 경로를 먼저 확인하세요.');
  const prefix=result.moves.slice(0,step),next=replay(confirmPlacedDraws(state,prefix),{...result,moves:prefix});
  if(next.currentScore!==result.target.hit||!isTargetScore(next.currentScore,activeTargets(state))||next.skills.dot+next.skills.reroll>=7)throw new Error('목표 점수 또는 스킬 수가 변경됐습니다. 다시 추천하세요.');
  return next.slots.every(slot=>slot.used)?{...next,slots:[null,null,null]}:next;
}

// A bounded search can find a useful prefix without proving the batch impossible.
// Keep unused pieces so the player can enter newly acquired skills and continue.
export function applyPartialPlan(state,result){
  if(result?.complete||result?.reroll||!result?.moves?.length)throw new Error('표시된 일부 배치 추천을 먼저 확인해 주세요.');
  const next=replay(confirmPlacedDraws(state,result.moves),result);
  if(next.slots.every(slot=>slot.used))throw new Error('모든 조각을 놓는 추천은 완료 버튼으로 반영해 주세요.');
  if(next.skills.dot+next.skills.reroll>=7)throw new Error('스킬을 최소 1개 사용해 합계 7개 미만으로 만드는 추천을 다시 찾아 주세요.');
  return next;
}

// Commit only the known prefix and one actual reroll. The draw is never guessed.
export function applyReroll(state, result, blockId) {
  const block=state.blocks.find(block=>block.id===blockId);
  if(!block)throw new Error('실제로 나온 새 조각을 선택해 주세요.');
  return applyObservedReroll(state,result,block);
}

// Screen recognition may supply a rotated shape absent from the saved library.
export function applyObservedReroll(state,result,block,{unidentified=false,demo=false,deferStatistics=false}={}) {
  if(result?.complete || !result?.reroll)throw new Error('다시 뽑기 추천을 먼저 찾아 주세요.');
  const next=replay(confirmPlacedDraws(state,result.moves),result),index=next.slots.findIndex(slot=>slot.instanceId===result.reroll.pieceId && !slot.used);
  if(index<0)throw new Error('다시 뽑을 조각이 변경됐습니다. 추천을 다시 찾아 주세요.');
  if(next.skills.reroll<1)throw new Error('다시 뽑기 스킬이 부족합니다.');
  next.skills.reroll--;
  next.slots[index]={...next.slots[index],blockId:block.id,name:block.name,cells:block.cells.map(c=>c.slice()),used:false,drawRecorded:false,unidentified,demo:demo||!!next.slots[index].demo,
    capturePending:deferStatistics,drawSource:'reroll',drawStage:stageForLines(next.clearedLines)};
  return deferStatistics?next:recordRerollDraw(next,index);
}
