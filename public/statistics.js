import {blockNameIncludes} from './block-input.js';
// Counts describe confirmed observations, not the game's true odds.
export function emptyStatistics() { return {entries:[]}; }

export function stageForLines(lines) {
  if(!Number.isSafeInteger(lines)||lines<0)return null;
  return lines<=30?1:lines<=60?2:lines<=100?3:lines<=150?4:5;
}
export function addClearedLines(current,count){
  if(!Number.isSafeInteger(count)||count<0)throw new Error('제거한 줄 수가 올바르지 않습니다.');
  if(current==null)return null;
  const next=current+count;
  if(!Number.isSafeInteger(current)||current<0||!Number.isSafeInteger(next))throw new Error('누적 제거 줄 수가 저장 가능한 범위를 초과합니다.');
  return next;
}
function stageKey(stage) {
  if(stage==='all'||stage==='unknown')return stage;
  if((Number.isInteger(stage)&&stage>=1&&stage<=5)||/^[1-5]$/.test(typeof stage==='string'?stage:''))return String(stage);
  throw new Error('통계 단계는 전체, 1~5단계 또는 단계 미상으로 선택하세요.');
}
function drawStage(stage) {
  if(stage===null||(Number.isInteger(stage)&&stage>=1&&stage<=5))return stage;
  throw new Error('조각 출현 단계가 올바르지 않습니다.');
}
function cloneEntry(entry) {
  return {...entry,...(entry.stages?{stages:Object.fromEntries(Object.entries(entry.stages).map(([key,counts])=>[key,{...counts}]))}:{})};
}
function stageSums(entry) {
  const sums={normal:0,reroll:0};
  for(const counts of Object.values(entry?.stages||{})){sums.normal+=counts.normal;sums.reroll+=counts.reroll;}
  return sums;
}
function checkCounts({normal,reroll}) {
  if(![normal,reroll].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('횟수는 0 이상의 정수로 입력하세요.');
}
function checkTotal(entries) {
  const total=entries.reduce((sum,entry)=>sum+entry.normal+entry.reroll,0);
  if(!Number.isSafeInteger(total))throw new Error('전체 출현 횟수가 저장 가능한 범위를 초과합니다.');
  if(entries.length>5000)throw new Error('통계 항목이 저장 가능한 개수를 초과합니다.');
}
function addObservation(statistics, slot, source, stage) {
  const blockId=slot.unidentified?null:slot.blockId;
  const entries=(statistics?.entries||[]).map(cloneEntry);
  let entry=entries.find(entry=>entry.blockId===blockId);
  if(!entry){entry={blockId,name:blockId===null?'미분류 (화면 인식)':slot.name,normal:0,reroll:0};entries.push(entry);}
  entry[source]++;
  if(stage!==null){
    entry.stages??={};entry.stages[stage]??={normal:0,reroll:0};entry.stages[stage][source]++;
  }
  checkTotal(entries);
  return {entries};
}

// Manual selections are explicit observations. Screen recognition remains
// provisional until a placement is confirmed; retries never count a guess.
export function recordNormalDraws(state,{confirmedIds=[]}={}) {
  if(state.slots.some(slot=>!slot))return state;
  const confirmed=new Set(confirmedIds);
  let statistics=state.statistics||emptyStatistics(),changed=false;
  const slots=state.slots.map(slot=>{
    if(slot.used||slot.drawRecorded||slot.demo||(slot.capturePending&&!confirmed.has(slot.instanceId)))return slot;
    const stage=Object.hasOwn(slot,'drawStage')?drawStage(slot.drawStage):stageForLines(state.clearedLines);
    statistics=addObservation(statistics,slot,slot.capturePending&&slot.drawSource==='reroll'?'reroll':'normal',stage);changed=true;
    return {...slot,drawRecorded:true,drawStage:stage,...(slot.capturePending?{capturePending:false}:{})};
  });
  return changed?{...state,statistics,slots}:state;
}

export function recordRerollDraw(state,index) {
  const slot=state.slots[index];
  if(slot.demo)return state;
  const stage=stageForLines(state.clearedLines);
  return {...state,statistics:addObservation(state.statistics,slot,'reroll',stage),
    slots:state.slots.map((s,i)=>i===index?{...s,drawRecorded:true,drawStage:stage}:s)};
}

export function statisticsRows(state,stage='all') {
  const key=stageKey(stage);
  const entries=state.statistics?.entries||[],known=new Set(state.blocks.map(b=>b.id));
  const rows=state.blocks.map(block=>({blockId:block.id,normal:0,reroll:0,
    ...cloneEntry(entries.find(entry=>entry.blockId===block.id)||{}),name:block.name}));
  rows.push(...entries.filter(entry=>!known.has(entry.blockId)).map(cloneEntry));
  const totals={normal:0,reroll:0,total:0};
  for(const row of rows){
    if(key==='unknown'){const sums=stageSums(row);row.normal-=sums.normal;row.reroll-=sums.reroll;}
    else if(key!=='all'){const counts=row.stages?.[key];row.normal=counts?.normal||0;row.reroll=counts?.reroll||0;}
    row.total=row.normal+row.reroll;totals.normal+=row.normal;totals.reroll+=row.reroll;
  }
  totals.total=totals.normal+totals.reroll;
  return {rows,totals};
}

export function observedPercent(count,total) { return total?`${(100*count/total).toFixed(1)}%`:'—'; }

export function resetStatistics(state) {
  // Keep each current piece's draw marker so resetting does not recount it.
  return {...state,statistics:emptyStatistics()};
}

export function statisticsView(state,{query='',sort='total',stage='all'}={}) {
  const {rows,totals}=statisticsRows(state,stage);
  const filtered=rows.filter(row=>blockNameIncludes(row.name,query));
  const column=['normal','reroll','total'].includes(sort)?sort:null;
  filtered.sort((a,b)=>(column?b[column]-a[column]:0)||a.name.localeCompare(b.name,'ko')||String(a.blockId).localeCompare(String(b.blockId)));
  // Filtering changes visibility only; denominators always cover every draw.
  return {rows:filtered,totals};
}

export function setObservationCounts(state,blockId,{normal,reroll},stage='all') {
  checkCounts({normal,reroll});const key=stageKey(stage);
  const entries=state.statistics?.entries||[],previous=entries.find(entry=>entry.blockId===blockId);
  const block=state.blocks.find(block=>block.id===blockId);
  if(!block&&!previous)throw new Error('통계를 수정할 블록을 찾지 못했습니다.');
  const replacement={blockId,name:block?.name||previous.name,normal:0,reroll:0,...cloneEntry(previous||{})};
  replacement.name=block?.name||previous.name;
  const sums=stageSums(replacement);
  if(key==='all'){
    if(normal<sums.normal||reroll<sums.reroll)throw new Error('전체 횟수는 각 단계에 기록된 횟수의 합보다 작을 수 없습니다. 단계별 횟수를 먼저 수정하세요.');
    Object.assign(replacement,{normal,reroll});
  }else if(key==='unknown'){
    replacement.normal=sums.normal+normal;replacement.reroll=sums.reroll+reroll;
  }else{
    const old=replacement.stages?.[key]||{normal:0,reroll:0};
    replacement.normal+=normal-old.normal;replacement.reroll+=reroll-old.reroll;
    replacement.stages={...replacement.stages,[key]:{normal,reroll}};
    if(!normal&&!reroll)delete replacement.stages[key];
    if(!Object.keys(replacement.stages).length)delete replacement.stages;
  }
  checkCounts(replacement);
  const updated=previous?entries.map(entry=>entry.blockId===blockId?replacement:entry):[...entries,replacement];
  checkTotal(updated);
  return {...state,statistics:{entries:updated}};
}
