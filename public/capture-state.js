import {normalize,variants} from './solver.js';
import {applyObservedReroll} from './plan.js';
import {stageForLines} from './statistics.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function sameShape(a,b){return same(normalize(a),normalize(b));}
export function findBlock(blocks,cells){return blocks.find(block=>variants(block.cells).some(v=>sameShape(v.cells,cells)));}
function uniquelyIdentified(blocks,cells){return blocks.filter(block=>variants(block.cells).some(v=>sameShape(v.cells,cells))).length===1;}

// Recognition does not append random shapes to the user's saved library.
export function stateFromCapture(state,observation,makeId,{demo=false}={}){
  if(!observation?.safe || observation.pieces.length!==3 || observation.board.length!==state.rows)throw new Error('보드와 세 조각의 인식 영역을 확인하세요.');
  if(!observation.pieces.some(p=>p.status==='ready'))throw new Error('다음 세 조각이 나올 때까지 기다려 주세요.');
  const slots=observation.pieces.map((piece,index)=>{
    const previous=state.slots[index];
    if(piece.status==='used')return previous?{...previous,used:true}:{instanceId:makeId(),blockId:`capture-used-${index}`,name:'사용 완료',cells:[[0,0]],used:true};
    const cells=normalize(piece.cells);
    if(!cells.length || cells.some(c=>c.some(n=>!Number.isInteger(n)||n<0||n>9)))throw new Error('조각 모양을 다시 확인하세요.');
    const block=findBlock(state.blocks,cells);
    const unchanged=previous&&!previous.used&&!!previous.demo===demo&&variants(previous.cells).some(v=>sameShape(v.cells,cells));
    // Correcting an unconfirmed guess changes its shape, not its draw event.
    const sameDraw=unchanged||(previous&&!previous.used&&!!previous.demo===demo&&previous.capturePending);
    return {instanceId:unchanged?previous.instanceId:makeId(),blockId:block?.id||`capture-${index}`,
      name:block?.name||`감지 ${index+1}`,cells,used:false,demo,
      drawRecorded:unchanged&&!!previous.drawRecorded,capturePending:!(unchanged&&previous.drawRecorded),drawSource:sameDraw?previous.drawSource||'normal':'normal',
      drawStage:sameDraw&&Object.hasOwn(previous,'drawStage')?previous.drawStage:stageForLines(state.clearedLines),unidentified:!uniquelyIdentified(state.blocks,cells)};
  });
  return {...state,board:observation.board.slice(),slots};
}

// The game already performed the prefix and reroll. Require its visible board
// and every other slot to agree before charging any inventory locally.
export function rerollFromCapture(state,result,observation,{demo=false}={}){
  if(!result?.reroll || !observation?.safe)throw new Error('다시 뽑은 화면의 보드와 조각을 먼저 확인하세요.');
  const index=state.slots.findIndex(s=>s?.instanceId===result.reroll.pieceId);
  if(index<0 || observation.pieces[index]?.status!=='ready')throw new Error('다시 뽑은 새 조각이 아직 보이지 않습니다.');
  const expected=result.moves.at(-1)?.boardAfter??state.board;
  if(!same(expected,observation.board))throw new Error('먼저 추천된 배치를 게임에 모두 놓은 뒤 다시 뽑아 주세요.');
  const used=new Set(result.moves.filter(m=>m.kind!=='dot').map(m=>m.pieceId));
  for(let i=0;i<3;i++){
    if(i===index)continue;
    const slot=state.slots[i],piece=observation.pieces[i];
    if(slot.used||used.has(slot.instanceId)){
      if(piece.status!=='used')throw new Error('다른 조각의 사용 상태가 추천과 다릅니다. 화면을 다시 확인하세요.');
    }else if(piece.status!=='ready'||!sameShape(slot.cells,piece.cells))throw new Error('다른 조각도 바뀌었습니다. 현재 화면을 다시 읽어 주세요.');
  }
  const cells=normalize(observation.pieces[index].cells),known=findBlock(state.blocks,cells);
  const block={id:known?.id||`capture-${index}`,name:known?.name||`감지 ${index+1}`,cells};
  return applyObservedReroll(state,result,block,{unidentified:!uniquelyIdentified(state.blocks,cells),demo,deferStatistics:true});
}
