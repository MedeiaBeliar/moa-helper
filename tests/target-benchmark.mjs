// Optional, explicitly launched full games; this module never launches a server.
// The comparison runs to death. The explicit 500k preset stops at the cap.
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
import {catalogueFromState,createDrawModel,validateResume,predictionAtStep,recordTargetArrival,benchmarkPreset,benchmarkJobs,benchmarkStopStatus} from './target-benchmark-support.mjs';
import {recommendedParallelism,createResourceBudget} from './target-resource-budget.mjs';
import {createProgressDisplay,targetProgress} from './target-progress.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
process.chdir(root);
const args=process.argv.slice(2);
if(args.includes('--help')){
  console.log('node tests/target-benchmark.mjs [--preset 500k] [--seed 509] [--pairs 3] [--parallel 3] [--run RUN_ID] [--output-dir PATH] [--input SNAPSHOT]\n기본은 3개 시드의 목표 ON/OFF 총 6게임입니다. 병렬 계산은 사양에 맞춰 1~4개, 저우선순위/휴식/부하 감속을 적용합니다.\n--preset 500k: 설정 없이 목표 ON 2게임, 동시 계산 2개, 휴식·부하 감속 없이 최고속도로 50만점 또는 사망까지 진행합니다.\n현재 점수, 다음 목표까지 남은 점수, 정확한 도달 이력을 진행 막대로 표시합니다. 기본 비교는 목표와 50만점에 도달해도 실제 사망까지 계속합니다.\n--run은 같은 코드와 입력을 재개합니다. Ctrl+C는 사망으로 처리하지 않고 저장 후 중지합니다.');
  process.exit(0);
}
function argument(name,fallback){const index=args.indexOf(name);return index<0?fallback:args[index+1];}
for(let i=0;i<args.length;i+=2)assert.ok(['--preset','--seed','--run','--pairs','--parallel','--output-dir','--input'].includes(args[i])&&args[i+1],`알 수 없거나 값이 없는 인수: ${args[i]}`);
const requestedPreset=benchmarkPreset(argument('--preset','comparison'));
const resume=argument('--run',null),requestedSeed=Number(argument('--seed','509')),requestedPairs=Number(argument('--pairs',String(requestedPreset.pairs)));
const requestedParallel=Number(argument('--parallel',String(recommendedParallelism())));
assert.ok(Number.isInteger(requestedParallel)&&requestedParallel>=1&&requestedParallel<=4,'병렬 계산은 1~4개 사이입니다.');
assert.ok(Number.isInteger(requestedPairs)&&requestedPairs>=1&&requestedPairs<=4,'시드 쌍은 1~4개(총 2~8게임)입니다.');
assert.ok(!(resume&&args.includes('--input')),'재개는 최초 입력 스냅샷을 사용합니다.');
assert.ok(Number.isInteger(requestedSeed)&&requestedSeed>=0&&requestedSeed<2**32,'시드는 0~4294967295 정수입니다.');
const runId=resume||`${new Date().toISOString().replace(/[:.]/g,'-')}-${process.pid}`;
assert.match(runId,/^[a-zA-Z0-9_-]+$/);
const outputDir=path.resolve(argument('--output-dir','test-results'));
const base=path.join(outputDir,`targets-${runId}`),snapshotPath=`${base}-input.json`;
await mkdir(outputDir,{recursive:true});
const targets=new Set(TARGET_SCORES);
assert.ok(targets.size>0&&[...targets].every(Number.isSafeInteger),'TARGET_SCORES must contain integer scores.');
const algorithmFiles=['../public/solver.js','../public/fast.js','../public/move-order.js','../public/search.js','../public/policy.js','../public/statistics.js','../public/targets.js','./game-model.mjs','./target-worker.mjs','./target-benchmark.mjs','./target-benchmark-support.mjs','./target-resource-budget.mjs','./atomic-json.mjs'];
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
  return {version:2,createdAt:new Date().toISOString(),seed:requestedSeed,pairs:requestedPreset.targetOnly?requestedPreset.pairs:requestedPairs,preset:requestedPreset.name,source,catalogue};
}
const snapshot=resume?JSON.parse(await readFile(snapshotPath,'utf8')):await captureInput();
const preset=benchmarkPreset(snapshot.preset??'comparison');
if(resume&&args.includes('--preset'))assert.equal(preset.name,requestedPreset.name,'재개 설정은 최초 실행과 같아야 합니다.');
const maxParallel=preset.maxSpeed?preset.parallel:Math.min(recommendedParallelism(),requestedParallel);
assert.ok(Array.isArray(snapshot.catalogue)&&snapshot.catalogue.length>0&&snapshot.catalogue.length<=500,'조각 목록은 1~500개여야 합니다.');
if(resume&&args.includes('--seed'))assert.equal(snapshot.seed,requestedSeed,'재개 시드는 최초 실행 시드와 같아야 합니다.');
assert.equal(snapshot.version,2,'이전 실행 형식입니다. 새 병렬 비교를 시작하세요.');
if(resume&&args.includes('--pairs'))assert.equal(snapshot.pairs,requestedPairs,'재개 시 게임 수는 최초 실행과 같아야 합니다.');
const seed=snapshot.seed,catalogue=snapshot.catalogue,pairs=snapshot.pairs;
assert.ok(Number.isInteger(pairs)&&pairs>=1&&pairs<=4,'저장된 게임 수를 확인하세요.');
const jobs=benchmarkJobs({seed,pairs,preset:preset.name});
assert.ok(Number.isInteger(seed)&&seed>=0&&seed<2**32,'저장된 입력의 시드가 올바르지 않습니다.');
hashes.input=createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
if(!resume)await atomicJson(snapshotPath,snapshot);
const drawModel=createDrawModel(catalogue),weights=drawModel.weights;
const statistics={entries:catalogue.map(b=>({blockId:b.id,name:b.name,normal:b.normal,reroll:b.reroll,stages:b.stages||{}}))};
const hardware={cpu:cpus()[0]?.model,threads:cpus().length,memoryGiB:Math.round(totalmem()/2**30)};
const conditions=[
  'Piece placement earns its cell count; a dot earns 1 point. Simultaneous horizontal clears earn 300 × n² points, and each acquired ability earns 50 points.',
  'Every seventh ordinary placement attempts to spawn an ability after collection, provided fewer than seven skills are held. Dot skills do not advance this counter. A fourth board icon expires the oldest without a reward.',
  'At seven held skills, icons on cleared rows stay on their original cells without granting a skill or points; no new icon spawns. Spending a skill allows collection on a later clear.',
  'Normal draws, rerolls, icon positions and icon types use independent seeded random streams. Different policies may consume different numbers of draws.',
  'Stage observations use a 30-observation overall prior; missing stages use overall counts. Normal overall counts add one per identity; rerolls use a 30-observation normal-distribution prior.',
  'The draw model and recommendation evaluator share the stage probability model. Each candidate uses the stage reached after its clears.',
  'The exact game probabilities are unpublished. Observed distributions do not guarantee real-game scores.',
  'Icons spawn uniformly over empty cells, with 40% dots and 60% rerolls. Only visible icons are supplied to the solver; future spawns are hidden.',
  preset.stopAtCap?'Automatic targets are enabled in both games. Exact arrivals are recorded after each action; play ends at 500,000 points or verified death.':'Exact target arrivals are recorded after each action. Games continue through targets and the displayed score cap until verified death.',
  preset.stopAtCap?'Cap completion is recorded as cap-reached, separately from death. Stops, errors and timeouts are not deaths.':'500,000 points is a display cap, not a stopping condition. Stops, errors and timeouts are not deaths.',
  'Calculation time is a round trip to a ready worker and excludes queueing or rest. Parallel timing can differ from isolated timing.',
  preset.maxSpeed?'Two simultaneous calculations, normal process priority, no artificial rest or load throttling. Each recommendation retains the one-second limit.':'Below-normal priority with rest after each calculation. CPU load above 60% reduces concurrency to one; load above 85% or insufficient memory suspends new calculations.',
];
let stopped=false,stopReason=null;
const requestStop=()=>{stopped=true;stopReason='stopped-by-user';};
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
// Also permits a local parent process to request the same graceful stop.
process.on('message',message=>{if(message?.type==='stop')requestStop();});
let priority=preset.maxSpeed?'기본':'낮음';if(!preset.maxSpeed)try{setPriority(0,constants.priority.PRIORITY_BELOW_NORMAL);}catch{priority='기본 (낮춤 실패, 휴식 제한 적용)';}
const budget=createResourceBudget({maxParallel,shouldStop:()=>stopped,...(preset.maxSpeed?{cooldownRatio:0,minRestMs:0,throttle:false,pollMs:5}:{})}),display=createProgressDisplay();
const latestReports=new Map();
const liveReports=new Map(jobs.map(job=>[job.gameId,{...job,status:'queued',score:0,hits:[],completedBatches:0}]));
function progressSnapshot(){const games=[...liveReports.values()];return {runId,jobs:jobs.length,...budget.snapshot(),priority,stopAtCap:preset.stopAtCap,maxSpeed:preset.maxSpeed,
  status:stopped?stopReason:games.every(game=>['dead','cap-reached'].includes(game.status))?'completed':'running',games};}
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
console.log(`실행 ID: ${runId}\n입력: ${snapshot.source}\n${pairs}개 시드 / ${jobs.length}게임 / 최대 ${maxParallel}개 ${preset.maxSpeed?'최고속도':'저부하'} 병렬 계산\nCtrl+C: 체크포인트 저장 후 중지\n결과: ${base}-comparison.md\n`);
updateProgress();const progressTimer=setInterval(updateProgress,100);progressTimer.unref();

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
    version:1,gameId,mode,targetEnabled:mode==='target',seed,runId,preset:preset.name,status,deathVerified:status==='dead',score:game.score,scoreCap:500000,rawScoreDiagnosticOnly:game.rawScore,
    completedBatches:game.batches-Number(game.pieces.some(p=>!p.used)),placements:game.placements,lines:game.lines,skills:{...game.skills},
    dotsUsed:game.dotsUsed,rerollsUsed:game.rerollsUsed,skillsAcquired:game.skillsAcquired,remaining:game.pieces.filter(p=>!p.used),board:game.board,
    boardIcons:game.icons.length,spawnRemaining:7-game.placements%7,
    hits:ledger.hits,exactTargetCount:ledger.hits.length,predictions:ledger.predictions,predictionMisses:ledger.predictionMisses,predictionHits:ledger.predictionHits,
    predictedHitsAtCapacity:ledger.predictedHitsAtCapacity,completedPlansAtCapacity:ledger.completedPlansAtCapacity,
    timing:{calls:ledger.calls,averageMs:Math.round(ledger.totalMs/(ledger.calls||1)),maxMs:Math.round(ledger.maxMs),over1000:ledger.over1000,watchdogs:ledger.watchdogs,
      workerStartupMs:Math.round(ledger.workerStartupMs),maxBatchCumulativeMs:Math.round(Math.max(ledger.maxBatchMs,ledger.currentBatchMs))},
    fallbacks:ledger.fallbacks,partialPlans:ledger.partialPlans,capReached:ledger.capReached,
    restartWarnings:ledger.restartWarnings??0,firstRestartRecommendation:ledger.firstRestartRecommendation??null,restart:ledger.lastRestartAssessment??null,
    activeMs:Math.round(ledger.activeMs+performance.now()-sessionStart),processCpuMicros:ledger.cpuMicros+Object.values(process.cpuUsage(cpuStart)).reduce((a,b)=>a+b,0),
    cpuNote:'프로세스 전체의 CPU 시간이며 병행하는 모든 게임의 부하가 함께 포함됨',updatedAt:new Date().toISOString(),startedAt,
    normalSamples:catalogue.reduce((s,b)=>s+b.normal,0),rerollSamples:catalogue.reduce((s,b)=>s+b.reroll,0),stageProbabilityModel:drawModel.description,conditions,hardware,hashes,error:failure,
    targetProgress:targetProgress(game.score,ledger.hits),resources:{maxParallel,priority,maxSpeed:preset.maxSpeed},
  };}
  function publish(status,activity='',calculationStartedAt=null){
    const report=summary(status);
    liveReports.set(gameId,{...report,activity,calculationStartedAt});updateProgress();
    return report;
  }
  async function save(status){
    // Present each action/finished set before waiting for checkpoint I/O.
    const report=publish(status,status==='running'?'저장 중':'');
    await atomicJson(checkpointPath,{version:1,gameId,mode,seed,hashes,startedAt,status,game,rng,
      ledger:{...ledger,activeMs:report.activeMs,cpuMicros:report.processCpuMicros},error:failure});
    await atomicJson(reportPath,report);latestReports.set(gameId,report);
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
    publish('running',kind.includes('reroll')?'바꾸기 반영':kind.includes('dot')?'점 찍기 반영':'배치 반영');
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
  const terminalStatus=()=>benchmarkStopStatus(game.score,isDead(game),preset.stopAtCap);
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
    await save(terminalStatus()||'running');
    while(!terminalStatus()&&!stopped){
      if(game.pieces.every(p=>p.used)){
        ledger.maxBatchMs=Math.max(ledger.maxBatchMs,ledger.currentBatchMs);ledger.currentBatchMs=0;
        deal(game,catalogue,weights(game.stage,'normal'),draws);await save('running');continue;
      }
      publish('queued');
      const decision=await budget.run(async()=>{
        publish('running','',Date.now());
        return recommend({board:game.board.slice(),cols:10,pieces:game.pieces.filter(p=>!p.used).map(p=>({...p})),catalogue,statistics,
          currentScore:game.score,clearedLines:game.lines,targetEnabled:mode==='target',skills:{...game.skills},skillIcons:game.icons.map(icon=>({...icon})),options:{rotate:true,reflect:true,gravity:false,timeLimit:850}});
      });
      ledger.calls++;ledger.totalMs+=decision.elapsed;ledger.maxMs=Math.max(ledger.maxMs,decision.elapsed);ledger.over1000+=Number(decision.elapsed>1000);ledger.watchdogs+=Number(decision.expired);
      const result=decision.result;let actions=0;
      ledger.lastRestartAssessment=result?.restart??null;
      if(result?.restart?.recommended){
        ledger.restartWarnings=(ledger.restartWarnings??0)+1;
        ledger.firstRestartRecommendation??={score:game.score,batch:game.batches,call:ledger.calls,assessment:result.restart};
      }
      // Intermediate targets do not stop playback; only the explicit 500k
      // preset may stop mid-plan. New icons can add an unpredicted bonus.
      for(const [index,move] of (result?.moves||[]).entries()){
        assert.deepEqual(move.boardBefore,game.board,'추천 시작 보드 불일치');
        playMove(game,move,icons,types);
        const expected=predictionAtStep(result,index);
        recordAction(move.kind||'piece',expected);actions++;
        if(preset.stopAtCap&&game.score>=500000)break;
      }
      const appliedCompletePlan=!!result?.complete&&actions===result.moves.length;
      if(result?.reroll&&!(preset.stopAtCap&&game.score>=500000)){rerollPiece(game,result.reroll.pieceId,catalogue,weights(game.stage,'reroll'),replacements);recordAction('reroll');actions++;}
      if(appliedCompletePlan&&game.skills.dot+game.skills.reroll>=7)ledger.completedPlansAtCapacity++;
      if(result&&!result.complete&&result.moves?.length)ledger.partialPlans++;
      if(!actions&&!isDead(game))fallback();audit();
      ledger.currentBatchMs+=decision.elapsed;
      ledger.trace.push({call:ledger.calls,batch:game.batches,score:game.score,elapsedMs:Math.round(decision.elapsed),complete:appliedCompletePlan,watchdog:decision.expired,targetCount:ledger.hits.length,
        board:game.board.slice(),skills:{...game.skills},strategy:result?.strategy??null});
      if(ledger.trace.length>1000)ledger.trace.splice(0,ledger.trace.length-1000);
      await save(terminalStatus()||'running');
    }
    currentStatus=terminalStatus()||stopReason||'stopped-after-peer-error';
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
const allFinished=reports.length===jobs.length&&reports.every(report=>['dead','cap-reached'].includes(report.status));
const lines=['# Target benchmark','',`Run: ${runId} · preset: ${preset.name} · ${pairs} seeds starting at ${seed} · ${jobs.length} games · concurrency ${maxParallel}`,'',
  allDead?'All games ended in verified death.':allFinished?'All games ended at 500,000 points or in verified death. Cap completion is not a death score.':'Includes interrupted runs or errors. Only rows marked dead are final death scores.','',
  '| Game | Seed | Status | Score | Next target / remaining | Exact targets reached | Mean / max calculation |',
  '|---|---:|---|---:|---|---:|---:|'];
for(const report of reports){const next=targetProgress(report.score,report.hits);lines.push(`| ${report.gameId} | ${report.seed} | ${report.status} | ${report.score.toLocaleString()} | ${next.nextTarget?.toLocaleString()??'None'} / ${next.nextTarget?next.remaining.toLocaleString():'—'} | ${report.exactTargetCount} | ${report.timing.averageMs} / ${report.timing.maxMs} ms |`);}
for(const report of reports)lines.push('',`${report.gameId} (targets ${report.mode==='target'?'ON':'OFF'}) exact arrivals: ${report.hits.map(hit=>hit.score.toLocaleString()).join(', ')||'None'}`,
  `Targets allowing a stop below seven held skills: ${report.hits.filter(hit=>hit.canStopBelowSkillCap).map(hit=>hit.score.toLocaleString()).join(', ')||'None'}. Prediction misses: ${report.predictionMisses}/${report.predictions}. Fallback actions: ${report.fallbacks}.`,
  ...(report.error?[`Error: ${report.error}`]:[]));
lines.push('','There are 16 automatic targets from 100,000 upward. Only exact action scores count as arrivals; passing a target does not. Arrival records persist as play continues. These counts are not real-game success rates.','',...conditions.map(condition=>`- ${condition}`),'',`Resume: node tests/target-benchmark.mjs --run ${runId} --output-dir "${outputDir}"`,'');
await writeFile(`${base}-comparison.md`,lines.join('\n'));
console.log(`\n비교 보고서: ${base}-comparison.md`);
if(reports.some(report=>report.status==='error'))process.exitCode=1;
if(process.connected)process.disconnect();
