import test from 'node:test';
import assert from 'node:assert/strict';
import {TARGET_SCORES,SCORE_CAP} from '../public/targets.js';
import {targetProgress,renderProgress,createProgressDisplay} from './target-progress.mjs';

const first=TARGET_SCORES[0],second=TARGET_SCORES[1];
const game=(values={})=>({gameId:'G01',mode:'target',seed:509,status:'running',score:first-5,completedBatches:123,hits:[],timing:{averageMs:450},...values});
const snapshot=(games=[game()])=>({runId:'sample',jobs:games.length,limit:2,cpuPercent:13,memoryFreeGiB:8.5,priority:'낮음',status:'running',games});

test('progress reports remaining score to the next target, not death progress',()=>{
  const p=targetProgress(first-5);
  assert.equal(p.nextTarget,first);assert.equal(p.remaining,5);assert.equal(p.ratio,(first-5)/first);
  assert.deepEqual(p.achieved,[]);assert.equal(p.capReached,false);
  const rendered=renderProgress(snapshot());
  assert.match(rendered,/5점 남음/);assert.match(rendered,/게임 종료 시점은 예측하지 않습니다/);
});

test('passing and currently matching targets never invent a hit without the action ledger',()=>{
  assert.deepEqual(targetProgress(second+1).achieved,[]);
  assert.deepEqual(targetProgress(first).achieved,[]);
  assert.equal(targetProgress(first).nextTarget,second);
  const p=targetProgress(second+1,[{score:first,canStopBelowSkillCap:false},{score:second,canStopBelowSkillCap:true}]);
  assert.deepEqual(p.achieved,[{score:first,canStopBelowSkillCap:false},{score:second,canStopBelowSkillCap:true}]);
  assert.match(renderProgress(snapshot([game({score:second+1,hits:p.achieved})])),new RegExp(`\\[${first.toLocaleString('en-US')}\\*\\]`));
});

test('hit badges persist past the last target and 500k is not completion',()=>{
  const hits=TARGET_SCORES.map(score=>({score,canStopBelowSkillCap:true}));
  const p=targetProgress(SCORE_CAP,hits);
  assert.equal(p.nextTarget,null);assert.equal(p.goalScore,SCORE_CAP);assert.equal(p.remaining,0);
  assert.equal(p.ratio,1);assert.equal(p.achieved.length,TARGET_SCORES.length);assert.equal(p.capReached,true);
  const rendered=renderProgress(snapshot([game({score:SCORE_CAP,hits})]));
  assert.match(rendered,/50만점 상한 도달 · 사망까지 계속 진행/);
  assert.match(rendered,/실행 중/);assert.doesNotMatch(rendered,/사망 확인/);
  for(const score of TARGET_SCORES)assert.ok(rendered.includes(`[${score.toLocaleString('en-US')}]`));
});

test('last target uses the score cap as an explicitly labelled remaining milestone',()=>{
  const last=TARGET_SCORES.at(-1),p=targetProgress(last+1);
  assert.equal(p.nextTarget,null);assert.equal(p.remaining,SCORE_CAP-last-1);
  assert.match(renderProgress(snapshot([game({score:last+1})])),/점수 상한 500,000점/);
});

test('deduplicating hit records preserves a later safe stopping point and rejects nontargets',()=>{
  const hits=[{score:first,canStopBelowSkillCap:false},{score:first,canStopBelowSkillCap:true},{score:first,canStopBelowSkillCap:false},{score:1}];
  const before=structuredClone(hits);
  assert.deepEqual(targetProgress(second,hits).achieved,[{score:first,canStopBelowSkillCap:true}]);
  assert.deepEqual(hits,before);
  assert.equal(targetProgress(null).remaining,null);assert.equal(targetProgress(NaN).score,null);
});

test('closest running game uses distance to next target and excludes finished games',()=>{
  const rendered=renderProgress(snapshot([game({gameId:'far',score:first-10}),game({gameId:'near',score:second-2}),game({gameId:'dead',score:first-1,status:'dead'})]));
  assert.match(rendered,/목표에 가장 가까운 게임 near/);assert.match(rendered,/2점 남음/);
});

test('narrow progress output wraps names and complete hit history without overflow',()=>{
  const rendered=renderProgress(snapshot([game({gameId:'a'.repeat(80),score:SCORE_CAP,hits:TARGET_SCORES})]),{width:28});
  const columns=text=>Array.from(text).reduce((sum,char)=>sum+(/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff]/u.test(char)?2:1),0);
  for(const line of rendered.split('\n'))assert.ok(columns(line)<=28,`${columns(line)} columns: ${line}`);
  assert.equal(rendered.includes('\x1b'),false);
});

test('non-TTY display throttles snapshots and always prints the final state without escapes',()=>{
  let output='';const stream={isTTY:false,columns:80,write:text=>{output+=text;}};
  const display=createProgressDisplay({stream,intervalMs:1});
  display.update(snapshot());const firstOutput=output;
  display.update(snapshot([game({score:first-1})]));assert.equal(output,firstOutput);
  display.close(snapshot([game({score:first,status:'stopped-by-user',hits:[first]})]));
  assert.match(output,/사용자 중지/);assert.match(output,/사망 아님/);assert.equal(output.includes('\x1b'),false);
  const closed=output;display.close();display.update(snapshot());assert.equal(output,closed);
});

test('TTY display redraws its own region and restores the cursor on close',()=>{
  let output='';const stream={isTTY:true,columns:80,write:text=>{output+=text;}};
  const listeners=process.listenerCount('exit');
  const display=createProgressDisplay({stream,intervalMs:1000});display.update(snapshot());
  assert.match(output,/\x1b\[\?25l/);assert.equal(process.listenerCount('exit'),listeners+1);
  display.close(snapshot([game({status:'dead'})]));
  assert.match(output,/\x1b\[\d+A\r\x1b\[0J/);assert.ok(output.endsWith('\x1b[?25h'));
  assert.equal(process.listenerCount('exit'),listeners);assert.match(output,/사망 확인/);
});

test('small terminals page tall dashboards instead of scrolling duplicate progress fragments',()=>{
  let output='';const stream={isTTY:true,columns:70,rows:18,write:text=>{output+=text;}};
  const display=createProgressDisplay({stream});
  display.update(snapshot(Array.from({length:6},(_,i)=>game({gameId:`G${i}`,hits:TARGET_SCORES}))));
  assert.ok(output.split('\n').length<=18);assert.match(output,/\[1\/\d+\] 5s/);
  display.close();assert.ok(output.endsWith('\x1b[?25h'));
});
