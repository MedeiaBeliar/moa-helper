import {findSurvival,solveFallback,skillCounts,place,actionScore} from './solver.js';
import {searchPlacements,compilePlacements,countLegalPlacements} from './search.js';
import {createEvaluator,preparePolicyCatalogue,mobilityReport,scenarioWeights,makeScenarios,expectedPlacementValue,restartAssessment,policyBoardKey} from './policy.js';
import {activeTargets,nextTarget,targetPath,scoreMoves} from './targets.js';
import {stageForLines} from './statistics.js';

// Leave time for worker startup, message delivery and painting; a host-side
// watchdog owns the hard wall limit.
export function solveFast(input,{onProgress}={}){
  const started=performance.now(),budget=Math.max(20,Math.min(850,input.options?.timeLimit??850)),deadline=started+budget;
  const skills=skillCounts(input.skills),mustSpend=skills.dot+skills.reroll===7;
  const options={rotate:true,reflect:true,gravity:false,scoreWeight:1,abilityValue:180,dotAbilityValue:1400,
    dotPenalty:(skills.dot<=1?1400:skills.dot===2?900:450)*Math.min(1,input.cols*input.board.length/160),...input.options};
  const elapsed=()=>Math.round(performance.now()-started);
  const targets=activeTargets({...input,targetEnabled:input.targetEnabled===true});
  const targetEnabled=targets.length>0,targetMode=targetEnabled&&Number.isSafeInteger(input.currentScore)&&input.currentScore>=0&&input.currentScore<=500000;
  const upcoming=targetMode?nextTarget(input.currentScore,targets):null,approaching=upcoming!==null&&upcoming-input.currentScore<=1800;
  let availableCells=input.pieces.reduce((sum,p)=>sum+p.cells.length,skills.dot);
  for(let row of input.board)while(row){availableCells++;row&=row-1;}
  const scoreBound=input.pieces.reduce((sum,p)=>sum+p.cells.length,skills.dot)+300*Math.floor(availableCells/input.cols)**2+50*(input.skillIcons?.length||0);
  const targetSearch=targetMode&&(approaching||targets.some(score=>score>input.currentScore&&score<=input.currentScore+scoreBound));
  const targetCache=new WeakMap(),targetChoices=new Map();
  const pathOf=c=>{if(!targetCache.has(c))targetCache.set(c,targetPath(input.currentScore,c.moves,targets));return targetCache.get(c);};
  const goalClass=c=>{if(!targetMode)return 0;const path=pathOf(c);return path.hit!==null?2:approaching&&path.after>input.currentScore&&path.after<=upcoming?1:0;};
  const withTarget=result=>{
    if(!targetEnabled)return result;
    const path=targetPath(input.currentScore,result.moves,targets);
    const status=!targetMode?'unknown':result.complete&&path.hit!==null?'hit':upcoming===null?'complete':result.complete&&approaching&&path.after>input.currentScore&&path.after<=upcoming?'approach':'fallback';
    return {...result,target:{enabled:true,currentScore:input.currentScore??null,status,...path,
      hit:result.complete?path.hit:null,hitStep:result.complete?path.hitStep:null}};
  };
  const corrected=c=>{
    const replay=scoreMoves(input.currentScore,c.moves,{skillIcons:input.skillIcons,skills});
    return {...c,moves:replay.moves,score:replay.score,acquiredCount:replay.acquiredCount,held:replay.held};
  };
  let nodes=0,best=null,bestValue=-Infinity,latest=null;
  const catalogue=input.catalogue||[],distributions=new Map();
  const stageAfter=lines=>stageForLines(Number.isSafeInteger(input.clearedLines)?input.clearedLines+lines:null);
  const distributionFor=lines=>{
    const stage=stageAfter(lines);
    if(!distributions.has(stage))distributions.set(stage,scenarioWeights(catalogue,input.statistics,{stage}));
    return distributions.get(stage);
  };
  const currentDistribution=distributionFor(0);
  const evaluate=createEvaluator(input.cols);
  const evidence={kind:'scenarios',profile:'fast',tested:0,skipped:0,depth:1,candidates:0,
    observedSamples:currentDistribution.samples,stage:currentDistribution.stage,stageSamples:currentDistribution.stageSamples,probabilityBasis:currentDistribution.basis,failures:0,unknown:0};
  const resultOf=c=>{
    const placementScore=c.moves.reduce((s,m)=>s+m.placementScore,0),lineScore=c.moves.reduce((s,m)=>s+m.lineScore,0),acquisitionScore=c.moves.reduce((s,m)=>s+(m.acquisitionScore||0),0);
    return withTarget({moves:c.moves,lines:c.lines,score:placementScore+lineScore+acquisitionScore,placementScore,lineScore,acquisitionScore,depth:c.depth,
      complete:c.depth===input.pieces.length&&skills.dot+skills.reroll-c.dots+(c.acquiredCount||0)<7,remaining:input.pieces.length-c.depth,
      skillsUsed:{dot:c.dots,reroll:0},reroll:null,skillsConsidered:skills.dot>0,method:'fast',future:null,
      duration:elapsed(),nodes,pruned:true,timedOut:false,strategy:{...evidence}});
  };
  const publish=c=>{latest=resultOf(c);onProgress?.(latest);};
  if(mustSpend&&skills.reroll&&skills.dot<=2&&input.pieces.length){
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
  const prepared=preparePolicyCatalogue(catalogue,input.cols,input.board.length,options),cache=new Map(),boardKeys=new WeakMap();
  const boardKey=board=>{if(!boardKeys.has(board))boardKeys.set(board,policyBoardKey(board,input.cols,options));return boardKeys.get(board);};
  const geometry=(board,lines=0)=>{const distribution=distributionFor(lines),key=`${distribution.stage}/${boardKey(board)}`;if(!cache.has(key))cache.set(key,mobilityReport(board,input.cols,prepared,distribution.weights));return cache.get(key);};
  const withRisk=result=>{
    const board=result.moves.at(-1)?.boardAfter??input.board,replay=scoreMoves(input.currentScore,result.moves,{skillIcons:input.skillIcons,skills});
    return {...result,restart:restartAssessment(board,input.cols,geometry(board,result.lines),replay.held-Number(!!result.reroll),{pendingReroll:!!result.reroll,dotSkills:replay.skillsAfter.dot})};
  };
  const abilityReward=c=>c.moves.reduce((sum,move)=>sum+(move.acquiredIcons||[]).reduce((n,icon)=>n+(icon.kind==='dot'?options.dotAbilityValue:options.abilityValue),0),0);
  const utility=c=>c.score*options.scoreWeight+c.quality+geometry(c.board,c.lines).value-c.dots*options.dotPenalty+abilityReward(c);
  // Target chasing is allowed only among complete plans that preserve the
  // ordinary winner's bottleneck, catalogue coverage and most of its space.
  const targetSafe=(c,normal)=>{
    if(c.depth!==input.pieces.length||skills.dot+skills.reroll-c.dots+(c.acquiredCount||0)>=7||c.dots>normal.dots+1)return false;
    const before=geometry(normal.board,normal.lines),after=geometry(c.board,c.lines),minimum=before.minFits<=4?before.minFits:Math.ceil(before.minFits*.75);
    return after.blockedMass<=before.blockedMass+1e-9&&after.deadTypes<=before.deadTypes&&after.minFits>=minimum&&after.meanLog>=before.meanLog-.20&&c.quality>=normal.quality-180;
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
  const search=searchPlacements({...input,targetEnabled:targetSearch&&input.targetEnabled===true,manualTargets:targetSearch?input.manualTargets:[],options},{deadline:Math.min(deadline-50,started+budget*.58),width:skills.dot?36:64,evaluate,
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
    latest=withRisk(withTarget({...latest,duration:elapsed(),nodes}));onProgress?.(latest);return latest;
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
  if(best&&skills.reroll&&input.pieces.length&&prepared.length&&performance.now()<deadline-120){
    const after=geometry(best.board,best.lines),before=geometry(input.board,0);
    if(after.repairDebt>before.repairDebt+.5||after.blockedHandMass>.08||after.minFits<=6&&skills.reroll>=3){
      const choices=input.pieces.map((p,index)=>({id:p.id??index,area:p.cells.length,fits:countLegalPlacements(input.board,compilePlacements(p.cells,input.cols,input.board.length,options))}));
      choices.sort((a,b)=>a.fits-b.fits||b.area-a.area);
      const replaceId=choices[0].id,distribution=scenarioWeights(catalogue,input.statistics,{stage:stageAfter(0),source:'reroll'});
      const replacements=makeScenarios(catalogue,distribution.weights,6,1,0x726f6c6c+input.board.reduce((s,r)=>s+r,0));
      const outcomes=[];
      for(const sample of replacements){
        if(performance.now()>deadline-45)break;
        const pieces=input.pieces.map((p,index)=>(p.id??index)===replaceId?{...sample[0][0],id:replaceId}:p);
        const found=searchPlacements({...input,pieces,skills:{...skills,reroll:skills.reroll-1},options},{deadline:Math.min(deadline-20,performance.now()+18),width:10,evaluate});nodes+=found.nodes;
        if(found.candidates.length)outcomes.push(Math.max(...found.candidates.map(utility)));
        else if(!found.timedOut)outcomes.push(-20000);
      }
      evidence.rerollScenarios=outcomes.length;
      // An unresolved or unvisited sample must not disappear from the estimate.
      // Require a result for every sampled replacement before spending a skill.
      if(outcomes.length===replacements.length&&outcomes.reduce((s,n)=>s+n,0)/outcomes.length>utility(best)+(skills.reroll>=4?100:300)&&Math.min(...outcomes)>utility(best)-(skills.reroll>=4?1500:800)){
        latest={...resultOf({moves:[],lines:0,depth:0,dots:0}),complete:false,reroll:{pieceId:replaceId,reason:'prevent-trap'},skillsUsed:{dot:0,reroll:1}};
        latest=withRisk({...latest,duration:elapsed(),nodes});onProgress?.(latest);return latest;
      }
    }
  }
  if(prepared.length&&performance.now()<deadline-90){
    const candidates=[],positions=new Set();
    for(const item of ranked){
      if(candidates.length===6)break;
      const key=`${stageAfter(item.candidate.lines)}/${boardKey(item.candidate.board)}`;
      if(!positions.has(key)){positions.add(key);candidates.push(item);}
    }
    let selected=null,selectedValue=-Infinity;
    for(const {candidate}of candidates){
      const expectation=expectedPlacementValue(candidate.board,input.cols,prepared,distributionFor(candidate.lines).weights,evaluate,deadline-25,options.scoreWeight);
      if(!expectation)break;
      nodes+=expectation.nodes;evidence.enumeratedCandidates=(evidence.enumeratedCandidates||0)+1;evidence.enumeratedTypes=prepared.length;
      const value=candidate.score*options.scoreWeight+expectation.value+geometry(candidate.board,candidate.lines).value-candidate.dots*options.dotPenalty+abilityReward(candidate);
      if(value>selectedValue){selectedValue=value;selected=candidate;}
    }
    if(selected&&evidence.enumeratedCandidates>=2){best=selected;publish(selectGoal(best));}
  }
  // Two candidates share every sampled future. Only completed common scenarios
  // can change the winner; a timeout is never counted as a failed future.
  if(!evidence.enumeratedCandidates&&finalists.length===2&&input.catalogue?.length&&performance.now()<deadline-110){
    let seed=0x4d4f41;for(const row of input.board)seed=(Math.imul(seed,31)^row)>>>0;
    // Common random numbers reduce sampling noise. Each candidate uses the
    // stage reached by its own clears when mapping those numbers to pieces.
    const futures=finalists.map(({candidate})=>makeScenarios(catalogue,distributionFor(candidate.lines).weights,6,1,seed));
    const totals=[[],[]];
    for(let scenarioIndex=0;scenarioIndex<6;scenarioIndex++){
      if(performance.now()>deadline-95)break;
      const values=[];
      for(const [index,{candidate}] of finalists.entries()){
        const futureInput={board:candidate.board,cols:input.cols,pieces:futures[index][scenarioIndex][0],skills:{dot:0,reroll:0},options};
        const found=searchPlacements(futureInput,
          {deadline:Math.min(deadline-20,performance.now()+35),width:6,evaluate});nodes+=found.nodes;
        if(!found.candidates.length){
          const proof=findSurvival(futureInput,Math.min(deadline-15,performance.now()+10));nodes+=proof.nodes;
          if(proof.provedImpossible){values.push(candidate.score*options.scoreWeight-15000+candidate.quality);evidence.failures++;continue;}
          if(proof.moves){
            const board=proof.moves.at(-1).boardAfter,lines=proof.moves.reduce((s,m)=>s+m.cleared.length,0);
            values.push(options.scoreWeight*(candidate.score+.92*proof.moves.reduce((s,m)=>s+m.score,0))+evaluate(board)+geometry(board,candidate.lines+lines).value-candidate.dots*options.dotPenalty+abilityReward(candidate));continue;
          }
          evidence.unknown++;break;
        }
        found.candidates.sort((a,b)=>(b.score+b.quality)-(a.score+a.quality));const next=found.candidates[0];
        values.push(options.scoreWeight*(candidate.score+.92*next.score)+next.quality+geometry(next.board,candidate.lines+next.lines).value-candidate.dots*options.dotPenalty+abilityReward(candidate));
      }
      if(values.length!==2){evidence.skipped++;continue;}
      values.forEach((v,i)=>totals[i].push(v));evidence.tested++;
      if(evidence.tested>=2){
        const value=totals.map(v=>.65*v.reduce((s,n)=>s+n,0)/v.length+.35*Math.min(...v));
        best=finalists[value[1]>value[0]?1:0].candidate;publish(selectGoal(best));
      }
    }
  }
  if(best){
    best=selectGoal(best);const report=geometry(best.board,best.lines),distribution=distributionFor(best.lines);
    evidence.minPlacements=report.minFits;evidence.unplaceableTypes=report.deadTypes;evidence.blockedDrawMass=report.blockedMass;
    evidence.nextStage=distribution.stage;evidence.nextStageSamples=distribution.stageSamples;latest=resultOf(best);
  }
  return withRisk({...latest,duration:elapsed(),nodes,timedOut:performance.now()>=deadline,strategy:{...evidence}});
}
