// Optional, explicitly launched full games; this module never launches a server.
// A score cap is a display rule, not a simulated death or a stopping condition.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cpus,totalmem,setPriority,constants} from 'node:os';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {atomicJson} from './atomic-json.mjs';
import {createGame,deal,legalMoves,isDead,playMove,rerollPiece} from './game-model.mjs';
import {place} from '../public/solver.js';
import {createEvaluator} from '../public/policy.js';
import {TARGET_SCORES} from '../public/targets.js';
import {catalogueFromState,createDrawModel,validateResume,predictionAtStep,recordTargetArrival} from './target-benchmark-support.mjs';
import {recommendedParallelism,createResourceBudget} from './target-resource-budget.mjs';
import {createProgressDisplay,targetProgress} from './target-progress.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('node tests/target-benchmark.mjs [--seed 509] [--pairs 3] [--parallel 3] [--run RUN_ID] [--output-dir PATH] [--input SNAPSHOT]\n기본은 3개 시드의 목표 ON/OFF 총 6게임입니다. 병렬 계산은 사양에 맞춰 1~4개, 저우선순위/휴식/부하 감속을 적용합니다.\n현재 점수, 다음 목표까지 남은 점수, 정확한 도달 이력을 진행 막대로 표시합니다. 목표와 50만점에 도달해도 실제 사망까지 계속합니다.\n--run은 같은 코드와 입력을 재개합니다. Ctrl+C는 사망으로 처리하지 않고 저장 후 중지합니다.');
  process.exit(0);
}
function argument(name,fallback){const index=args.indexOf(name);return index<0?fallback:args[index+1];}
for(let i=0;i<args.length;i+=2)assert.ok(['--seed','--run','--pairs','--parallel','--output-dir','--input'].includes(args[i])&&args[i+1],`알 수 없거나 값이 없는 인수: ${args[i]}`);
const resume=argument('--run',null),requestedSeed=Number(argument('--seed','509')),requestedPairs=Number(argument('--pairs','3'));
const requestedParallel=Number(argument('--parallel',String(recommendedParallelism())));
assert.ok(Number.isInteger(requestedParallel)&&requestedParallel>=1&&requestedParallel<=4,'병렬 계산은 1~4개 사이입니다.');
const maxParallel=Math.min(recommendedParallelism(),requestedParallel);
assert.ok(Number.isInteger(requestedPairs)&&requestedPairs>=1&&requestedPairs<=4,'시드 쌍은 1~4개(총 2~8게임)입니다.');
assert.ok(Number.isInteger(maxParallel)&&maxParallel>=1&&maxParallel<=4,'병렬 계산은 1~4개 사이입니다.');
assert.ok(!(resume&&args.includes('--input')),'재개는 최초 입력 스냅샷을 사용합니다.');
assert.ok(Number.isInteger(requestedSeed)&&requestedSeed>=0&&requestedSeed<2**32,'시드는 0~4294967295 정수입니다.');
const runId=resume||`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`;
assert.match(runId,/^[a-zA-Z0-9_-]+$/);
const outputDir=path.resolve(argument('--output-dir','test-results'));
const base=path.join(outputDir,`targets-${runId}`),snapshotPath=`${base}-input.json`;
await mkdir(outputDir,{recursive:true});
const targets=new Set(TARGET_SCORES);
assert.ok(targets.size>0&&[...targets].every(Number.isSafeInteger),'TARGET_SCORES must contain integer scores.');
const algorithmFiles=['../public/solver.js','../public/fast.js','../public/search.js','../public/policy.js','../public/targets.js','./game-model.mjs','./target-worker.mjs','./target-benchmark.mjs','./target-benchmark-support.mjs','./target-resource-budget.mjs','./atomic-json.mjs'];
const hashes={};
for(const file of algorithmFiles)hashes[file]=createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex');
async function captureInput(){
  let catalogue,source;
  const inputPath=argument('--input',null);
  if(inputPath){
    const supplied=JSON.parse(await readFile(path.resolve(inputPath),'utf8'));catalogue=supplied.catalogue??catalogueFromState(supplied);source=`명시한 입력: ${path.resolve(inputPath)}`;
  }else try{
    const state=JSON.parse(await readFile(new URL('../data/state.json',import.meta.url),'utf8'));
    catalogue=catalogueFromState(state);
    source='data/state.json의 조각 및 출현 횟수를 읽기 전용 복사';
  }catch(error){
    const fixture=JSON.parse(await readFile(new URL('./fixtures/observed-speed-comparison.json',import.meta.url),'utf8'));
    catalogue=fixture.catalogue;source='tests/fixtures/observed-speed-comparison.json 예비 자료';
    console.warn(`현재 통계를 읽을 수 없어 예비 자료를 사용합니다: ${error.message}`);
  }
  return {version:2,createdAt:new Date().toISOString(),seed:requestedSeed,pairs:requestedPairs,source,catalogue};
}
const snapshot=resume?JSON.parse(await readFile(snapshotPath,'utf8')):await captureInput();
assert.ok(Array.isArray(snapshot.catalogue)&&snapshot.catalogue.length>0&&snapshot.catalogue.length<=500,'조각 목록은 1~500개여야 합니다.');
if(resume&&args.includes('--seed'))assert.equal(snapshot.seed,requestedSeed,'재개 시드는 최초 실행 시드와 같아야 합니다.');
assert.equal(snapshot.version,2,'이전 실행 형식입니다. 새 병렬 비교를 시작하세요.');
if(resume&&args.includes('--pairs'))assert.equal(snapshot.pairs,requestedPairs,'재개 시 게임 수는 최초 실행과 같아야 합니다.');
const seed=snapshot.seed,catalogue=snapshot.catalogue,pairs=snapshot.pairs;
assert.ok(Number.isInteger(pairs)&&pairs>=1&&pairs<=4,'저장된 게임 수를 확인하세요.');
const jobs=Array.from({length:pairs},(_,i)=>['normal','target'].map(mode=>({gameId:`${i+1}-${mode}`,mode,seed:(seed+i)>>>0}))).flat();
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<2**32,'저장된 입력의 시드가 올바르지 않습니다.');
hashes.input=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
if(!resume)await atomicJson(snapshotPath,snapshot);
const drawModel=createDrawModel(catalogue),weights=drawModel.weights;
const statistics={entries:catalogue.map(b=>({blockId:b.id,name:b.name,normal:b.normal,reroll:b.reroll,stages:b.stages||{}}))};
const hardware={cpu:cpus()[0]?.model,threads:cpus().length,memoryGiB:Math.round(totalmem()/2**30)};
const conditions=[
  '배치 점수는 조각 칸 수, 점 찍기는 1점. 한 행동에서 동시에 제거한 가로줄 n개는 300 × n²점이며 실제 능력 획득은 개당 50점을 추가함.',
  '일반 조각 7회 배치마다 능력 아이콘 생성. 보드에 3개를 초과하면 가장 오래된 아이콘부터 사라지며 소멸에는 점수·스킬 획득이 없음.',
  '동일 시드의 일반 추첨/바꾸기/아이콘 위치/아이콘 종류 독립 난수열. 두 모드는 게임 진행에 따라 다른 횟수로 소비할 수 있음.',
  '단계별 표본이 있으면 전체 통계 30회분으로 보정. 단계 표본이 없으면 전체 통계 사용. 일반 전체 통계는 조각별 +1, 바꾸기는 일반 비율 30회분 보정.',
  '추첨에는 위 단계별 모형을 적용하지만 추천 알고리즘의 미래 시나리오 평가에는 현재 구현대로 전체 통계를 전달함. 두 모드는 동일한 조건.',
  '실게임의 단계별 정확한 확률은 알려지지 않으므로 실제 점수를 보장하지 않음.',
  '아이콘 생성 위치는 빈칸 균등 모형, 점 40%/바꾸기 60%, 획득 +50. 현재 보이는 아이콘 위치/종류만 두 모드에 똑같이 전달하며 미래 생성 위치/종류는 전달하지 않음.',
  '목표 도달은 개별 행동 후 실제 시뮬레이터 점수로만 집계. 도달해도 나머지 계획을 수행하고 사망까지 계속함.',
  '50만점은 표시 상한이며 종료 조건이 아님. 사용자 중지, 오류, 시간 초과를 사망으로 분류하지 않음.',
  '계산 시간은 준비된 Worker와의 왕복. 대기/휴식 시간은 별도이며 각 시드마다 목표 ON/OFF를 비교. 병렬 실행 속도는 단독 실행과 다를 수 있음.',
  '낮은 프로세스 우선순위, 계산 후 동일 길이 이상 휴식. 전체 CPU 60% 이상이면 1개로 감속, 85% 이상 또는 메모리 부족이면 새 계산 대기. 기존 계산은 완료 후 감속.',
];
let stopped=false,stopReason=null;
const requestStop=()=>{stopped=true;stopReason='stopped-by-user';};
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
// Also permits a local parent process to request the same graceful stop.
process.on('message',message=>{if(message?.type==='stop')requestStop();});
let priority='낮음';try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{priority='기본 (낮춤 실패, 휴식 제한 적용)';}
const budget=createResourceBudget({maxParallel,shouldStop:()=>stopped}),display=createProgressDisplay();
const latestReports=new Map();
const liveReports=new Map(jobs.map(job=>[job.gameId,{...job,status:'queued',score:0,hits:[],completedBatches:0}]));
function progressSnapshot(){const games=[...liveReports.values()];return {runId,jobs:jobs.length,...budget.snapshot(),priority,
  status:stopped?stopReason:games.every(game=>game.status==='dead')?'completed':'running',games};}
function updateProgress(){display.update(progressSnapshot());}
// Validate every checkpoint before any game mutates a file or starts a worker.
// A missing game can restart from its input snapshot without changing others.
const savedGames=new Map();
if(resume)for(const job of jobs){
  const {mode,seed:jobSeed,gameId}=job;
  let saved;
  try{saved=JSON.parse(await readFile(`${base}-${gameId}-checkpoint.json`,'utf8'));}
  catch(error){if(error.code!=='ENOENT')throw error;console.warn(`[${gameId}] 체크포인트가 없어 동일한 입력/시드로 처음부터 시작합니다.`);continue;}
  validateResume(saved,{mode,seed:jobSeed,hashes});assert.equal(saved.gameId,gameId);savedGames.set(gameId,saved);
}
console.log(`실행 ID: ${runId}\n입력: ${snapshot.source}\n${pairs}개 시드 / ${jobs.length}게임 / 최대 ${maxParallel}개 저부하 병렬 계산\nCtrl+C: 체크포인트 저장 후 중지\n결과: ${base}-comparison.md\n`);
updateProgress();const progressTimer=setInterval(updateProgress,1000);progressTimer.unref();

async function runGame({mode,seed,gameId}){
  const checkpointPath=`${base}-${gameId}-checkpoint.json`,reportPath=`${base}-${gameId}.json`;
  const saved=savedGames.get(gameId);
  const game=saved?.game??createGame(),rng=saved?.rng??{normal:seed>>>0,reroll:(seed^0x91843)>>>0,icon:(seed^0x981673)>>>0,type:(seed^0x328976)>>>0};
  const random=key=>()=>{rng[key]=(Math.imul(rng[key],1664525)+1013904223)>>>0;return rng[key]/4294967296;};
  const draws=random('normal'),replacements=random('reroll'),icons=random('icon'),types=random('type');
  const ledger=saved?.ledger??{calls:0,totalMs:0,maxMs:0,over1000:0,watchdogs:0,fallbacks:0,partialPlans:0,workerStartupMs:0,actions:0,
    predictions:0,predictionMisses:0,predictionHits:0,predictedHitsAtCapacity:0,completedPlansAtCapacity:0,hits:[],capReached:null,activeMs:0,cpuMicros:0,maxBatchMs:0,currentBatchMs:0,trace:[]};
  const startedAt=saved?.startedAt??new Date().toISOString(),evaluate=createEvaluator(10);
  let worker=null,nextId=0,currentStatus='running',failure=null;
  const sessionStart=performance.now(),cpuStart=process.cpuUsage();
  function summary(status){return {
    version:1,gameId,mode,targetEnabled:mode==='target',seed,runId,status,deathVerified:status==='dead',score:game.score,scoreCap:500000,rawScoreDiagnosticOnly:game.rawScore,
    completedBatches:game.batches-Number(game.pieces.some(p=>!p.used)),placements:game.placements,lines:game.lines,skills:{...game.skills},
    dotsUsed:game.dotsUsed,rerollsUsed:game.rerollsUsed,skillsAcquired:game.skillsAcquired,remaining:game.pieces.filter(p=>!p.used),board:game.board,
    hits:ledger.hits,exactTargetCount:ledger.hits.length,predictions:ledger.predictions,predictionMisses:ledger.predictionMisses,predictionHits:ledger.predictionHits,
    predictedHitsAtCapacity:ledger.predictedHitsAtCapacity,completedPlansAtCapacity:ledger.completedPlansAtCapacity,
    timing:{calls:ledger.calls,averageMs:Math.round(ledger.totalMs/(ledger.calls||1)),maxMs:Math.round(ledger.maxMs),over1000:ledger.over1000,watchdogs:ledger.watchdogs,
      workerStartupMs:Math.round(ledger.workerStartupMs),maxBatchCumulativeMs:Math.round(Math.max(ledger.maxBatchMs,ledger.currentBatchMs))},
    fallbacks:ledger.fallbacks,partialPlans:ledger.partialPlans,capReached:ledger.capReached,
    activeMs:Math.round(ledger.activeMs+performance.now()-sessionStart),processCpuMicros:ledger.cpuMicros+Object.values(process.cpuUsage(cpuStart)).reduce((a,b)=>a+b,0),
    cpuNote:'프로세스 전체의 CPU 시간이며 병행하는 모든 게임의 부하가 함께 포함됨',updatedAt:new Date().toISOString(),startedAt,
    normalSamples:catalogue.reduce((s,b)=>s+b.normal,0),rerollSamples:catalogue.reduce((s,b)=>s+b.reroll,0),stageProbabilityModel:drawModel.description,conditions,hardware,hashes,error:failure,
    targetProgress:targetProgress(game.score,ledger.hits),resources:{maxParallel,priority},
  };}
  async function save(status){
    const report=summary(status);
    await atomicJson(checkpointPath,{version:1,gameId,mode,seed,hashes,startedAt,status,game,rng,
      ledger:{...ledger,activeMs:report.activeMs,cpuMicros:report.processCpuMicros},error:failure});
    await atomicJson(reportPath,report);latestReports.set(gameId,report);liveReports.set(gameId,report);updateProgress();
    if(process.connected)process.send({type:'progress',gameId,calls:ledger.calls,status,score:game.score});
  }
  async function ready(){
    const start=performance.now();worker=new Worker(new URL('./target-worker.mjs',import.meta.url));
    await new Promise((resolve,reject)=>{
      const onError=error=>{worker.off('message',onReady);reject(error);};
      const onReady=message=>{worker.off('error',onError);message.ready?resolve():reject(new Error('잘못된 Worker 시작 메시지'));};
      worker.once('error',onError);worker.once('message',onReady);
    });ledger.workerStartupMs+=performance.now()-start;
  }
  async function recommend(input){
    if(!worker)await ready();
    const id=++nextId,start=performance.now(),active=worker;let latest=null,settled=false;
    return new Promise((resolve,reject)=>{
      const finish=(result,expired=false,error=null)=>{
        if(settled)return;settled=true;clearTimeout(timer);active.off('message',message);active.off('error',failed);active.off('exit',exited);
        error?reject(error):resolve({result,expired,elapsed:performance.now()-start});
      };
      const failed=error=>finish(null,false,error),exited=code=>failed(new Error(`Worker가 결과 없이 종료되었습니다 (${code})`));
      const message=m=>{if(m.id!==id)return;if(m.error){failed(new Error(m.error));return;}if(m.progress){if(!latest?.complete||m.result.complete)latest=m.result;}else finish(m.result);};
      const timer=setTimeout(()=>{worker=null;finish(latest,true);void active.terminate();},950);
      active.on('message',message);active.once('error',failed);active.once('exit',exited);active.postMessage({id,input});
    });
  }
  function recordAction(kind,expected=null){
    ledger.actions++;
    recordTargetArrival(ledger.hits,{score:game.score,action:ledger.actions,call:ledger.calls,batch:game.batches,kind,placements:game.placements,
      skillTotal:game.skills.dot+game.skills.reroll});
    if(expected!==null&&targets.has(expected)){
      ledger.predictions++;
      if(game.score===expected)ledger.predictionHits++;else ledger.predictionMisses++;
      if(game.score===expected&&game.skills.dot+game.skills.reroll>=7)ledger.predictedHitsAtCapacity++;
    }
    if(game.score===500000&&!ledger.capReached)ledger.capReached={calls:ledger.calls,batch:game.batches,placements:game.placements};
  }
  function audit(){
    let occupied=0;for(let row of game.board)while(row){row&=row-1;occupied++;}
    assert.equal(game.placementScore,game.lines*10+occupied,'보드 칸 수 보존 (점 찍기 1점 포함)');
    assert.equal(game.skillsAcquired,game.dotsUsed+game.rerollsUsed+game.skills.dot+game.skills.reroll,'스킬 수 보존');
    assert.equal(game.spawned,game.skillsAcquired+game.expired+game.icons.length,'아이콘 수 보존');
    assert.equal(game.rawScore,game.placementScore+game.lineScore+game.acquisitionScore,'점수 항목 합');
    assert.ok(game.skills.dot>=0&&game.skills.reroll>=0&&game.skills.dot+game.skills.reroll<=7,'실제 보유 한도');
    assert.equal(game.score,Math.min(500000,game.rawScore),'표시 점수 상한');
  }
  function fallback(){
    ledger.fallbacks++;const legal=legalMoves(game);
    const atCapacity=game.skills.dot+game.skills.reroll===7;
    function spendReroll(){
      const piece=game.pieces.filter(p=>!p.used).sort((a,b)=>b.cells.length-a.cells.length)[0];
      rerollPiece(game,piece.id,catalogue,weights(game.stage,'reroll'),replacements);recordAction('fallback-reroll');
    }
    function spendDot(){
      let chosen=null,value=-Infinity;
      for(let y=0;y<16;y++)for(let x=0;x<10;x++){
        const next=place(game.board,10,[[0,0]],x,y);if(!next)continue;
        const wouldCollect=game.icons.some(icon=>next.cleared.includes(icon.y));
        const quality=300*next.cleared.length**2+evaluate(next.board)-(atCapacity&&wouldCollect?100000:0);
        if(quality>value){chosen={kind:'dot',cells:[[0,0]],x,y};value=quality;}
      }
      assert.ok(chosen,'점 스킬을 보유했으나 빈칸이 없습니다.');playMove(game,chosen,icons,types);recordAction('fallback-dot');
    }
    // The same backup policy is used by both modes. If the solver supplied no
    // action at capacity, make room before continuing ordinary placements.
    if(atCapacity&&game.skills.reroll){spendReroll();return;}
    if(atCapacity&&game.skills.dot){spendDot();return;}
    if(legal.length){
      let chosen=legal[0],value=-Infinity;
      for(const move of legal){const next=place(game.board,10,move.cells,move.x,move.y),quality=300*next.cleared.length**2+evaluate(next.board);if(quality>value){chosen=move;value=quality;}}
      playMove(game,chosen,icons,types);recordAction('fallback-piece');
    }else if(game.skills.reroll)spendReroll();
    else if(game.skills.dot)spendDot();
    else assert.ok(isDead(game));
  }
  try{
    if(!game.pieces.length)deal(game,catalogue,weights(game.stage,'normal'),draws);
    await save(isDead(game)?'dead':'running');
    while(!isDead(game)&&!stopped){
      if(game.pieces.every(p=>p.used)){
        ledger.maxBatchMs=Math.max(ledger.maxBatchMs,ledger.currentBatchMs);ledger.currentBatchMs=0;
        deal(game,catalogue,weights(game.stage,'normal'),draws);await save('running');continue;
      }
      liveReports.set(gameId,{...summary('queued')});updateProgress();
      const decision=await budget.run(async()=>{
        liveReports.set(gameId,{...summary('running')});updateProgress();
        return recommend({board:game.board.slice(),cols:10,pieces:game.pieces.filter(p=>!p.used).map(p=>({...p})),catalogue,statistics,
          currentScore:game.score,targetEnabled:mode==='target',skills:{...game.skills},skillIcons:game.icons.map(icon=>({...icon})),options:{rotate:true,reflect:true,gravity:false,timeLimit:850}});
      });
      ledger.calls++;ledger.totalMs+=decision.elapsed;ledger.maxMs=Math.max(ledger.maxMs,decision.elapsed);ledger.over1000+=Number(decision.elapsed>1000);ledger.watchdogs+=Number(decision.expired);
      const result=decision.result;let actions=0;
      // Execute every legal action, even when an earlier prefix hits a target.
      // Only compare a solver-declared hit at its declared step. New icons may
      // spawn during the plan and produce an unpredicted acquisition bonus.
      for(const [index,move] of (result?.moves||[]).entries()){
        assert.deepEqual(move.boardBefore,game.board,'추천 시작 보드 불일치');
        playMove(game,move,icons,types);
        const expected=predictionAtStep(result,index);
        recordAction(move.kind||'piece',expected);actions++;
      }
      if(result?.reroll){rerollPiece(game,result.reroll.pieceId,catalogue,weights(game.stage,'reroll'),replacements);recordAction('reroll');actions++;}
      if(result?.complete&&game.skills.dot+game.skills.reroll>=7)ledger.completedPlansAtCapacity++;
      if(result&&!result.complete&&result.moves?.length)ledger.partialPlans++;
      if(!actions&&!isDead(game))fallback();audit();
      ledger.currentBatchMs+=decision.elapsed;
      ledger.trace.push({call:ledger.calls,batch:game.batches,score:game.score,elapsedMs:Math.round(decision.elapsed),complete:!!result?.complete,watchdog:decision.expired,targetCount:ledger.hits.length});
      if(ledger.trace.length>1000)ledger.trace.splice(0,ledger.trace.length-1000);
      await save(isDead(game)?'dead':'running');
    }
    currentStatus=isDead(game)?'dead':stopReason||'stopped-after-peer-error';
  }catch(error){if(error.code==='BENCHMARK_STOPPED')currentStatus=stopReason||'stopped-by-user';else{currentStatus='error';failure=error.stack||String(error);stopped=true;stopReason??='stopped-after-peer-error';}}
  finally{
    await worker?.terminate();await save(currentStatus);
  }
  return latestReports.get(gameId);
}

const outcomes=await Promise.allSettled(jobs.map(job=>runGame(job).catch(error=>{stopped=true;stopReason??='stopped-after-peer-error';throw error;})));
clearInterval(progressTimer);budget.close();display.close(progressSnapshot());
for(const [index,outcome] of outcomes.entries())if(outcome.status==='rejected'){
  console.error(`${jobs[index].gameId} 실행 실패: ${outcome.reason.stack||outcome.reason}`);process.exitCode=1;
}
const reports=[...latestReports.values()].sort((a,b)=>a.gameId.localeCompare(b.gameId));
const allDead=reports.length===jobs.length&&reports.every(report=>report.deathVerified);
const lines=['# 목표 점수 병렬 테스트','',`실행 ID: ${runId} · 시드 ${seed}부터 ${pairs}쌍 · ${jobs.length}게임 · 최대 ${maxParallel}개 동시 계산`,'',
  allDead?'모든 게임의 실제 사망을 확인했습니다.':'중간 종료 또는 오류를 포함합니다. 사망이 확인된 행만 최종 게임 점수입니다.','',
  '| 게임 | 시드 | 상태 | 점수 | 다음 목표 / 남은 점수 | 실제 목표 도달 | 평균 / 최대 추천 시간 |',
  '|---|---:|---|---:|---|---:|---:|'];
for(const report of reports){const next=targetProgress(report.score,report.hits);lines.push(`| ${report.gameId} | ${report.seed} | ${report.status} | ${report.score.toLocaleString()} | ${next.nextTarget?.toLocaleString()??'목록 종료'} / ${next.nextTarget?next.remaining.toLocaleString():'—'} | ${report.exactTargetCount} | ${report.timing.averageMs} / ${report.timing.maxMs} ms |`);}
for(const report of reports)lines.push('',`${report.gameId} (${report.mode==='target'?'목표 ON':'목표 OFF'}) 실제 도달 점수: ${report.hits.map(hit=>hit.score.toLocaleString()).join(', ')||'없음'}`,
  `스킬 7개 미만으로 정지할 수 있었던 목표: ${report.hits.filter(hit=>hit.canStopBelowSkillCap).map(hit=>hit.score.toLocaleString()).join(', ')||'없음'}. 예상 목표 불일치 ${report.predictionMisses}/${report.predictions}회, 보완 정책 ${report.fallbacks}회.`,
  ...(report.error?[`오류: ${report.error}`]:[]));
lines.push('','목표는 100,000점 이상 16개입니다. 정확히 같은 점수를 기록했을 때만 도달 이력에 남습니다. 점수를 건너뛰어 넘어간 것은 도달로 집계하지 않습니다. 도달 이력은 이후 점수가 높아져도 유지하며 게임은 사망까지 계속합니다. 도달 횟수는 서로 다른 정확한 점수의 개수이며 실게임 성공률을 뜻하지 않습니다.','',...conditions.map(condition=>`- ${condition}`),'',`재개: node tests/target-benchmark.mjs --run ${runId} --output-dir "${outputDir}"`,'');
await writeFile(`${base}-comparison.md`,lines.join('\n'));
console.log(`\n비교 보고서: ${base}-comparison.md`);
if(reports.some(report=>report.status==='error'))process.exitCode=1;
if(process.connected)process.disconnect();
