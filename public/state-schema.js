import { normalize, skillCounts } from './solver.js';
import { emptyStatistics } from './statistics.js';
import {validateSkillIcons,validateManualTargets} from './targets.js';
import {validateSpawnRemaining,validateIconOrder} from './abilities.js';

export const initialState = () => ({version:1, captureStatsVersion:1, blocks:[], cols:10, rows:16, board:Array(16).fill(0), clearedLines:0, currentScore:0, targetEnabled:true, manualTargets:[], quickInput:false, skillIcons:[], skillIconOrder:[], skillSpawnRemaining:7, slots:[null,null,null], skills:{dot:0,reroll:0}, statistics:emptyStatistics(), options:{solverProfile:'fast',rotate:true,reflect:true,gravity:false,timeLimit:850,strategyVersion:3}});
function cellsValid(cells) {
  if (!Array.isArray(cells) || !cells.length || cells.length>100 || cells.some(c=>!Array.isArray(c)||c.length!==2||c.some(n=>!Number.isInteger(n)||n<0||n>=10))) throw new Error('블록 모양은 10×10 안에 1칸 이상이어야 합니다.');
  return normalize(cells);
}
function text(value,max) { if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error('블록 이름 또는 ID가 올바르지 않습니다.'); return value.trim(); }
function statisticsValid(value) {
  if(value===undefined)return emptyStatistics();
  if(!value||!Array.isArray(value.entries)||value.entries.length>5000)throw new Error('출현 통계 형식이 올바르지 않습니다.');
  let total=0;
  const entries=value.entries.map(entry=>{
    if(!entry||![entry.normal,entry.reroll].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('출현 횟수는 0 이상의 정수여야 합니다.');
    total+=entry.normal+entry.reroll;
    const clean={blockId:entry.blockId===null?null:text(entry.blockId,80),name:text(entry.name,60),normal:entry.normal,reroll:entry.reroll};
    if(Object.hasOwn(entry,'stages')){
      if(!entry.stages||typeof entry.stages!=='object'||Array.isArray(entry.stages))throw new Error('단계별 통계 형식이 올바르지 않습니다.');
      const sums={normal:0,reroll:0};clean.stages={};
      for(const [stage,counts] of Object.entries(entry.stages)){
        if(!/^[1-5]$/.test(stage)||!counts||typeof counts!=='object'||Array.isArray(counts)||![counts.normal,counts.reroll].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('단계별 출현 횟수가 올바르지 않습니다.');
        sums.normal+=counts.normal;sums.reroll+=counts.reroll;
        clean.stages[stage]={normal:counts.normal,reroll:counts.reroll};
      }
      if(![sums.normal,sums.reroll].every(Number.isSafeInteger)||sums.normal>entry.normal||sums.reroll>entry.reroll)throw new Error('단계별 횟수의 합이 전체 출현 횟수를 초과합니다.');
    }
    return clean;
  });
  if(!Number.isSafeInteger(total)||new Set(entries.map(entry=>entry.blockId)).size!==entries.length)throw new Error('출현 통계가 중복되거나 범위를 초과했습니다.');
  return {entries};
}
export function validateState(input) {
  if (!input || input.version!==1) throw new Error('지원하지 않는 저장 형식입니다.');
  const {cols,rows}=input;
  const currentScore=input.currentScore??null;
  if(currentScore!==null&&(!Number.isInteger(currentScore)||currentScore<0||currentScore>500000))throw new Error('현재 점수는 0~500,000 사이의 정수 또는 미상으로 입력하세요.');
  if(input.targetEnabled!==undefined&&typeof input.targetEnabled!=='boolean')throw new Error('목표 점수 사용 설정이 올바르지 않습니다.');
  const manualTargets=validateManualTargets(input.manualTargets);
  if(input.quickInput!==undefined&&typeof input.quickInput!=='boolean')throw new Error('빠른 입력 설정이 올바르지 않습니다.');
  const clearedLines=Object.hasOwn(input,'clearedLines')?input.clearedLines:null;
  if(clearedLines!==null&&(!Number.isSafeInteger(clearedLines)||clearedLines<0))throw new Error('누적 제거 줄 수는 0 이상의 정수 또는 미상이어야 합니다.');
  if(!Number.isInteger(cols)||cols<2||cols>20||!Number.isInteger(rows)||rows<2||rows>40) throw new Error('보드는 2–20열, 2–40행이어야 합니다.');
  if(!Array.isArray(input.board)||input.board.length!==rows||input.board.some(n=>!Number.isInteger(n)||n<0||n>=2**cols)) throw new Error('보드 칸 데이터가 올바르지 않습니다.');
  if(!Array.isArray(input.blocks)||input.blocks.length>500) throw new Error('블록은 최대 500개까지 저장할 수 있습니다.');
  const blocks=input.blocks.map(b=>({id:text(b.id,80),name:text(b.name,60),cells:cellsValid(b.cells)}));
  if(new Set(blocks.map(b=>b.id)).size!==blocks.length) throw new Error('블록 ID가 중복됩니다.');
  if(!Array.isArray(input.slots)||input.slots.length!==3) throw new Error('보유 칸은 3개여야 합니다.');
  const slots=input.slots.map(s=>{
    if(s===null)return null;
    const clean={instanceId:text(s.instanceId,80),blockId:text(s.blockId,80),name:text(s.name,60),cells:cellsValid(s.cells),used:!!s.used,drawRecorded:s.drawRecorded===true,demo:s.demo===true,unidentified:s.unidentified===true};
    if(Object.hasOwn(s,'capturePending'))clean.capturePending=s.capturePending===true;
    if(Object.hasOwn(s,'drawSource')){
      if(!['normal','reroll'].includes(s.drawSource))throw new Error('조각 출현 경로가 올바르지 않습니다.');
      clean.drawSource=s.drawSource;
    }
    if(Object.hasOwn(s,'drawStage')){
      if(s.drawStage!==null&&(!Number.isInteger(s.drawStage)||s.drawStage<1||s.drawStage>5))throw new Error('조각 출현 단계가 올바르지 않습니다.');
      clean.drawStage=s.drawStage;
    }
    return clean;
  });
  const instances=slots.filter(Boolean).map(s=>s.instanceId);
  if(new Set(instances).size!==instances.length) throw new Error('보유 조각 ID가 중복됩니다.');
  const o=input.options||{};
  const skillIcons=validateSkillIcons(input.skillIcons,cols,rows),skillIconOrder=validateIconOrder(input.skillIconOrder,skillIcons),skillSpawnRemaining=validateSpawnRemaining(input.skillSpawnRemaining);
  // Keep the user's board and transforms, retiring slower profiles and falling rows.
  return {version:1,captureStatsVersion:1,blocks,cols,rows,board:input.board.slice(),clearedLines,currentScore,targetEnabled:input.targetEnabled!==false,manualTargets,quickInput:input.quickInput===true,skillIcons,skillIconOrder,skillSpawnRemaining,slots,skills:skillCounts(input.skills),statistics:statisticsValid(input.statistics),options:{solverProfile:'fast',rotate:o.rotate!==false,reflect:o.reflect!==false,gravity:false,timeLimit:850,strategyVersion:3}};
}
