import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {isDead} from './game-model.mjs';
const prefix=process.env.SPEED_REPORT||'speed-comparison-v1',seed=Number(process.env.SPEED_SEED||509);
assert.match(prefix,/^[a-zA-Z0-9_-]+$/);assert.ok(Number.isInteger(seed));
const reports=[];
for(const variant of ['original','fast']){
  try{
    const root=`test-results/${prefix}-${variant}-${seed}`,report=JSON.parse(await readFile(`${root}.json`,'utf8'));
    if(report.deathVerified){const checkpoint=JSON.parse(await readFile(`${root}-checkpoint.json`,'utf8'));assert.ok(isDead(checkpoint.game),'Terminal board must pass the independent legal-move/death check');}
    reports.push({...report,stale:report.status==='running'&&Date.now()-Date.parse(report.updatedAt)>30000});
  }catch(error){if(error.code!=='ENOENT')throw error;reports.push({variant,status:'not-started',deathVerified:false});}
}
const final=reports.every(r=>r.deathVerified),stopped=reports.every(r=>r.status==='stopped-by-user'),fmt=n=>n===undefined?'—':n.toLocaleString('en-US');
const lines=[`# 원본 / 1초 버전 비교 · seed ${seed}`,'',`조회: ${new Date().toISOString()}`,'',
  '과거 실행 당시 점 찍기의 배치 1점은 제외했습니다. 현재 버전은 점 찍기에도 1점을 더하며, 이 보고서는 과거 결과 수치를 그대로 표시합니다.','',
  final?'두 게임 모두 실제 사망까지 완료했습니다.':stopped?'**사용자 요청으로 두 테스트를 모두 종료했습니다. 아래는 종료 시점 기록이며 사망 점수가 아닙니다.**':'**아직 최종 점수 비교가 아닙니다. 사망이 확인된 게임만 최종 결과로 취급합니다.**','',
  '| 버전 | 상태 | 점수 | 완료 세트 | 평균 계산 | 최대 계산 | 1초 초과 | 보완 정책 |',
  '|---|---|---:|---:|---:|---:|---:|---:|'];
for(const r of reports)lines.push(`| ${r.variant==='original'?'원본 8초':'1초 버전'} | ${r.deathVerified?'사망 확인':r.status==='stopped-by-user'?'사용자 요청 종료':r.stale?'진행 갱신 없음 · 재개 확인 필요':r.status==='running'?'진행 중':r.status} | ${fmt(r.score)} | ${fmt(r.completedBatches)} | ${fmt(r.timing?.averageMs)}ms | ${fmt(r.timing?.maxMs)}ms | ${fmt(r.timing?.over1000)} | ${fmt(r.fallbacks)} |`);
if(stopped)lines.push('','1초 버전은 802번째 세트에서 표시 점수 상한 500,000점에 도달했습니다. 400,000점 초과 조건을 만족하여 사용자 요청대로 단일 기본 알고리즘으로 채택했습니다. 원본 및 기존 버전은 실행 경로에서 제거했습니다.');
lines.push('','점수 상한 500,000. 중간 점수·진행 속도로 우열을 정하지 않습니다. 일반 599회·바꾸기 18회 관측에 표본 보정을 적용했습니다. 단계별 표본이 없어 전체 관측 분포를 모든 단계에 사용하며 실게임 점수를 보장하지 않습니다. 계산 시간은 각 추천 호출의 Worker 왕복 시간이며, 새 바꾸기 결과에 대한 재추천은 별도 호출입니다. 브라우저 표시 시간은 speed-browser.json에 따로 기록합니다.','');
const text=lines.join('\n');console.log(text);
if(process.argv.includes('--write'))await writeFile(`test-results/${prefix}-comparison.md`,text);
