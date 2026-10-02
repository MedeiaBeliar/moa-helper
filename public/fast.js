import {findSurvival,solveFallback,skillCounts,place,actionScore} from './solver.js';
import {searchPlacements,compilePlacements,countLegalPlacements} from './search.js';
import {createEvaluator,preparePolicyCatalogue,mobilityReport,scenarioWeights,makeScenarios} from './policy.js';
import {TARGET_SCORES,nextTarget,targetPath,scoreMoves} from './targets.js';

// Leave time for worker startup, message delivery and painting; a host-side
// watchdog owns the hard wall limit.
export function solveFast(input,{onProgress}={}){
  const started=performance.now(),budget=Math.max(20,Math.min(850,input.options?.timeLimit??850)),deadline=started+budget;
  const options={rotate:true,reflect:true,gravity:false,...input.options},skills=skillCounts(input.skills),mustSpend=skills.dot+skills.reroll===7;
  const evaluate=createEvaluator(input.cols),elapsed=()=>Math.round(performance.now()-started);
  const targetEnabled=input.targetEnabled===true,targetMode=targetEnabled&&Number.isSafeInteger(input.currentScore)&&input.currentScore>=0&&input.currentScore<=500000;
  const upcoming=targetMode?nextTarget(input.currentScore):null,approaching=upcoming!==null&&upcoming-input.currentScore<=1800;
  let availableCells=input.pieces.reduce((sum,p)=>sum+p.cells.length,skills.dot);
  for(let row of input.board)while(row){availableCells++;row&=row-1;}
  const scoreBound=input.pieces.reduce((sum,p)=>sum+p.cells.length,skills.dot)+300*Math.floor(availableCells/input.cols)**2+50*(input.skillIcons?.length||0);
  const targetSearch=targetMode&&(approaching||TARGET_SCORES.some(score=>score>input.currentScore&&score<=input.currentScore+scoreBound));
  const targetCache=new WeakMap(),targetChoices=new Map();
  const pathOf=c=>{if(!targetCache.has(c))targetCache.set(c,targetPath(input.currentScore,c.moves));return targetCache.get(c);};
  const goalClass=c=>{if(!targetMode)return 0;const path=pathOf(c);return path.hit!==null?2:approaching&&path.after>input.currentScore&&path.after<=upcoming?1:0;};
  const withTarget=result=>{
    if(!targetEnabled)return result;
    const path=targetPath(input.currentScore,result.moves);
    const status=!targetMode?'unknown':result.complete&&path.hit!==null?'hit':upcoming===null?'complete':result.complete&&approaching&&path.after>input.currentScore&&path.after<=upcoming?'approach':'fallback';
    return {...result,target:{enabled:true,currentScore:input.currentScore??null,status,...path,
      hit:result.complete?path.hit:null,hitStep:result.complete?path.hitStep:null}};
  };
  const corrected=c=>{
    const replay=scoreMoves(input.currentScore,c.moves,{skillIcons:input.skillIcons,skills});
    return {...c,moves:replay.moves,score:replay.score,acquiredCount:replay.acquiredCount,held:replay.held};
  };
  let nodes=0,best=null,bestValue=-Infinity,latest=null;
  const evidence={kind:'scenarios',profile:'fast',tested:0,skipped:0,depth:1,candidates:0,observedSamples:0,failures:0,unknown:0};
  const resultOf=c=>{
    const placementScore=c.moves.reduce((s,m)=>s+m.placementScore,0),lineScore=c.moves.reduce((s,m)=>s+m.lineScore,0),acquisitionScore=c.moves.reduce((s,m)=>s+(m.acquisitionScore||0),0);
    return withTarget({moves:c.moves,lines:c.lines,score:placementScore+lineScore+acquisitionScore,placementScore,lineScore,acquisitionScore,depth:c.depth,
      complete:c.depth===input.pieces.length&&skills.dot+skills.reroll-c.dots+(c.acquiredCount||0)<7,remaining:input.pieces.length-c.depth,
      skillsUsed:{dot:c.dots,reroll:0},reroll:null,skillsConsidered:skills.dot>0,method:'fast',future:null,
      duration:elapsed(),nodes,pruned:true,timedOut:false,strategy:{...evidence}});
  };
  const publish=c=>{latest=resultOf(c);onProgress?.(latest);};
  if(mustSpend&&!skills.dot&&input.pieces.length){
    const choices=input.pieces.map((p,index)=>({id:p.id??index,area:p.cells.length,fits:countLegalPlacements(input.board,compilePlacements(p.cells,input.cols,input.board.length,options))}));
    choices.sort((a,b)=>a.fits-b.fits||b.area-a.area);
    const result={...resultOf({moves:[],lines:0,depth:0,dots:0}),complete:false,reroll:{pieceId:choices[0].id,legalPlacements:choices[0].fits,reason:'capacity'},skillsUsed:{dot:0,reroll:1}};
    onProgress?.(result);return result;
  }
  // A cheap witness protects the whole batch before any scoring or lookahead.
  const witness=findSurvival(input,Math.min(deadline,started+35));nodes+=witness.nodes;
  if(witness.moves){
    const moves=witness.moves.slice();let board=moves.at(-1)?.boardAfter??input.board,dots=0;
    let replay=scoreMoves(input.currentScore,moves,{skillIcons:input.skillIcons,skills});
    while(replay.held>=7&&dots<skills.dot&&performance.now()<deadline-25){
      let chosen=null,value=-Infinity;
      for(let y=0;y<board.length;y++)for(let x=0;x<input.cols;x++){
        const next=place(board,input.cols,[[0,0]],x,y,options.gravity);if(!next)continue;
        const score=300*next.cleared.length**2+evaluate(next.board);
        if(score>value){value=score;chosen={...next,x,y};}
      }
      if(chosen){moves.push({kind:'dot',cells:[[0,0]],rotation:0,reflected:false,width:1,height:1,x:chosen.x,y:chosen.y,cleared:chosen.cleared,...actionScore(1,chosen.cleared.length,'dot'),boardBefore:board,boardAfter:chosen.board});board=chosen.board;dots++;}
      else break;
      replay=scoreMoves(input.currentScore,moves,{skillIcons:input.skillIcons,skills});
    }
    if(replay.held<7){best=corrected({moves,board,dots,depth:input.pieces.length,lines:moves.reduce((s,m)=>s+m.cleared.length,0),quality:evaluate(board)});publish(best);}
  }
  const prepared=preparePolicyCatalogue(input.catalogue||[],input.cols,input.board.length,options),cache=new Map();
  const geometry=board=>{const key=board.join(',');if(!cache.has(key))cache.set(key,mobilityReport(board,input.cols,prepared));return cache.get(key);};
  const utility=c=>c.score+c.quality+geometry(c.board).value-c.dots*50;
  // Target chasing is allowed only among complete plans that preserve the
  // ordinary winner's bottleneck, catalogue coverage and most of its space.
  const targetSafe=(c,normal)=>{
    if(c.depth!==input.pieces.length||skills.dot+skills.reroll-c.dots+(c.acquiredCount||0)>=7||c.dots>normal.dots+1)return false;
    const before=geometry(normal.board),after=geometry(c.board),minimum=before.minFits<=4?before.minFits:Math.ceil(before.minFits*.75);
    return after.deadTypes<=before.deadTypes&&after.minFits>=minimum&&after.meanLog>=before.meanLog-.20&&c.quality>=normal.quality-180;
  };
  const rememberTarget=c=>{
    if(!goalClass(c))return;
    const path=pathOf(c),key=`${c.board}/${c.dots}/${path.hit}/${path.after}`;
    const previous=targetChoices.get(key);if(!previous||utility(c)>utility(previous))targetChoices.set(key,c);
    if(targetChoices.size>32){const keep=[...targetChoices.entries()].sort((a,b)=>goalClass(b[1])-goalClass(a[1])||utility(b[1])-utility(a[1])).slice(0,24);targetChoices.clear();for(const entry of keep)targetChoices.set(...entry);}
  };
  const selectGoal=normal=>{
    if(!targetMode||!normal)return normal;
    let selected=normal,kind=goalClass(normal),value=utility(normal);
    for(const candidate of targetChoices.values()){
      const candidateKind=goalClass(candidate);if(candidateKind<kind||!targetSafe(candidate,normal))continue;
      const candidateValue=utility(candidate);
      if(candidateKind>kind||candidateValue>value){selected=candidate;kind=candidateKind;value=candidateValue;}
    }
    return selected;
  };
  if(best)bestValue=utility(best);
  if(targetMode&&best)rememberTarget(best);
  const accept=c=>{
    const value=utility(c),previous=best;
    if(!best||value>bestValue){best=c;bestValue=value;}
    if(targetMode){rememberTarget(c);const chosen=selectGoal(best);if(previous!==best||latest?.moves!==chosen.moves)publish(chosen);}
    else if(previous!==best)publish(c);
  };
  const search=searchPlacements({...input,targetEnabled:targetSearch,options},{deadline:Math.min(deadline-50,started+budget*(skills.dot ? .76 : .64)),width:skills.dot?36:64,evaluate,
    onCandidate:c=>{if(!best||performance.now()<deadline-35)accept(c);}});
  nodes+=search.nodes;
  const pool=search.candidates.slice();if(best)pool.push(best);
  if(!pool.length){
    // A bounded miss is not game over. Use the remaining time for a current-batch
    // rescue and an actual reroll boundary instead of speculative future work.
    const rescue=solveFallback({...input,options:{...options,timeLimit:Math.max(20,deadline-performance.now()-20),beamWidth:80}});
    nodes+=rescue.nodes;
    const partial=search.bestPartial;
    if(!rescue.complete&&!rescue.reroll&&partial.depth>rescue.depth)latest=resultOf(partial);
    else{
      const replay=scoreMoves(input.currentScore,rescue.moves,{skillIcons:input.skillIcons,skills});
      latest={...rescue,moves:replay.moves,score:replay.score,placementScore:replay.placementScore,lineScore:replay.lineScore,acquisitionScore:replay.acquisitionScore,complete:rescue.complete&&replay.held<7,method:'fast',strategy:{...evidence}};
      if(replay.held>=7&&skills.reroll){
        const choices=input.pieces.map((p,index)=>({id:p.id??index,fits:countLegalPlacements(input.board,compilePlacements(p.cells,input.cols,input.board.length,options))})).sort((a,b)=>a.fits-b.fits);
        if(choices.length)latest={...resultOf({moves:[],lines:0,depth:0,dots:0}),complete:false,reroll:{pieceId:choices[0].id,legalPlacements:choices[0].fits,reason:'capacity'},skillsUsed:{dot:0,reroll:1}};
      }
    }
    latest=withTarget({...latest,duration:elapsed(),nodes});onProgress?.(latest);return latest;
  }
  const ranked=[],seen=new Set();
  // Keep a complete legal witness even if the deadline expired during a GC
  // pause before the candidate ranking pass.
  if(!best){best=pool[0];publish(best);}
  for(const c of pool){
    if(performance.now()>deadline-30)break;
    const key=targetMode?`${c.board}/${c.dots}/${c.score}/${pathOf(c).hit}`:`${c.board}/${c.dots}`;if(seen.has(key))continue;seen.add(key);
    const value=utility(c);ranked.push({candidate:c,value});accept(c);
  }
  ranked.sort((a,b)=>b.value-a.value);const finalists=ranked.slice(0,2);evidence.candidates=finalists.length;
  // Two candidates share every sampled future. Only completed common scenarios
  // can change the winner; a timeout is never counted as a failed future.
  if(finalists.length===2&&input.catalogue?.length&&performance.now()<deadline-110){
    const distribution=scenarioWeights(input.catalogue,input.statistics);evidence.observedSamples=distribution.samples;
    let seed=0x4d4f41;for(const row of input.board)seed=(Math.imul(seed,31)^row)>>>0;
    const totals=[[],[]];
    for(const scenario of makeScenarios(input.catalogue,distribution.weights,6,1,seed)){
      if(performance.now()>deadline-95)break;
      const values=[];
      for(const {candidate} of finalists){
        const found=searchPlacements({board:candidate.board,cols:input.cols,pieces:scenario[0],skills:{dot:0,reroll:0},options},
          {deadline:Math.min(deadline-20,performance.now()+35),width:6,evaluate});nodes+=found.nodes;
        if(!found.candidates.length)break;
        found.candidates.sort((a,b)=>(b.score+b.quality)-(a.score+a.quality));const next=found.candidates[0];
        values.push(candidate.score+.92*next.score+next.quality+geometry(next.board).value-candidate.dots*50);
      }
      if(values.length!==2){evidence.skipped++;continue;}
      values.forEach((v,i)=>totals[i].push(v));evidence.tested++;
      if(evidence.tested>=2){
        const value=totals.map(v=>.65*v.reduce((s,n)=>s+n,0)/v.length+.35*Math.min(...v));
        best=finalists[value[1]>value[0]?1:0].candidate;publish(selectGoal(best));
      }
    }
  }
  if(best){best=selectGoal(best);const report=geometry(best.board);evidence.minPlacements=report.minFits;evidence.unplaceableTypes=report.deadTypes;latest=resultOf(best);}
  return {...latest,duration:elapsed(),nodes,timedOut:performance.now()>=deadline,strategy:{...evidence}};
}
