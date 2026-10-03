import {t, getLanguage, setLanguage, onLanguageChange, bindStaticTranslations} from './i18n.js';
import { normalize, canPlace, place, skillCounts } from './solver.js';
import { overlayCells, completePlan, applyPartialPlan, applyReroll, isOrderIndependent, applyTargetPlan } from './plan.js';
import { ScreenCapture } from './capture.js';
import { stateFromCapture, rerollFromCapture } from './capture-state.js';
import { emptyStatistics, recordNormalDraws, statisticsRows, statisticsView, setObservationCounts, resetStatistics, observedPercent, stageForLines, addClearedLines } from './statistics.js';
import {TARGET_SCORES,isTargetScore,nextTarget,addScore,scoreMoves} from './targets.js';
import {validateSpawnRemaining,advanceSpawnRemaining,remainingIconOrder,editSkillIcon} from './abilities.js';
import {normalizeBlockInput,blocksNamed,blockNameIncludes} from './block-input.js';
import {StudioUI} from './studio.js';
import {shapeKey,deduplicateLibrary} from './library.js';

const refreshStaticLanguage=bindStaticTranslations(document);
const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const uid = () => crypto.randomUUID();
const DRAFT = 'moa-manual-unsaved-v1';
let state, loaded = false, revision = 0, savedRevision = 0, saving = false, saveTimer;
let stagePersistenceSupported=true;
let worker, searchTimer, generation = 0, result = null, preview = -1, busy = false;
let targetPaused=false;
let mode = 'paint', placement = null, hover = null, drag = null, dotDrag = null;
let editorId = null, dots = new Set(), history = [], pipWindow = null;
let inputMode='manual';
let lastMessage=null,editorError=null;
const colors = getComputedStyle(document.documentElement);
const color = name => colors.getPropertyValue(`--color-${name}`).trim();
function slotName(slot){
  if(!slot)return t('블록');
  if(/^capture-(?:used-)?[012]$/.test(slot.blockId)&&!state.blocks.some(block=>block.id===slot.blockId)){
    if(slot.name==='사용 완료')return t('사용 완료');
    const detected=/^감지 ([123])$/.exec(slot.name);if(detected)return t`감지 ${detected[1]}`;
  }
  return slot.name;
}
const moveName = move => move.kind==='dot'?t('점 찍기'):slotName(state.slots.find(s=>s?.instanceId===move.pieceId));
function stepColor(index) { return result?.moves[index]?.kind==='dot'?'skill':`step-${result.moves.slice(0,index+1).filter(m=>m.kind!=='dot').length}`; }
function colorStep(node,index) { node.style.setProperty('--step-color',`var(--color-${stepColor(index)})`);return node; }
const capture=new ScreenCapture({
  getState:()=>state,
  getPlan:()=>({result,preview,stepColor,targetPaused}),
  onReset:()=>{targetPaused=false;invalidate();if(loaded)render();},
  onRead:(observation,source)=>{
    const next=stateFromCapture(state,observation,uid,source);
    remember();state=next;placement=null;hover=null;mode='paint';changed();solveBoard();
  }
});
const studio=new StudioUI({manual:()=>switchInput('manual'),capture:()=>switchInput('capture'),preview:index=>{if(!result?.moves.length)return;preview=index<0?-2:index;placement=null;hover=null;renderBoard();renderRecommendations();renderTray();renderPip();}});
function switchInput(next){
  if(!loaded)return;studio.stopPlayback();inputMode=next;const sharing=next==='capture';
  document.body.classList.toggle('capture-mode',sharing);$('capture-panel').hidden=!sharing;
  for(const id of ['manual','capture']){$(`tab-${id}`).classList.toggle('selected',id===next);$(`tab-${id}`).setAttribute('aria-pressed',String(id===next));}
  capture.setActive(sharing);render();
}
function message(text, error = false) { lastMessage={text,error};refreshMessage(); }
function refreshMessage(){if(!lastMessage)return;$('message').textContent=t(typeof lastMessage.text==='function'?lastMessage.text():lastMessage.text);$('message').classList.toggle('error',lastMessage.error);}
function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; }
function button(text, action, className) { const b=el('button',text,className); b.type='button'; b.addEventListener('click',action); return b; }
function remember() { history.push(clone(state)); if(history.length>40)history.shift(); }
function dirty() {
  revision++;
  try { localStorage.setItem(DRAFT,JSON.stringify(state)); } catch { message(()=>(t('브라우저 임시 백업을 저장하지 못했습니다. 로컬 파일 저장 상태를 확인하세요.')),true); }
  $('save-status').textContent=t('저장 중…'); $('save-status').classList.remove('error');
  clearTimeout(saveTimer); saveTimer=setTimeout(save,180);
}
async function save() {
  if(!loaded || saving || savedRevision===revision)return;
  saving=true; const target=revision, snapshot=JSON.stringify(state);
  try {
    if(!stagePersistenceSupported)throw new Error(t('실행 중인 서버가 이전 버전입니다. 서버를 다시 시작한 뒤 새로고침하면 임시 보관한 점수·능력 위치·등장 횟수·통계를 저장합니다.'));
    const response=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});
    const body=await response.json(); if(!response.ok)throw new Error(body.error||t('저장 실패'));
    savedRevision=target; $('retry-save').hidden=true;
    if(revision===target) { $('save-status').textContent=t('파일에 저장됨'); $('save-status').classList.remove('error'); try{localStorage.removeItem(DRAFT);}catch{} }
  } catch(error) { $('save-status').textContent=t('저장 실패 · 임시 보관 중'); $('save-status').classList.add('error'); $('retry-save').hidden=false; message(()=>(t`${t(error.message)} 서버를 확인한 뒤 저장 재시도를 눌러 주세요.`),true); }
  finally { saving=false; if(savedRevision===target && revision!==target)save(); }
}
function invalidate() {
  generation++; clearTimeout(searchTimer);worker?.terminate(); worker=null; result=null; preview=-1; busy=false;
}
function changed({search=true,keepTargetPause=false}={}) { if(search){if(!keepTargetPause)targetPaused=false;invalidate();} dirty(); render(); }
function shape(cells, width=64,height=64, step=null) {
  const canvas=el('canvas',undefined,'shape'); canvas.width=width*2;canvas.height=height*2;
  canvas.setAttribute('aria-label',t`${cells.length}칸 블록`);drawShape(canvas,cells,step);return canvas;
}
function drawShape(canvas,cells,step=null) {
  const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);if(!cells.length)return;
  const points=normalize(cells),w=Math.max(...points.map(p=>p[0]))+1,h=Math.max(...points.map(p=>p[1]))+1;
  const size=Math.min((canvas.width-8)/w,(canvas.height-8)/h,28),ox=(canvas.width-w*size)/2,oy=(canvas.height-h*size)/2;
  c.fillStyle=color(step?stepColor(step-1):'accent'); for(const[x,y]of points){c.beginPath();c.roundRect(ox+x*size+1,oy+y*size+1,size-3,size-3,2);c.fill();}
}
function renderLibrary() {
  $('block-count').textContent=t`${state.blocks.length}개`;
  const query=$('search-blocks').value.trim();
  const list=state.blocks.filter(b=>!query||blockNameIncludes(b.name,query)||t`${b.cells.length}칸`.includes(query));
  $('library-list').replaceChildren(); $('library-empty').hidden=state.blocks.length>0;
  if(!list.length&&state.blocks.length)$('library-list').append(el('p',t('일치하는 블록이 없습니다.'),'search-meta'));
  for(const block of list) {
    const card=el('div',undefined,'block-card');card.dataset.blockId=block.id;card.append(shape(block.cells));
    const content=el('div',undefined,'block-content');content.append(el('strong',block.name),el('span',t`${block.cells.length}칸`));
    const choose=button(t('+ 선택'),()=>chooseBlock(block,card.querySelector('.shape')));choose.setAttribute('aria-label',t`${block.name} 선택`);choose.disabled=state.slots.every(Boolean);
    content.append(choose);card.append(content);
    const edit=button('⋯',()=>openEditor(block.id),'edit-button');edit.setAttribute('aria-label',t`${block.name} 수정`);card.append(edit);$('library-list').append(card);
  }
}
function chooseBlock(block,source) {
  const at=state.slots.indexOf(null);if(at<0){message(()=>(t('이번 세 조각을 모두 사용한 뒤 다음 세트를 선택하세요.')));return;}
  const origin=studio.origin(source);
  remember();state.slots[at]={instanceId:uid(),blockId:block.id,name:block.name,cells:clone(block.cells),used:false,drawStage:stageForLines(state.clearedLines)};changed();
  studio.fly(origin,at);
  const count=state.slots.filter(Boolean).length;message(()=>(count===3?t('세 조각이 준비됐습니다. 배치 추천을 찾거나 조각의 직접 배치를 눌러 주세요.'):t`${block.name} 선택 · ${3-count}개를 더 선택하세요. 같은 모양도 중복 선택할 수 있습니다.`));
}
function chooseThreeFromSearch() {
  if(!loaded)return;
  const names=Array.from(normalizeBlockInput($('search-blocks').value));
  if(names.length!==3){message(()=>(t`한 글자 블록 이름 3개를 입력하세요. 예: ㅅㅅㅡ / ttm / 긔${names.length?t` · 해석된 입력: ${names.join(' · ')} (${names.length}개)`:''}`),true);return;}
  const selected=[];
  for(const name of names){
    const matches=blocksNamed(state.blocks,name);
    if(!matches.length){message(()=>(t`“${name}” 블록이 없습니다. 먼저 해당 이름으로 저장해 주세요.`),true);return;}
    if(matches.length>1){message(()=>(t`“${name}” 이름의 블록이 여러 개입니다. 이름을 구분하거나 목록에서 직접 선택해 주세요.`),true);return;}
    selected.push(matches[0]);
  }
  const used=state.slots.filter(slot=>slot?.used).length;
  if(used>0&&used<3){message(()=>(t('사용 중인 세트가 있습니다. 남은 조각을 완료하거나 선택 초기화 후 입력해 주세요.')),true);return;}
  remember();
  state.slots=selected.map(block=>({instanceId:uid(),blockId:block.id,name:block.name,cells:clone(block.cells),used:false,drawStage:stageForLines(state.clearedLines)}));
  placement=null;hover=null;mode='paint';$('search-blocks').value='';changed();
  message(()=>(t`${names.join(' · ')} 세 조각을 선택했습니다. 배치 추천 찾기를 눌러 주세요.`));
}
function renderTray() {
  $('tray').replaceChildren(); const chosen=state.slots.filter(Boolean).length,used=state.slots.filter(s=>s?.used).length;
  for(let i=0;i<3;i++) {
    const slot=state.slots[i],card=el('div',undefined,'tray-slot'+(slot?' occupied':'')+(slot?.used?' used':'')+(placement?.index===i?' active':''));
    card.append(el('span',`0${i+1}`,'slot-num'));
    if(slot) {
      card.append(shape(slot.cells,56,56),el('strong',slotName(slot)),el('p',slot.used?t('사용 완료'):t`${slot.cells.length}칸`));
      if(!slot.used) { const b=button(t('직접 배치'),()=>startPlacement(i));b.disabled=chosen!==3;card.append(b); }
      const remove=button('×',()=>{remember();state.slots[i]=null;placement=null;mode='paint';changed();},'remove-slot');
      remove.setAttribute('aria-label',t`${i+1}번 조각 선택 취소`);remove.disabled=used>0;card.append(remove);
    } else card.append(el('div','+','empty-slot'));
    $('tray').append(card);
  }
  $('tray-status').textContent=chosen<3?t`목록에서 ${3-chosen}개를 더 선택하세요.`:used===3?t('세 조각을 모두 사용했습니다.'):t`${used} / 3 사용 · 모두 사용하면 다음 세트`;
  $('next-set').hidden=used!==3; $('solve').disabled=chosen!==3||used===3||busy;
  $('solve').textContent=busy?t('배치를 탐색하고 있습니다…'):t('배치 추천 찾기');
}
function renderStatistics() {
  const stage=$('statistics-stage').value,query=$('statistics-search').value;
  const {rows:rawRows,totals}=statisticsView(state,{sort:$('statistics-sort').value,stage});
  const rows=rawRows.filter(row=>blockNameIncludes(row.name,query)||(row.blockId===null&&blockNameIncludes(t('미분류 (화면 인식)'),query))).map(row=>row.blockId===null?{...row,name:t('미분류 (화면 인식)')}:row);
  studio.statistics(rows,totals);
  $('statistics-total').textContent=t`일반 ${totals.normal.toLocaleString()}회 · 바꾸기 ${totals.reroll.toLocaleString()}회 · 합계 ${totals.total.toLocaleString()}회`;
  $('statistics-empty').hidden=totals.total>0;
  $('statistics-no-match').hidden=rows.length>0;
  $('statistics-reset').disabled=statisticsRows(state).totals.total===0;
  $('statistics-scope-note').textContent=stage==='all'?t('전체 확률: 1~5단계와 단계 미상 기록을 모두 포함합니다. 단계별 기록을 중복해서 더하지 않습니다.'):stage==='unknown'?t('단계 미상: 단계 정보 없이 저장된 기존 기록과 줄 수를 모를 때의 기록입니다. 전체 확률에도 포함됩니다.'):t`${stage}단계 확률: 이 단계에서 나온 조각만을 분모로 계산합니다. 일반 출현과 바꾸기 결과는 각각 따로 집계합니다.`;
  const body=$('statistics-rows'),existing=new Map([...body.children].map(tr=>[tr.dataset.key,tr]));
  const editing=body.contains(document.activeElement),keys=new Set(rows.map(row=>JSON.stringify(row.blockId)));
  // Keep inputs and row order stable while tabbing through counts. Re-sort when
  // focus leaves the table so a change never moves the next field mid-click.
  if(editing){const order=new Map([...body.children].map((tr,i)=>[tr.dataset.key,i]));rows.sort((a,b)=>(order.get(JSON.stringify(a.blockId))??Infinity)-(order.get(JSON.stringify(b.blockId))??Infinity));}
  for(const [key,tr]of existing)if(!keys.has(key))tr.remove();
  rows.forEach((row,index)=>{
    const key=JSON.stringify(row.blockId),tr=existing.get(key)||el('tr');tr.dataset.key=key;tr.dataset.blockId=row.blockId??'unidentified';
    if(!tr.children.length){const title=el('th');title.scope='row';tr.append(title);}
    tr.firstChild.textContent=row.name;
    for(const source of ['normal','reroll','total']){
      let cell=tr.querySelector(`[data-source="${source}"]`);
      if(!cell){
        cell=el('td');cell.dataset.source=source;cell.append(el('strong'));
        if(source==='total')cell.append(el('span'));
        else {
          const label=el('label',undefined,'statistics-count'),input=el('input');input.type='number';input.min='0';input.step='1';input.inputMode='numeric';input.dataset.source=source;
          input.onchange=()=>saveInlineCount(row.blockId,source,input);
          input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}};
          label.append(input,el('span',t('회')));cell.append(label);
        }
        tr.append(cell);
      }
      cell.firstChild.textContent=observedPercent(row[source],totals[source]);
      const unit=cell.querySelector('.statistics-count>span');if(unit)unit.textContent=t('회');
      if(source==='total')cell.lastChild.textContent=t`${row.total.toLocaleString()}회`;
      else {const input=cell.querySelector('input');input.setAttribute('aria-label',t`${row.name} ${source==='normal'?t('일반'):t('바꾸기')} 출현 횟수`);if(input!==document.activeElement){input.value=row[source];input.removeAttribute('aria-invalid');}}
    }
    if(body.children[index]!==tr)body.insertBefore(tr,body.children[index]||null);
  });
}
function saveInlineCount(blockId,source,input){
  if(!loaded)return;
  try{
    if(!input.value.trim())throw new Error(t('횟수는 0 이상의 정수로 입력하세요.'));
    const stage=$('statistics-stage').value,row=statisticsRows(state,stage).rows.find(row=>row.blockId===blockId),value=Number(input.value);
    if(!row)throw new Error(t('통계를 수정할 블록을 찾지 못했습니다.'));
    const next=setObservationCounts(state,blockId,{normal:row.normal,reroll:row.reroll,[source]:value},stage);
    input.removeAttribute('aria-invalid');if(row[source]===value)return;
    remember();state=next;changed({search:false});message(()=>(t`${row.blockId===null?t('미분류 (화면 인식)'):row.name}의 ${stage==='all'?t('전체'):stage==='unknown'?t('단계 미상'):t`${stage}단계`} ${source==='normal'?t('일반'):t('바꾸기')} 횟수를 ${value.toLocaleString()}회로 저장했습니다.`));
  }catch(error){input.setAttribute('aria-invalid','true');message(()=>(t(error.message)),true);}
}
$('statistics-search').oninput=()=>{if(loaded)renderStatistics();};
$('statistics-sort').onchange=()=>{if(loaded)renderStatistics();};
$('statistics-stage').onchange=()=>{if(loaded)renderStatistics();};
$('statistics-rows').addEventListener('focusout',()=>setTimeout(()=>{if(loaded&&!$('statistics-rows').contains(document.activeElement))renderStatistics();},0));
$('statistics-reset').onclick=()=>{if(!loaded)return;remember();state=resetStatistics(state);changed({search:false});message(()=>(t('모든 단계와 전체의 일반·바꾸기 통계를 초기화했습니다. 되돌리기로 복구할 수 있습니다.')));};
function saveClearedLines(){
  if(!loaded)return;
  const input=$('cleared-lines'),value=input.value.trim()===''?null:Number(input.value);
  if(input.validity.badInput||value!==null&&(!Number.isSafeInteger(value)||value<0)){
    input.setAttribute('aria-invalid','true');message(()=>(t('누적 제거 줄 수는 0 이상의 정수로 입력하세요. 모르면 비워 두세요.')),true);return;
  }
  input.removeAttribute('aria-invalid');if(value===state.clearedLines)return;
  remember();state.clearedLines=value;
  // Correcting the counter before confirmation also corrects unrecorded draws.
  state.slots=state.slots.map(slot=>slot&&!slot.used&&!slot.drawRecorded?{...slot,drawStage:stageForLines(value)}:slot);
  changed({search:false});message(()=>(value===null?t('단계를 미상으로 설정했습니다. 새 기록은 전체 확률과 단계 미상에 포함됩니다.'):t`누적 ${value.toLocaleString()}줄 · ${stageForLines(value)}단계. 이미 집계된 조각의 출현 단계는 유지합니다.`));
}
$('cleared-lines').onchange=saveClearedLines;
$('cleared-lines').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.target.blur();}};
function saveCurrentScore(){
  if(!loaded)return;const input=$('current-score'),value=input.value.trim()===''?null:Number(input.value);
  if(input.validity.badInput||value!==null&&(!Number.isInteger(value)||value<0||value>500000)){input.setAttribute('aria-invalid','true');message(()=>(t('현재 점수는 0~500,000 사이의 정수로 입력하세요.')),true);return;}
  input.removeAttribute('aria-invalid');if(value===state.currentScore)return;
  remember();state.currentScore=value;changed();message(()=>(value===null?t('현재 점수를 모르면 목표 계산 대신 고득점 배치를 추천합니다.'):t('현재 게임 점수를 반영했습니다. 새로 추천하면 목표 점수를 다시 계산합니다.')));
}
$('current-score').onchange=saveCurrentScore;
$('current-score').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.target.blur();}};
$('target-enabled').onchange=()=>{if(!loaded)return;remember();state.targetEnabled=$('target-enabled').checked;targetPaused=false;changed();};
$('score-plus-50').onclick=()=>{if(!loaded||state.currentScore==null)return;remember();state.currentScore=addScore(state.currentScore,50);changed();message(()=>(t('표시하지 않았던 능력 획득 50점을 보정했습니다. 표시한 능력은 자동 반영되므로 중복해서 더하지 마세요.')));};
function renderTargetStatus(){
  if(document.activeElement!==$('current-score'))$('current-score').value=state.currentScore??'';
  $('target-enabled').checked=state.targetEnabled!==false;$('score-plus-50').disabled=state.currentScore==null||state.currentScore>=500000;
  const next=nextTarget(state.currentScore),hit=result?.target?.hit;
  $('target-status').textContent=hit?t`${result.target.hitStep}번까지 놓으면 ${hit.toLocaleString()}점 예상`:state.targetEnabled===false?t('고득점 우선'):state.currentScore==null?t('현재 점수를 입력하면 목표를 계산합니다.'):isTargetScore(state.currentScore)?t`${state.currentScore.toLocaleString()}점 달성${next?t` · 계속하면 다음 후보 ${next.toLocaleString()}점`:''}`:next?t`다음 후보 ${next.toLocaleString()}점 · ${(next-state.currentScore).toLocaleString()}점 남음`:t('목표 목록을 지나 고득점을 노립니다.');
  $('target-list').textContent=TARGET_SCORES.map(s=>s.toLocaleString()).join(' · ');
}
function markSkillIcon(x,y){
  try{
    const {state:next,expired}=editSkillIcon(state,{x,y,kind:mode==='icon-dot'?'dot':'reroll'},{newlyAppeared:$('icon-entry').value==='new'});
    remember();state=next;changed();
    message(()=>(expired?t`새 능력을 표시하고 가장 오래된 ${expired.y+1}행 · ${expired.x+1}열 능력 위치를 지웠습니다.`:t('능력 위치를 저장했습니다. 줄을 지워 획득하면 보유량과 50점을 자동으로 더합니다.')));
  }catch(error){message(()=>(t(error.message)),true);}
}
function saveSpawnRemaining(){
  if(!loaded)return;const input=$('skill-spawn-remaining');
  try{
    if(input.validity.badInput)throw new Error(t('남은 배치 횟수를 확인하세요.'));
    const value=validateSpawnRemaining(input.value.trim()===''?null:Number(input.value));
    input.removeAttribute('aria-invalid');if(value===state.skillSpawnRemaining)return;
    remember();state.skillSpawnRemaining=value;changed();message(()=>(value===null?t('다음 능력 등장까지 남은 횟수를 미상으로 설정했습니다.'):t`다음 능력 등장까지 ${value}회. 일반 조각 배치를 반영하면 자동으로 줄어듭니다.`));
  }catch(error){input.setAttribute('aria-invalid','true');message(()=>(t(error.message)),true);}
}
$('skill-spawn-remaining').onchange=saveSpawnRemaining;
$('skill-spawn-remaining').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();event.target.blur();}};
$('forget-icon-order').onclick=()=>{if(!loaded||!state.skillIconOrder?.length)return;remember();state.skillIconOrder=[];changed();message(()=>(t('현재 능력은 순서 모름으로 설정했습니다. 사라진 위치를 직접 지워 주세요.')));};
function createBoard() {
  const grid=$('board-grid');grid.style.setProperty('--cols',state.cols);grid.replaceChildren();
  for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++) {
    const cell=button('',()=>{},'board-cell');cell.dataset.x=x;cell.dataset.y=y;cell.dataset.column=x+1;cell.dataset.row=y+1;cell.tabIndex=x===0&&y===0?0:-1;grid.append(cell);
  }
  grid.dataset.size=`${state.cols},${state.rows}`;
}
function renderBoard() {
  if($('board-grid').dataset.size!==`${state.cols},${state.rows}`)createBoard();
  const unordered=isOrderIndependent(result,state.cols);
  const selected=result?.moves[preview];const board=unordered?state.board:selected?.boardBefore??state.board;
  const all=preview===-2&&!!result?.moves.length;
  const recommendation=overlayCells(result?.moves||[],preview);
  const cleared=new Set((all?result.moves:selected&&!unordered?[selected]:[]).flatMap(move=>move.cleared));
  const ghost=new Set(placement&&hover?placement.cells.map(([x,y])=>`${x+hover.x},${y+hover.y}`):[]);
  const valid=placement&&hover?canPlace(state.board,state.cols,placement.cells,hover.x,hover.y):true;
  let count=0;
  for(const cell of $('board-grid').children) {
    const x=+cell.dataset.x,y=+cell.dataset.y,filled=!!(board[y]&(1<<x)),key=`${x},${y}`;if(state.board[y]&(1<<x))count++;
    const steps=recommendation.get(key)||[];
    cell.className='board-cell'+(filled?' filled':'')+(steps.length?' recommended':'')+(steps.length>1?' reused':'')+(ghost.has(key)?' ghost'+(!valid?' invalid':''):'')+(cleared.has(y)?' clear-row':'');
    cell.replaceChildren(...steps.map(step=>colorStep(el('span',unordered?'':String(step),`recommendation-chip step-${step}`),step-1)));
    const icon=state.skillIcons?.find(icon=>icon.x===x&&icon.y===y);
    if(icon){const marker=el('span',icon.kind==='dot'?'◎':'↔',`skill-marker marker-${icon.kind}`);marker.setAttribute('aria-hidden','true');cell.append(marker);}
    cell.dataset.steps=steps.join(',');
    cell.setAttribute('aria-label',t`${y+1}행 ${x+1}열 ${filled?t('채워짐'):t('빈칸')}${steps.length?(unordered?t` · ${steps.map(step=>moveName(result.moves[step-1])).join(' · ')} 추천 위치`:t` · ${steps.join(' → ')}번 추천 위치`):''}`);
    if(icon)cell.setAttribute('aria-label',t`${cell.getAttribute('aria-label')} · ${icon.kind==='dot'?t('점 찍기'):t('바꾸기')} 능력 위치`);
    cell.setAttribute('aria-pressed',String(filled));
  }
  $('board-count').textContent=t`${state.cols} × ${state.rows} · ${count}칸`;
  $('mode-paint').classList.toggle('selected',mode==='paint');$('mode-erase').classList.toggle('selected',mode==='erase');
  $('mode-paint').setAttribute('aria-pressed',String(mode==='paint'));$('mode-erase').setAttribute('aria-pressed',String(mode==='erase'));
  for(const id of ['icon-dot','icon-reroll']){$(`mode-${id}`).classList.toggle('selected',mode===id);$(`mode-${id}`).setAttribute('aria-pressed',String(mode===id));}
  $('icon-count').textContent=t`${state.skillIcons?.length||0} / 3개`;
  const unknown=(state.skillIcons?.length||0)-(state.skillIconOrder?.length||0);
  $('icon-order-status').textContent=unknown?t`${unknown}개 순서 모름 · 사라진 위치는 수동 제거`:t('새 능력의 등장 순서를 기록하면 오래된 위치를 자동 제거합니다.');
  $('forget-icon-order').disabled=!state.skillIconOrder?.length;
  $('placement-tools').hidden=!placement;
  if(placement)$('placement-name').textContent=t`${slotName(state.slots[placement.index])} · 왼쪽 위를 기준으로 배치`;
  $('rotate-placement').disabled=!state.options.rotate;$('flip-placement').disabled=!state.options.reflect;
  $('board-caption').textContent=all?(unordered?t('전체 추천 · 순서 상관없음. 색으로 구분된 위치에 모두 놓으세요.'):t`전체 추천 · 1번부터 ${result.moves.length}번까지 순서대로 놓으세요.${result.skillsUsed.dot?t(' 보라색은 점 찍기입니다.'):''} 한 칸의 여러 번호는 줄 제거 후 다시 쓰는 위치입니다. 줄 제거 후 다른 칸은 제자리에 유지됩니다.`):selected?(unordered?t`${moveName(selected)} 위치 미리보기 · 순서 상관없음.`:t`${preview+1}수 미리보기 · ${moveName(selected)} · ${preview?t('앞선 배치를 반영한 예상 보드입니다.'):t('번호가 적힌 칸이 추천 위치입니다.')} 밑줄은 제거될 행입니다.`):placement?t('블록의 왼쪽 위 기준점을 클릭하세요. 겹치거나 보드 밖이면 배치되지 않습니다.'):mode==='erase'?t('클릭·드래그로 칸을 지우세요.'):t('클릭·드래그로 현재 블록을 입력하세요. 다시 클릭하면 지워집니다.');
}
function renderRecommendations() {
  if(mode.startsWith('icon-'))$('board-caption').textContent=t`${mode==='icon-dot'?t('점 찍기'):t('바꾸기')} 능력이 있는 칸을 누르세요. 같은 종류를 다시 누르면 표시를 지웁니다. 블록은 바뀌지 않습니다.`;
  else if(result?.target?.hit)$('board-caption').textContent=t`목표 ${result.target.hit.toLocaleString()}점은 ${result.target.hitStep}번까지입니다. 그 뒤의 추천은 계속 플레이할 때만 놓으세요.`;
  else if(targetPaused)$('board-caption').textContent=t('목표 점수에 도달했습니다. 계속하려면 남은 조각으로 다시 추천하세요.');
  const unordered=isOrderIndependent(result,state.cols);
  $('recommend-title').textContent=unordered?t('추천 배치'):t('추천 순서');
  $('moves').replaceChildren();$('recommend-empty').hidden=!!result||busy;$('recommend-summary').hidden=!result&&!busy;
  $('recommend-summary').replaceChildren();$('complete-plan').hidden=!result?.moves.length||busy;
  $('complete-plan').disabled=!!result?.reroll;
  $('complete-plan').textContent=result?.complete?t('완료 · 추천대로 반영'):t('표시된 일부 배치 반영');
  const targetHit=!!result?.complete&&!!result.target?.hit;
  $('finish-target').hidden=!targetHit||busy;
  if(targetHit){$('finish-target').textContent=t`${result.target.hit.toLocaleString()}점까지 반영 · ${result.target.hitStep}번`;if(result.target.hitStep===result.moves.length)$('complete-plan').hidden=true;else $('complete-plan').textContent=t('목표를 지나 전체 배치 반영');}
  $('show-all').hidden=!result?.moves.length||busy;$('show-all').classList.toggle('selected',preview===-2);$('show-all').setAttribute('aria-pressed',String(preview===-2));
  $('reroll-panel').hidden=!result?.reroll||busy;
  $('capture-reroll').hidden=inputMode!=='capture'||!result?.reroll;
  if(!result?.reroll){$('reroll-result').value='';$('reroll-name').value='';}
  if(busy) {$('recommend-summary').append(el('strong',t('순서를 살펴보는 중')),el('p',t('보드를 수정하면 현재 탐색을 취소합니다.')));return;}
  if(!result){$('search-meta').textContent=t('추천은 이 보드에만 표시됩니다. 실제 게임의 조작은 직접 해 주세요.');return;}
  const cost=result.skillsUsed.dot?t`점 찍기 ${result.skillsUsed.dot}개 사용 예정. `:'';
  const reserve=state.skills.dot+state.skills.reroll===7?t('스킬 7개 보유 중 · 최소 1개를 사용해 6개 이하로 유지합니다. '):'';
  $('recommend-summary').append(el('strong',t`${result.score.toLocaleString()}점 · ${result.lines}줄`),el('p',reserve+cost+(unordered?t('어느 순서로 놓아도 제거되는 줄과 최종 점수가 같습니다.'):result.complete?t('현재 남은 조각을 모두 사용하는 순서입니다.'):result.reroll?.reason==='capacity'?t('스킬 자리를 비우기 위해 먼저 다시 뽑기를 사용하세요. 실제 결과를 입력하면 세 조각을 다시 계산합니다.'):result.reroll?t('일반 배치로 완료할 순서를 찾지 못해 다시 뽑기를 제안합니다. 아래 결과 입력 후 이어서 탐색합니다.'):t`${result.depth}개 조각의 일부 배치입니다. 사망 판정이 아닙니다. 게임에 놓은 뒤 일부 배치를 반영하고, 새로 얻은 스킬을 입력해 이어서 추천할 수 있습니다.`)));
  $('recommend-summary').append(el('p',t`배치 ${result.placementScore.toLocaleString()}점 + 줄 제거 ${result.lineScore.toLocaleString()}점 + 표시한 능력 획득 ${(result.acquisitionScore||0).toLocaleString()}점`));
  if(targetHit)$('recommend-summary').prepend(el('strong',t`${result.target.hitStep}번에서 ${result.target.hit.toLocaleString()}점 · 목표에서 멈추기`,'target-hit'));
  else if(result.target?.enabled)$('recommend-summary').append(el('p',result.target.status==='approach'?t('목표를 넘지 않는 안전한 배치로 접근합니다.'):t('이번에 안전하게 맞출 목표를 찾지 못해 고득점 배치를 추천합니다.')));
  result.moves.forEach((move,i)=>{
    const li=el('li');
    const b=colorStep(button('',()=>{placement=null;hover=null;mode='paint';preview=preview===i?-2:i;renderBoard();renderRecommendations();renderTray();renderPip();},`move-button step-${i+1}`+(unordered?' order-free':'')+(preview===i?' selected':'')),i);
    b.dataset.kind=move.kind;b.setAttribute('aria-label',t`${unordered?'':t`${i+1}수 `}${moveName(move)} ${move.y+1}행 ${move.x+1}열 미리보기`);
    const marker=el('span',unordered?'':String(i+1).padStart(2,'0'),unordered?'move-swatch':'move-number');if(unordered)marker.setAttribute('aria-hidden','true');
    b.append(marker,shape(move.cells,44,54,i+1));
    const copy=el('div',undefined,'move-copy');copy.append(el('strong',moveName(move)),el('span',t`${move.y+1}행 · ${move.x+1}열`),el('small',move.kind==='dot'?t('스킬 1개'):`${move.reflected?t('좌우 반전 → '):''}${move.rotation?t`시계 ${move.rotation}°`:t('회전 없음')}`));
    const reward=[];
    if(move.placementScore)reward.push(t`배치 +${move.placementScore}점`);
    if(!unordered&&move.cleared.length)reward.push(t`${move.cleared.length}줄 동시 제거 +${move.lineScore.toLocaleString()}점`);
    if(!unordered&&move.acquisitionScore)reward.push(t`능력 획득 +${move.acquisitionScore}점`);
    if(targetHit&&i+1===result.target.hitStep)reward.push(t`목표 ${result.target.hit.toLocaleString()}점 · 여기서 멈추기`);
    if(reward.length)copy.append(el('small',reward.join(' · '),'move-score'));
    b.append(copy);li.append(b);$('moves').append(li);
  });
  if(result.reroll){
    const index=state.slots.findIndex(s=>s?.instanceId===result.reroll.pieceId);
    $('reroll-title').textContent=t`${result.moves.length+1}번 · ${index+1}번 조각 “${slotName(state.slots[index])}” 다시 뽑기`;
    $('reroll-help').textContent=t`${result.reroll.reason==='capacity'?t('보유 스킬을 7개 미만으로 줄이기 위해, '):result.moves.length?t('위 순서대로 먼저 배치한 뒤, '):''}게임에서 이 조각을 다시 뽑고 실제 결과를 입력하세요. 한글 이름이나 영문 두벌식 키를 입력하고 Enter로 반영합니다.${inputMode==='capture'?t(' 화면으로 읽으려면 인식 버튼을 누른 뒤 공유 화면의 새 조각 반영을 누르세요.'):''}`;
    const selected=$('reroll-result').value;$('reroll-result').replaceChildren(el('option',t('실제로 나온 조각 선택')));
    $('reroll-result').firstChild.value='';
    for(const block of state.blocks){const option=el('option',t`${block.name} · ${block.cells.length}칸`);option.value=block.id;$('reroll-result').append(option);}
    $('reroll-result').value=selected;$('apply-reroll').disabled=!$('reroll-result').value;
  }
  const strategy=result.strategy;
  const forecast=strategy?t` ${state.blocks.length}종 공간 평가 · 향후 ${strategy.depth}세트 시나리오 ${strategy.tested}개 비교${strategy.skipped?t` · 시간 부족 ${strategy.skipped}개 제외`:''}. ${strategy.observedSamples?t`일반 출현 ${strategy.observedSamples}회 관측을 보정해 참고합니다.`:t('출현 기록이 없어 균등한 가상 시나리오를 사용합니다.')} 미래는 추가 스킬 없이 점검하며 실제 확률·생존을 보장하지 않습니다.`:'';
  $('search-meta').textContent=t`조각 배치 = 칸 수만큼 점수 · 동시 제거 n줄 = 300 × n²점. 직접 표시한 능력 획득은 1개당 50점과 보유 한도를 반영합니다. 새로 생길 능력은 예측하지 않습니다. 점 찍기 자체도 1점을 얻습니다. ${(result.duration/1000).toFixed(2)}초 · ${result.nodes.toLocaleString()}개 후보 · 제한 탐색${result.timedOut?t(' (시간 한도 도달)'):''}.${forecast} 좌표는 변형 후 모양의 왼쪽 위 기준입니다.`;
}
function render() {
  if(!state)return;
  renderLibrary();renderTray();renderBoard();renderRecommendations();renderStatistics();renderTargetStatus();$('undo').disabled=!history.length;
  if(document.activeElement!==$('cleared-lines'))$('cleared-lines').value=state.clearedLines??'';
  if(document.activeElement!==$('skill-spawn-remaining'))$('skill-spawn-remaining').value=state.skillSpawnRemaining??'';
  const stage=stageForLines(state.clearedLines);$('current-stage').textContent=stage===null?t('단계 미상'):t`${stage}단계`;
  $('cols').value=state.cols;$('rows').value=state.rows;
  $('skill-dot').value=state.skills.dot;$('skill-reroll').value=state.skills.reroll;
  $('skill-total').textContent=t`${state.skills.dot+state.skills.reroll} / 7개`;
  $('catalogue-info').textContent=t`1초 이내 추천 · 저장된 ${state.blocks.length}종의 배치 공간을 확인하고, 남는 시간에 다음 한 세트까지 비교합니다.`;
  for(const key of ['rotate','reflect'])$(key).checked=state.options[key];renderPip();
}
function setMode(next) { mode=next;placement=null;hover=null;preview=-1;renderBoard();renderTray();renderRecommendations();renderPip(); }
function startPlacement(index) {
  if(state.slots.some(s=>!s)||state.slots[index].used)return;
  preview=-1;mode='place';placement={index,cells:clone(state.slots[index].cells)};hover=null;renderBoard();renderTray();renderRecommendations();
}
function transformPlacement(reflect=false) {
  if(!placement||!(reflect?state.options.reflect:state.options.rotate))return;
  placement.cells=normalize(placement.cells.map(([x,y])=>reflect?[-x,y]:[-y,x]));renderBoard();
}
function applyPlacement(index,cells,x,y) {
  const placed=place(state.board,state.cols,cells,x,y,state.options.gravity);
  if(!placed){message(()=>(t('다른 블록과 겹치거나 보드 밖입니다. 빈 위치를 골라 주세요.')),true);return;}
  let clearedLines;try{clearedLines=addClearedLines(state.clearedLines??null,placed.cleared.length);}catch(error){message(()=>(t(error.message)),true);return;}
  const reward=scoreMoves(state.currentScore,[{kind:'piece',cells,cleared:placed.cleared}],{skillIcons:state.skillIcons,skills:state.skills});
  remember();state=recordNormalDraws(state,{confirmedIds:[state.slots[index].instanceId]});state.board=placed.board;state.clearedLines=clearedLines;state.currentScore=reward.after;state.skillIconOrder=remainingIconOrder(state,reward.icons);state.skillIcons=reward.icons;state.skillSpawnRemaining=advanceSpawnRemaining(state.skillSpawnRemaining,1);state.skills=reward.skillsAfter;state.slots[index]={...state.slots[index],used:true};placement=null;hover=null;mode='paint';changed();
  message(()=>(t`${slotName(state.slots[index])} 배치를 보드에 반영했습니다. +${reward.score.toLocaleString()}점 (능력 획득 ${reward.acquisitionScore}점 포함). 실제 게임에도 같은 위치에 놓아 주세요.`));
}
function gridPoint(event,selector) { return document.elementFromPoint(event.clientX,event.clientY)?.closest(selector); }
function paintCell(cell,value) {
  const x=+cell.dataset.x,y=+cell.dataset.y;
  state.board[y]=value?state.board[y]|(1<<x):state.board[y]&~(1<<x);renderBoard();
}
$('board-grid').addEventListener('pointerdown',event=>{
  const cell=event.target.closest('.board-cell');if(!cell||event.button!==0||!loaded)return;event.preventDefault();cell.focus({preventScroll:true});
  const x=+cell.dataset.x,y=+cell.dataset.y;
  if(mode.startsWith('icon-')){markSkillIcon(x,y);return;}
  if(placement){applyPlacement(placement.index,placement.cells,x,y);return;}
  remember();invalidate();drag={value:mode==='erase'?false:!(state.board[y]&(1<<x))};paintCell(cell,drag.value);renderRecommendations();renderTray();
});
$('board-grid').addEventListener('pointermove',event=>{
  const cell=gridPoint(event,'.board-cell');if(!cell)return;
  if(placement){hover={x:+cell.dataset.x,y:+cell.dataset.y};renderBoard();}
  else if(drag)paintCell(cell,drag.value);
});
$('board-grid').addEventListener('pointerleave',()=>{if(placement){hover=null;renderBoard();}});
$('board-grid').addEventListener('click',event=>{
  if(event.detail!==0)return;const cell=event.target.closest('.board-cell');if(!cell)return;
  const x=+cell.dataset.x,y=+cell.dataset.y;
  if(mode.startsWith('icon-')){markSkillIcon(x,y);return;}
  if(placement)applyPlacement(placement.index,placement.cells,x,y);
  else{remember();invalidate();paintCell(cell,mode==='erase'?false:!(state.board[y]&(1<<x)));dirty();render();}
});
function gridKeyboard(event,root,cols) {
  const current=event.target.closest('button[data-x]');if(!current)return;
  const directions={ArrowLeft:-1,ArrowRight:1,ArrowUp:-cols,ArrowDown:cols};if(!(event.key in directions))return;
  event.preventDefault();const all=[...root.children],index=all.indexOf(current),next=all[index+directions[event.key]];
  if(next){current.tabIndex=-1;next.tabIndex=0;next.focus({preventScroll:true});if(root===$('board-grid')&&placement){hover={x:+next.dataset.x,y:+next.dataset.y};renderBoard();}}
}
$('board-grid').addEventListener('keydown',e=>gridKeyboard(e,$('board-grid'),state.cols));
window.addEventListener('pointerup',()=>{if(drag){drag=null;dirty();render();}dotDrag=null;});
window.addEventListener('pointercancel',()=>{if(drag){drag=null;dirty();render();}dotDrag=null;});
function openEditor(id=null) {
  if(!loaded)return;editorId=id;const block=state.blocks.find(b=>b.id===id);dots=new Set(block?.cells.map(c=>c.join(','))||[]);
  $('block-name').value=block?.name||'';$('dialog-title').textContent=block?t('블록 수정'):t('블록 만들기');$('delete-block').hidden=!block;setEditorError(null);renderDots();$('block-dialog').showModal();$('block-name').focus();
}
function setEditorError(render){editorError=render;$('editor-error').textContent=render?.()||'';}
function renderDots() {
  if(!$('dot-editor').children.length)for(let y=0;y<10;y++)for(let x=0;x<10;x++) {const b=button('',()=>{},'dot-cell');b.dataset.x=x;b.dataset.y=y;b.tabIndex=x===0&&y===0?0:-1;b.setAttribute('aria-label',t`${y+1}행 ${x+1}열`);$('dot-editor').append(b);}
  for(const b of $('dot-editor').children){const on=dots.has(`${b.dataset.x},${b.dataset.y}`);b.classList.toggle('filled',on);b.setAttribute('aria-pressed',String(on));b.setAttribute('aria-label',t`${+b.dataset.y+1}행 ${+b.dataset.x+1}열`);}$('dot-count').textContent=t`${dots.size}칸`;
}
function paintDot(cell,value){const key=`${cell.dataset.x},${cell.dataset.y}`;value?dots.add(key):dots.delete(key);renderDots();}
$('dot-editor').addEventListener('pointerdown',event=>{const cell=event.target.closest('.dot-cell');if(!cell||event.button!==0)return;event.preventDefault();cell.focus({preventScroll:true});dotDrag={value:!dots.has(`${cell.dataset.x},${cell.dataset.y}`)};paintDot(cell,dotDrag.value);});
$('dot-editor').addEventListener('pointermove',event=>{if(!dotDrag)return;const cell=gridPoint(event,'.dot-cell');if(cell)paintDot(cell,dotDrag.value);});
$('dot-editor').addEventListener('click',event=>{if(event.detail!==0)return;const cell=event.target.closest('.dot-cell');if(cell)paintDot(cell,!dots.has(`${cell.dataset.x},${cell.dataset.y}`));});
$('dot-editor').addEventListener('keydown',e=>gridKeyboard(e,$('dot-editor'),10));
function editorCells(){return [...dots].map(k=>k.split(',').map(Number));}
function transformEditor(reflect=false){dots=new Set(normalize(editorCells().map(([x,y])=>reflect?[-x,y]:[-y,x])).map(c=>c.join(',')));renderDots();}
$('block-form').addEventListener('submit',event=>{
  event.preventDefault();const name=$('block-name').value.trim();
  if(!dots.size||!name){setEditorError(()=>t('이름을 입력하고 1칸 이상 찍어 주세요.'));return;}
  if(!editorId&&state.blocks.length>=500){setEditorError(()=>t('블록은 최대 500개까지 저장할 수 있습니다.'));return;}
  const cells=normalize(editorCells()),duplicate=state.blocks.find(b=>b.id!==editorId&&shapeKey(b.cells)===shapeKey(cells));
  if(duplicate){setEditorError(()=>t`회전·반전으로 같은 모양이 “${duplicate.name}”으로 저장되어 있습니다. 목록에서 중복 선택할 수 있습니다.`);return;}
  remember();const block={id:editorId||uid(),name,cells};const index=state.blocks.findIndex(b=>b.id===editorId);if(index>=0)state.blocks[index]=block;else state.blocks.push(block);
  $('block-dialog').close();changed({search:false});message(()=>(t`${name}을 저장했습니다. 현재 보유 중인 조각은 선택 당시 모양을 유지합니다.`));
});
$('delete-block').onclick=()=>{remember();state.blocks=state.blocks.filter(b=>b.id!==editorId);$('block-dialog').close();changed({search:false});message(()=>(t('목록에서 삭제했습니다. 되돌리기로 복구할 수 있습니다.')));};
function resetTray(){remember();state.slots=[null,null,null];placement=null;hover=null;mode='paint';changed();message(()=>(t('게임에 새로 나온 조각 3개를 선택하세요.')));}
function solveBoard() {
  if(!loaded||state.slots.some(s=>!s)||state.slots.every(s=>s.used))return;
  targetPaused=false;
  const recorded=recordNormalDraws(state);if(recorded!==state){state=recorded;dirty();}
  invalidate();placement=null;hover=null;mode='paint';busy=true;const id=generation;
  const wallLimit=950;
  worker=new Worker('/solver-worker.js',{type:'module'});
  let latest=null;
  const finish=(data)=>{
    if(id!==generation)return;clearTimeout(searchTimer);busy=false;worker?.terminate();worker=null;
    if(data.error){message(()=>(data.error),true);render();return;}
    result=data.result;preview=result.moves.length?-2:-1;render();capture.planReady();
    if(result.target?.hit){message(()=>(t`${result.target.hitStep}번까지만 놓으면 ${result.target.hit.toLocaleString()}점입니다. 목표에서 멈추려면 「목표 점수까지 반영」을 사용하세요.`));return;}
    message(()=>(isOrderIndependent(result,state.cols)?t('추천 위치를 색으로 표시했습니다. 순서 상관없이 모두 놓은 뒤 완료를 누르세요.'):result.complete?t('추천 전체를 색과 순서 번호로 표시했습니다. 게임에 순서대로 놓은 뒤 완료를 누르세요.'):result.reroll?.reason==='capacity'?t('보유 스킬을 7개 미만으로 유지하도록 먼저 다시 뽑기를 사용하세요. 실제로 나온 조각을 입력하면 이어서 추천합니다.'):result.reroll?t('다시 뽑기를 제안합니다. 표시된 순서를 진행하고 실제로 나온 조각을 입력해 주세요.'):result.moves.length?t('일부 배치를 찾았습니다. 실제로 놓은 뒤 일부 배치를 반영하고 남은 조각을 이어서 추천하세요.'):t('현재 탐색에서 배치를 찾지 못했습니다. 보드와 보유 스킬을 확인해 주세요.')));
  };
  worker.onmessage=({data})=>{
    if(data.id!==generation)return;
    if(data.progress){if(!latest?.complete||data.result.complete)latest=data.result;$('recommend-summary').replaceChildren(el('strong',latest.complete?t('생존 배치 확보 · 더 좋은 수 비교 중'):t('생존 경로를 찾는 중')),el('p',t('1초 이내로 추천을 계산 중입니다.')));return;}
    finish(data);
  };
  worker.onerror=()=>{if(id!==generation)return;invalidate();render();message(()=>(t('탐색 중 오류가 발생했습니다. 다시 시도해 주세요.')),true);};
  searchTimer=setTimeout(()=>finish(latest?{result:{...latest,timedOut:true,duration:wallLimit}}:{error:t('1초 제한에 도달했습니다. 보드를 확인한 뒤 다시 계산해 주세요.')}),wallLimit);
  worker.postMessage({id,input:{board:state.board,cols:state.cols,pieces:state.slots.filter(s=>!s.used).map(s=>({id:s.instanceId,cells:s.cells})),catalogue:state.blocks,statistics:state.statistics,skills:state.skills,currentScore:state.currentScore,targetEnabled:state.targetEnabled,skillIcons:state.skillIcons,options:{...state.options,solverProfile:'fast',timeLimit:850}}});render();
}
function finishTarget(){
  try{
    const next=applyTargetPlan(state,result),score=next.currentScore;
    studio.commit({...result,moves:result.moves.slice(0,result.target.hitStep)});
    remember();state=next;targetPaused=true;placement=null;hover=null;mode='paint';changed({keepTargetPause:true});
    message(()=>(t`${score.toLocaleString()}점 목표까지 반영했습니다. ${state.slots.every(s=>s===null)?t('계속하려면 다음 조각을 입력하거나 화면을 다시 읽어 주세요.'):t('여기서 멈추거나, 계속하려면 남은 조각의 배치 추천을 눌러 주세요.')}`));
    if(inputMode==='capture')capture.status(t('목표 점수에서 멈췄습니다. 계속하려면 남은 조각의 배치 추천을 누르거나 인식 버튼으로 새 화면을 읽으세요.'));
  }catch(error){message(()=>(t(error.message)),true);}
}
function finishPlan(){
  try {
    const complete=result.complete,next=complete?completePlan(state,result):applyPartialPlan(state,result),count=result.depth,lines=result.lines,score=result.score,dotsUsed=result.skillsUsed.dot;
    studio.commit(result);
    remember();state=next;placement=null;hover=null;mode='paint';changed();
    if(inputMode==='capture')capture.resume();
    message(()=>(t`${count}개 추천 배치 반영 · ${lines}줄 제거 · ${score.toLocaleString()}점.${dotsUsed?t` 점 찍기 ${dotsUsed}개 차감.`:''} ${complete?t('보유 조각을 초기화했습니다. 다음 세 조각을 선택하세요.'):t('남은 조각은 유지했습니다. 새로 얻은 스킬이 있으면 개수를 입력하고 다시 추천하세요.')}`));
  } catch(error){message(()=>(t(error.message)),true);}
}
function finishReroll(blockId=$('reroll-result').value){
  try{
    const next=applyReroll(state,result,blockId);
    remember();state=next;placement=null;hover=null;mode='paint';changed();solveBoard();
    message(()=>(t('표시된 배치와 다시 뽑기 1회를 반영했습니다. 새 조각으로 다음 순서를 찾고 있습니다.')));
  }catch(error){message(()=>(t(error.message)),true);}
}
function rerollByName(){
  if(!loaded||busy||!result?.reroll)return;
  const name=$('reroll-name').value.trim().normalize('NFC');
  const matches=blocksNamed(state.blocks,name);
  if(!matches.length){message(()=>(name?t`“${name}” 블록이 없습니다. 저장된 이름을 입력해 주세요.`:t('바꾸기로 나온 블록 이름을 입력해 주세요.')),true);return;}
  if(matches.length>1){message(()=>(t`“${name}” 이름의 블록이 여러 개입니다. 아래 목록에서 실제 조각을 선택해 주세요.`),true);return;}
  finishReroll(matches[0].id);
}
async function openPip() {
  if(!('documentPictureInPicture' in window)){message(()=>(t('이 브라우저는 항상 위 작은 창을 지원하지 않습니다. Chrome 또는 Edge에서 열어 주세요.')),true);return;}
  try {
    pipWindow=await window.documentPictureInPicture.requestWindow({width:370,height:700});const doc=pipWindow.document;doc.title=t('모아모아 도우미 · 다음 수');
    // Relative font and image URLs need the main document's base in the PiP document.
    const base=doc.createElement('base');base.href=document.baseURI;doc.head.append(base);
    // Copy already loaded rules, including imported tokens, so the popup has no unstyled frame.
    // Reuse decoded faces instead of starting font requests in the transient window.
    for(const face of document.fonts)if(face.status==='loaded')doc.fonts.add(face);
    const rules=sheet=>[...sheet.cssRules].flatMap(rule=>rule.type===5?[]:rule.type===3&&rule.styleSheet?rules(rule.styleSheet):[rule.cssText]);
    const style=doc.createElement('style');style.textContent=[...document.styleSheets].flatMap(rules).join('\n');doc.head.append(style);
    doc.body.className='pip-body';doc.body.replaceChildren();pipWindow.addEventListener('pagehide',()=>{pipWindow=null;});renderPip();
  }
  catch(error){message(()=>(t`작은 창을 열지 못했습니다: ${t(error.message)}`),true);}
}
function renderPip() {
  studio.sync({state,result,preview,busy,mode});
  capture.draw();
  if(!pipWindow||pipWindow.closed||!state)return;
  const doc=pipWindow.document,main=doc.createElement('main');main.className='pip-main';
  doc.documentElement.lang=getLanguage();doc.title=t('모아모아 도우미 · 다음 수');
  const heading=doc.createElement('h2');heading.textContent=t('모아모아 도우미 · 다음 수');main.append(heading);
  const unordered=isOrderIndependent(result,state.cols);
  const move=result?.moves[preview];const caption=doc.createElement('p');caption.textContent=preview===-2&&result?.moves.length?t`전체 추천 · ${unordered?t('순서 상관없음'):t('번호 순서대로 배치')} · ${result.score.toLocaleString()}점`:move?t`${moveName(move)} · ${move.y+1}행 ${move.x+1}열 · ${move.reflected?t('반전 후 '):''}${move.rotation}°`:t('본 창에서 보드와 조각을 입력하세요.');main.append(caption);
  const inventory=doc.createElement('p');inventory.textContent=t`점 찍기 ${state.skills.dot}개 · 다시 뽑기 ${state.skills.reroll}개`;main.append(inventory);
  if(result?.target?.hit){const goal=doc.createElement('p');goal.textContent=t`${result.target.hitStep}번까지만 놓으면 목표 ${result.target.hit.toLocaleString()}점. 이후 배치는 계속할 때만 진행하세요.`;goal.className='target-hit';main.append(goal);}
  const canvas=doc.createElement('canvas');canvas.width=330;canvas.height=Math.min(530,330*state.rows/state.cols);canvas.className='pip-board';const ctx=canvas.getContext('2d'),s=Math.min(320/state.cols,(canvas.height-10)/state.rows),ox=(330-state.cols*s)/2;
  const board=unordered?state.board:move?.boardBefore??state.board;const cells=overlayCells(result?.moves||[],preview);
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`bold ${Math.max(8,Math.min(13,s*.5))}px ${colors.getPropertyValue('--font-mono').trim()}`;
  for(let y=0;y<state.rows;y++)for(let x=0;x<state.cols;x++){
    const left=ox+x*s+1,top=y*s+5,steps=cells.get(`${x},${y}`)||[];
    ctx.fillStyle=(board[y]&(1<<x))?color('block'):color('cell');ctx.fillRect(left,top,s-2,s-2);
    steps.forEach((step,index)=>{const width=(s-2)/steps.length;ctx.fillStyle=color(stepColor(step-1));ctx.fillRect(left+index*width,top,width,s-2);if(!unordered){ctx.fillStyle=color('white');ctx.fillText(String(step),left+(index+.5)*width,top+(s-2)/2);}});
    const icon=state.skillIcons?.find(icon=>icon.x===x&&icon.y===y);
    if(icon){ctx.fillStyle=color(icon.kind==='dot'?'accent':'skill');ctx.beginPath();ctx.arc(left+s-5,top+s-5,6,0,Math.PI*2);ctx.fill();ctx.fillStyle=color('white');ctx.fillText(icon.kind==='dot'?'◎':'↔',left+s-5,top+s-5);}
  }
  main.append(canvas);
  if(result?.moves.length){const legend=doc.createElement('div');legend.className='pip-legend';result.moves.forEach((m,i)=>{const item=colorStep(doc.createElement('span'),i);item.className=`step-${i+1}`;item.textContent=`${unordered?'':`${i+1}. `}${moveName(m)}`;legend.append(item);});main.append(legend);}
  if(result?.reroll){const notice=doc.createElement('p');notice.textContent=t`${result.reroll.reason==='capacity'?t('스킬을 7개 미만으로 유지하기 위해 '):''}${result.moves.length+1}번 · ${state.slots.findIndex(s=>s?.instanceId===result.reroll.pieceId)+1}번 조각 다시 뽑기. 본 창에서 실제 결과를 입력하세요.`;main.append(notice);}
  const action=doc.createElement('button');action.className='primary wide';action.textContent=result?.target?.hit?t('목표 점수까지 반영'):result?.reroll?t('본 창에서 새 조각 입력'):result?.moves.length?(result.complete?t('완료'):t('일부 배치 반영')):t('배치 추천 찾기');action.disabled=busy||!!result?.reroll||state.slots.some(s=>!s)||state.slots.every(s=>s.used);action.onclick=()=>result?.target?.hit?finishTarget():result?.moves.length?finishPlan():solveBoard();main.append(action);doc.body.replaceChildren(main);
}
$('new-block').onclick=()=>openEditor();$('empty-create').onclick=()=>openEditor();$('close-editor').onclick=()=>$('block-dialog').close();
$('clear-editor').onclick=()=>{dots.clear();renderDots();};$('rotate-editor').onclick=()=>transformEditor();$('flip-editor').onclick=()=>transformEditor(true);
$('mode-paint').onclick=()=>setMode('paint');$('mode-erase').onclick=()=>setMode('erase');$('cancel-placement').onclick=()=>setMode('paint');$('rotate-placement').onclick=()=>transformPlacement();$('flip-placement').onclick=()=>transformPlacement(true);
$('mode-icon-dot').onclick=()=>setMode(mode==='icon-dot'?'paint':'icon-dot');
$('mode-icon-reroll').onclick=()=>setMode(mode==='icon-reroll'?'paint':'icon-reroll');
$('clear-icons').onclick=()=>{if(!loaded||!state.skillIcons?.length)return;remember();state.skillIcons=[];state.skillIconOrder=[];changed();message(()=>(t('표시한 능력 위치를 모두 지웠습니다. 보유 스킬과 점수는 그대로입니다.')));};
$('finish-target').onclick=finishTarget;
$('clear-board').onclick=()=>{remember();state.board=Array(state.rows).fill(0);placement=null;hover=null;changed();message(()=>(t('보드를 비웠습니다. 잘못 비웠다면 되돌리기를 누르세요.')));};
$('undo').onclick=()=>{if(!history.length)return;state=history.pop();placement=null;hover=null;mode='paint';changed();message(()=>(t('이전 상태로 되돌렸습니다.')));};
$('reset-tray').onclick=resetTray;$('next-set').onclick=resetTray;$('solve').onclick=solveBoard;$('complete-plan').onclick=finishPlan;$('pip').onclick=openPip;$('retry-save').onclick=save;
$('apply-reroll').onclick=()=>finishReroll();$('reroll-create').onclick=()=>openEditor();
$('tab-manual').onclick=()=>switchInput('manual');$('tab-capture').onclick=()=>switchInput('capture');
$('capture-reroll').onclick=()=>{
  try{
    const next=rerollFromCapture(state,result,capture.observation(),{demo:!!capture.demo});
    capture.rerollApplied();
    remember();state=next;placement=null;hover=null;mode='paint';changed();solveBoard();
    message(()=>(t('화면에서 읽은 실제 새 조각과 사용 스킬을 반영했습니다. 다음 배치를 계산합니다.')));
  }catch(error){message(()=>(t(error.message)),true);}
};
$('reroll-result').onchange=()=>{$('reroll-name').value='';$('apply-reroll').disabled=!$('reroll-result').value;};
$('reroll-name').oninput=()=>{$('reroll-result').value='';$('apply-reroll').disabled=true;};
for(const key of ['dot','reroll'])$(`skill-${key}`).onchange=()=>{
  try{
    const value=$(`skill-${key}`).value;
    if(!value.trim())throw new Error(t('스킬 개수는 0 이상의 정수로 입력하세요.'));
    const next=skillCounts({...state.skills,[key]:Number(value)});
    remember();state.skills=next;placement=null;hover=null;mode='paint';changed();
    message(()=>(t('스킬 보유 개수를 저장했습니다. 세 조각 모두 배치하는 생존을 우선하고, 스킬을 포함해 점수를 비교합니다.')));
  }catch(error){$(`skill-${key}`).value=state.skills[key];message(()=>(t(error.message)),true);}
};
$('show-all').onclick=()=>{preview=-2;placement=null;hover=null;mode='paint';renderBoard();renderTray();renderRecommendations();renderPip();};
$('search-blocks').oninput=renderLibrary;
function bindNameEnter(input,submit){
  let composing=false,pending=false;
  const flush=()=>{if(pending&&!composing){pending=false;submit();}};
  input.addEventListener('compositionstart',()=>{composing=true;});
  // Final input follows compositionend. Read the committed Hangul, once.
  input.addEventListener('compositionend',()=>{composing=false;setTimeout(flush,0);});
  input.addEventListener('keydown',event=>{
    if(event.key!=='Enter'||event.repeat)return;
    if(event.isComposing||composing||event.keyCode===229){pending=true;setTimeout(flush,0);return;}
    event.preventDefault();pending=false;submit();
  });
  input.addEventListener('blur',()=>{pending=false;});
}
bindNameEnter($('search-blocks'),chooseThreeFromSearch);
bindNameEnter($('reroll-name'),rerollByName);
$('resize-board').onclick=()=>{const cols=+$('cols').value,rows=+$('rows').value;if(!Number.isInteger(cols)||cols<2||cols>20||!Number.isInteger(rows)||rows<2||rows>40){message(()=>(t('보드 크기는 2–20열, 2–40행으로 입력하세요.')),true);return;}remember();state.board=Array.from({length:rows},(_,i)=>(state.board[i]||0)&((1<<cols)-1));state.cols=cols;state.rows=rows;state.skillIcons=(state.skillIcons||[]).filter(icon=>icon.x<cols&&icon.y<rows);state.skillIconOrder=remainingIconOrder(state);placement=null;hover=null;changed();message(()=>(t('보드 크기를 적용했습니다. 잘려 나간 칸은 되돌리기로 복구할 수 있습니다.')));};
for(const id of ['rotate','reflect'])$(id).onchange=()=>{remember();state.options[id]=$(id).checked;placement=null;hover=null;changed();};
$('add-examples').onclick=async()=>{
  try{
    const response=await fetch('/example-blocks.json');if(!response.ok)throw new Error(t('예제 목록을 읽지 못했습니다.'));
    const {blocks}=await response.json(),known=new Set(state.blocks.map(b=>shapeKey(b.cells)));
    const additions=blocks.filter(b=>{const key=shapeKey(b.cells);if(known.has(key))return false;known.add(key);return true;}).map(b=>({...b,id:uid()}));
    if(state.blocks.length+additions.length>500)throw new Error(t('블록은 최대 500개까지 저장할 수 있습니다.'));
    remember();state.blocks.push(...additions);changed({search:false});message(()=>(t`${additions.length}개 예제 블록을 추가했습니다. 회전·반전으로 같은 모양은 건너뛰었습니다.`));
  }catch(error){message(()=>(t(error.message)),true);}
};
$('merge-blocks').onclick=()=>{
  const merged=deduplicateLibrary(state);if(!merged.groups.length){message(()=>(t('회전·반전 중복 블록이 없습니다.')));return;}
  remember();state=merged.state;changed();message(()=>(t`${merged.groups.reduce((n,g)=>n+g.removed.length,0)}개 중복을 정리하고 출현 횟수가 많은 블록에 통계를 합쳤습니다.`));
};
$('export-blocks').onclick=()=>{const blob=new Blob([JSON.stringify({version:1,blocks:state.blocks},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='moa-blocks.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import-blocks').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  try {if(file.size>1_000_000)throw new Error(t('1MB 이하의 JSON 파일을 선택하세요.'));const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.blocks)||data.blocks.length>500)throw new Error(t('블록 내보내기로 만든 JSON 파일을 선택하세요.'));
    const additions=[];for(const b of data.blocks){if(typeof b.name!=='string'||!b.name.trim()||b.name.length>60||!Array.isArray(b.cells)||!b.cells.length||b.cells.length>100||b.cells.some(c=>!Array.isArray(c)||c.length!==2||c.some(n=>!Number.isInteger(n)||n<0||n>=10)))throw new Error(t('올바르지 않은 블록 데이터가 있습니다.'));const cells=normalize(b.cells);if(![...state.blocks,...additions].some(existing=>shapeKey(existing.cells)===shapeKey(cells)))additions.push({id:uid(),name:b.name.trim(),cells});}
    if(state.blocks.length+additions.length>500)throw new Error(t('블록은 최대 500개까지 저장할 수 있습니다.'));remember();state.blocks.push(...additions);changed({search:false});message(()=>(t`${additions.length}개 블록을 추가했습니다. 같은 모양은 건너뛰었습니다.`));
  }catch(error){message(()=>(t(error.message)),true);}finally{event.target.value='';}
};
document.addEventListener('keydown',event=>{
  if(document.querySelector('dialog[open]')||event.target.matches('input,select,textarea')||event.ctrlKey||event.metaKey)return;
  if(event.key==='Escape')setMode('paint');if(event.key.toLowerCase()==='r')transformPlacement();if(event.key.toLowerCase()==='f')transformPlacement(true);
});
window.addEventListener('beforeunload',event=>{if(revision!==savedRevision){event.preventDefault();event.returnValue='';}});
async function boot() {
  document.querySelector('main').inert=true;$('new-block').disabled=true;
  try {
    const response=await fetch('/api/state');const data=await response.json();if(!response.ok)throw new Error(data.error||t('저장 파일을 읽지 못했습니다.'));state=data;
    stagePersistenceSupported=Object.hasOwn(data,'clearedLines')&&Object.hasOwn(data,'currentScore')&&Object.hasOwn(data,'targetEnabled')&&Array.isArray(data.skillIcons)&&Array.isArray(data.skillIconOrder)&&Object.hasOwn(data,'skillSpawnRemaining')&&data.options?.strategyVersion===3&&data.captureStatsVersion===1;
    let draft;try{draft=JSON.parse(localStorage.getItem(DRAFT));}catch{}
    if(draft&&!stagePersistenceSupported){state=draft;message(()=>(t('임시 보관한 데이터를 복구했습니다. 통계와 알고리즘 설정 저장을 위해 서버를 다시 시작해 주세요.')),true);}
    else if(draft){const check=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(draft)});if(check.ok){state=draft;try{localStorage.removeItem(DRAFT);}catch{}message(()=>(t('이전에 저장하지 못한 변경을 복구해 파일에 저장했습니다.')));}else message(()=>(t('임시 데이터의 형식이 맞지 않아 기존 저장 파일을 불러왔습니다.')),true);}
    else message(()=>(state.blocks.length?t('저장한 블록과 보드를 불러왔습니다. 게임에 나온 세 조각을 선택하세요.'):t('블록 만들기에서 모양을 등록하세요. 첨부 화면의 예시 블록으로 시작할 수도 있습니다.')));
    state.captureStatsVersion=1;state.skills=skillCounts(state.skills);
    state.statistics??=emptyStatistics();
    state.clearedLines??=null;
    state.currentScore??=null;state.targetEnabled=state.targetEnabled!==false;state.skillIcons??=[];state.skillIconOrder=remainingIconOrder(state);state.skillSpawnRemaining=validateSpawnRemaining(state.skillSpawnRemaining);
    // Also correct an old running server's response or a recovered browser draft.
    const priorOptions=state.options||{},correctedGravity=priorOptions.gravity!==false;
    const upgradedStrategy=priorOptions.strategyVersion!==3||priorOptions.solverProfile!=='fast'||priorOptions.timeLimit!==850;
    state.options={solverProfile:'fast',rotate:priorOptions.rotate!==false,reflect:priorOptions.reflect!==false,gravity:false,timeLimit:850,strategyVersion:3};
    loaded=true;$('save-status').textContent=t('파일에 저장됨');render();document.querySelector('main').inert=false;$('new-block').disabled=false;
    $('stage-server-warning').hidden=stagePersistenceSupported;
    if(!stagePersistenceSupported){$('save-status').textContent=t('서버 재시작 필요');$('save-status').classList.add('error');if(draft)dirty();}
    if(correctedGravity){dirty();message(()=>(t('줄 제거 후 나머지 칸을 유지하도록 설정을 바로잡았습니다. 이미 어긋난 보드는 화면공유 탭에서 현재 게임 이미지를 붙여넣어 다시 맞춰 주세요.')));}
    else if(upgradedStrategy){dirty();message(()=>(t('1초 이내 추천으로 업데이트했습니다. 저장한 블록과 보드는 그대로 유지됩니다.')));}
  }catch(error){message(()=>(t`${t(error.message)} 서버를 실행한 뒤 새로고침해 주세요.`),true);$('save-status').textContent=t('연결 실패');$('save-status').classList.add('error');}
}
$('language').value=getLanguage();
$('language').onchange=event=>setLanguage(event.target.value);
onLanguageChange(()=>{
  const saveStatus=$('save-status').textContent;
  refreshStaticLanguage();$('language').value=getLanguage();
  studio.refreshLanguage();render();refreshMessage();capture.refreshLanguage();
  $('save-status').textContent=t(saveStatus);
  if($('block-dialog').open){$('dialog-title').textContent=editorId?t('블록 수정'):t('블록 만들기');renderDots();setEditorError(editorError);}
});
boot();
