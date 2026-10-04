import {normalize,variants,place,skillCounts} from './solver.js';
import {solveFast} from './fast.js';
import {NATIVE_SETTINGS,NATIVE_PASSES,SOLVER_WATCHDOG_MS,nativeEngineStatus,runNativeEngine} from './native-engine.js';
import {shapeKey} from './library.js';
import {stageForLines} from './statistics.js';
import {scoreMoves,activeTargets,targetPath,nextTarget} from './targets.js';
import {optimizeMoveOrder} from './move-order.js';
import {preparePolicyCatalogue,mobilityReport,scenarioWeights,restartAssessment} from './policy.js';
import {compilePlacements,countLegalPlacements} from './search.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const supportedShape=p=>{const cells=normalize(p.cells);return cells.length&&cells.every(([x,y])=>x<5&&y<5);};
export function supportsNative(input){
  return nativeEngineStatus().ready&&input.cols===10&&input.board.length===16
    &&input.options?.rotate!==false&&input.options?.reflect!==false&&!input.options?.gravity
    &&input.pieces.length>0&&input.pieces.length<=3&&input.pieces.every(supportedShape)
    &&(input.catalogue||[]).length<=40&&(input.catalogue||[]).every(supportedShape);
}

// Keep real observations separate from the engine's +3 prior. Stage records
// take precedence; a stage with no samples uses the overall normal counts.
export function nativeStatistics(input){
  const keys=new Map((input.catalogue||[]).map(block=>[block.id,shapeKey(block.cells)]));
  const overall={},stages=Object.fromEntries([1,2,3,4,5].map(stage=>[stage,{}]));
  const add=(table,key,count)=>{if(Number.isSafeInteger(count)&&count>0)table[key]=(table[key]||0)+count;};
  for(const entry of input.statistics?.entries||[]){
    const key=keys.get(entry.blockId);if(!key)continue;
    add(overall,key,entry.normal);
    for(const stage of [1,2,3,4,5])add(stages[stage],key,entry.stages?.[stage]?.normal);
  }
  const total=table=>Object.values(table).reduce((a,b)=>a+b,0);
  const stage=stageForLines(input.clearedLines),observedSamples=total(overall),stageSamples=stage?total(stages[stage]):0;
  const drawStats=Object.fromEntries([1,2,3,4,5].map(s=>[s,total(stages[s])?stages[s]:overall]));
  // Without a known stage, do not pretend that the current game is in stage 1.
  if(stage===null)for(const s of [1,2,3,4,5])drawStats[s]=overall;
  return {drawStats,stage,observedSamples,stageSamples};
}

export function nativeInput(input,settings=NATIVE_SETTINGS){
  const stats=nativeStatistics(input),pool=new Map();
  for(const block of input.catalogue||[])pool.set(shapeKey(block.cells),normalize(block.cells));
  return {rows:input.board.slice(),pieces:input.pieces.map(p=>({cells:normalize(p.cells),used:false})),
    icons:(input.skillIcons||[]).map(icon=>({x:icon.x,y:icon.y,type:icon.kind})),
    ...{dots:input.skills?.dot||0,rerolls:input.skills?.reroll||0},
    // Unknown future icon positions remain manual in this application. A
    // distant countdown avoids the reference UI's stop-at-spawn boundary.
    countdown:255,score:input.currentScore??0,lines:input.clearedLines??0,width:768,
    rerollPool:[...pool.values()],drawStats:stats.drawStats,nativeConfig:{...settings}};
}

export function adaptNativePlan(input,raw){
  if(!Array.isArray(raw.path))throw new Error('Invalid native path');
  const used=new Set(),moves=[];let board=input.board.slice();
  for(const action of raw.path){
    if(!['piece','dot'].includes(action.kind)||!Array.isArray(action.cells)||!action.cells.length
      ||action.cells.some(p=>!Array.isArray(p)||p.length!==2||p.some(v=>!Number.isInteger(v))))throw new Error('Invalid native move');
    const cells=normalize(action.cells),x=Math.min(...action.cells.map(p=>p[0])),y=Math.min(...action.cells.map(p=>p[1]));
    if(cells.length!==action.cells.length)throw new Error('Duplicate native cells');
    let variant,pieceId;
    if(action.kind==='dot'){
      if(cells.length!==1)throw new Error('Invalid dot');
      variant={cells,rotation:0,reflected:false,width:1,height:1};
    }else{
      if(!Number.isInteger(action.slot)||!input.pieces[action.slot]||used.has(action.slot))throw new Error('Invalid native slot');
      const piece=input.pieces[action.slot];
      variant=variants(piece.cells,input.options?.rotate!==false,input.options?.reflect!==false).find(v=>same(v.cells,cells));
      if(!variant)throw new Error('Native shape mismatch');
      used.add(action.slot);pieceId=piece.id??action.slot;
    }
    const next=place(board,input.cols,cells,x,y);
    if(!next||!same(next.board,action.rows)||!same(next.cleared,action.clear))throw new Error('Native board mismatch');
    moves.push({kind:action.kind,...variant,...(pieceId!==undefined?{pieceId}:{}),x,y,
      boardBefore:board,boardAfter:next.board,cleared:next.cleared});board=next.board;
  }
  const replay=scoreMoves(input.currentScore,moves,{skills:skillCounts(input.skills),skillIcons:input.skillIcons});
  let reroll=null;
  if(raw.reroll){
    const slot=raw.reroll.slot;
    if(!Number.isInteger(slot)||!input.pieces[slot]||used.has(slot)||replay.skillsAfter.reroll<1)throw new Error('Invalid native reroll');
    reroll={pieceId:input.pieces[slot].id??slot,legalPlacements:raw.reroll.legal??0,
      reason:raw.reroll.capacity?'capacity':raw.reroll.proactive?'prevent-trap':'blocked'};
  }
  return {...replay,board,depth:used.size,lines:moves.reduce((n,m)=>n+m.cleared.length,0),reroll,
    dots:moves.filter(m=>m.kind==='dot').length,nodes:raw.nodes||0,futureChecks:raw.futureChecks||0};
}

function capacityReroll(input){
  const choices=input.pieces.map((p,i)=>({pieceId:p.id??i,area:p.cells.length,
    legalPlacements:countLegalPlacements(input.board,compilePlacements(p.cells,input.cols,input.board.length,input.options))}));
  choices.sort((a,b)=>a.legalPlacements-b.legalPlacements||b.area-a.area);
  return {...scoreMoves(input.currentScore,[],{skills:input.skills,skillIcons:input.skillIcons}),moves:[],
    board:input.board,depth:0,lines:0,dots:0,reroll:{...choices[0],reason:'capacity'},nodes:0,futureChecks:0};
}

function leaveSkillSpace(input,candidate){
  if(candidate.held<7||candidate.reroll||candidate.depth!==input.pieces.length)return candidate;
  if(candidate.skillsAfter.dot>0){
    let best=null;
    for(let y=0;y<input.board.length;y++)for(let x=0;x<input.cols;x++){
      const next=place(candidate.board,input.cols,[[0,0]],x,y);if(!next)continue;
      const move={kind:'dot',cells:[[0,0]],rotation:0,reflected:false,width:1,height:1,x,y,
        boardBefore:candidate.board,boardAfter:next.board,cleared:next.cleared};
      const replay=scoreMoves(input.currentScore,[...candidate.moves,move],{skills:input.skills,skillIcons:input.skillIcons});
      if(replay.held>=7)continue;
      const value=replay.score+next.board.reduce((sum,row)=>sum+row.toString(2).replaceAll('0','').length**2*2,0);
      if(!best||value>best.value)best={...candidate,...replay,board:next.board,dots:candidate.dots+1,lines:candidate.lines+next.cleared.length,value};
    }
    if(best)return best;
  }
  if(input.skills?.reroll>0)return capacityReroll(input);
  return candidate;
}

export function solveNative(input,{onProgress}={}){
  const started=performance.now(),skills=skillCounts(input.skills),stats=nativeStatistics(input);
  const targets=activeTargets({...input,targetEnabled:input.targetEnabled===true});
  const prepared=preparePolicyCatalogue(input.catalogue||[],input.cols,input.board.length,input.options);
  const geometry=c=>{
    const stage=stageForLines(input.clearedLines==null?null:input.clearedLines+c.lines);
    const distribution=scenarioWeights(input.catalogue||[],input.statistics,{stage});
    return mobilityReport(c.board,input.cols,prepared,distribution.weights);
  };
  function finish(candidate,raw={}){
    candidate=optimizeMoveOrder(input,candidate,{deadline:performance.now()+25});
    const replay=scoreMoves(input.currentScore,candidate.moves,{skills,skillIcons:input.skillIcons});
    const complete=candidate.depth===input.pieces.length&&replay.held<7&&!candidate.reroll;
    const path=targetPath(input.currentScore,replay.moves,targets),report=geometry(candidate);
    const strategy={kind:'scenarios',profile:'native',depth:1,tested:candidate.futureChecks||0,skipped:0,
      stage:stats.stage,observedSamples:stats.observedSamples,stageSamples:stats.stageSamples,
      nextStage:stageForLines(input.clearedLines==null?null:input.clearedLines+candidate.lines),
      engineRevision:raw.engineRevision??'native25',settings:raw.settings??NATIVE_SETTINGS,
      minPlacements:report.minFits,unplaceableTypes:report.deadTypes,blockedDrawMass:report.blockedMass};
    const result={moves:replay.moves,depth:candidate.depth,remaining:input.pieces.length-candidate.depth,complete,
      lines:candidate.lines,score:replay.score,placementScore:replay.placementScore,lineScore:replay.lineScore,
      acquisitionScore:replay.acquisitionScore,skillsUsed:{dot:candidate.dots,reroll:Number(!!candidate.reroll)},
      skillsConsidered:skills.dot>0,reroll:candidate.reroll,method:'native',strategy,future:null,
      nodes:candidate.nodes||0,duration:Math.round(performance.now()-started),pruned:true,timedOut:false,
      restart:restartAssessment(candidate.board,input.cols,report,replay.held-Number(!!candidate.reroll),
        {pendingReroll:!!candidate.reroll,dotSkills:replay.skillsAfter.dot})};
    if(targets.length)result.target={enabled:true,currentScore:input.currentScore??null,...path,
      hit:complete?path.hit:null,hitStep:complete?path.hitStep:null,
      status:input.currentScore==null?'unknown':complete&&path.hit!==null?'hit':nextTarget(input.currentScore,targets)===null?'complete':'fallback'};
    return result;
  }
  // Publish a small legal fallback before the synchronous native call. A
  // watchdog can recover this plan if the imported engine stalls.
  const seed=solveFast({...input,options:{...input.options,timeLimit:80}});
  onProgress?.(seed);
  const upcoming=nextTarget(input.currentScore,targets);
  const target=seed.target?.hit?seed:upcoming!==null&&upcoming-input.currentScore<=1800
    ?solveFast({...input,options:{...input.options,timeLimit:250}}):null;
  let result=seed,candidate=null;
  for(const settings of NATIVE_PASSES){
    // Wasm calls are synchronous. The outer worker watchdog can terminate a
    // pass while retaining the last fully validated recommendation below.
    if(performance.now()-started>SOLVER_WATCHDOG_MS-400)break;
    try{
      const raw=runNativeEngine(nativeInput(input,settings));
      const next=leaveSkillSpace(input,adaptNativePlan(input,raw));
      if(next.held>=7&&!next.reroll||next.depth<input.pieces.length&&!next.reroll&&result.complete)continue;
      candidate=next;result=finish(candidate,raw);
      // Preserve exact targets before publishing each pass, so the watchdog
      // cannot discard target handling by interrupting a later native call.
      if(result.complete&&!result.target?.hit&&target?.complete&&target.target?.hit){
        const alternate={board:target.moves.at(-1)?.boardAfter??input.board,lines:target.lines},before=geometry(candidate),after=geometry(alternate);
        if(after.blockedMass<=before.blockedMass&&after.minFits>=before.minFits&&after.meanLog>=before.meanLog-.2
          &&target.skillsUsed.dot<=candidate.dots+1)result={...target,method:'native',strategy:result.strategy,nativeTargetRefinement:true};
      }
      result={...result,duration:Math.round(performance.now()-started)};onProgress?.(result);
      if(result.reroll?.reason==='capacity')break;
    }catch(error){
      result={...result,nativeFallback:true,nativeError:error.message};break;
    }
  }
  result={...result,duration:Math.round(performance.now()-started)};onProgress?.(result);return result;
}
