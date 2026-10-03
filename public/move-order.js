import {place,skillCounts} from './solver.js';
import {activeTargets,nextTarget,scoreMoves,targetPath} from './targets.js';

// Beam pruning can discard a setup dot before its later multi-row clear pays
// off. Revisit the order of fixed placements without spending another skill
// or changing the board left for the next hand.
export function optimizeMoveOrder(input,candidate,{deadline=Infinity,maxNodes=30000}={}){
  const moves=candidate.moves;
  if(!moves||moves.length<2||moves.length>10||!moves.some(m=>m.cleared.length)
    ||moves.some(m=>m.kind&&m.kind!=='piece'&&m.kind!=='dot'))return candidate;
  const skills=skillCounts(input.skills),icons=input.skillIcons||[];
  const baseline=scoreMoves(input.currentScore,moves,{skills,skillIcons:icons});
  const expectedBoard=moves.at(-1).boardAfter,all=(1<<moves.length)-1;
  const iconMask=remaining=>icons.reduce((mask,icon,i)=>remaining.includes(icon)?mask|(1<<i):mask,0);
  const expectedIcons=iconMask(baseline.icons),sameBoard=(a,b)=>a.every((row,y)=>row===b[y]);
  const targets=Number.isSafeInteger(input.currentScore)?activeTargets({...input,targetEnabled:input.targetEnabled===true}):[];
  const upcoming=nextTarget(input.currentScore,targets),approaching=upcoming!==null&&upcoming-input.currentScore<=1800;
  const goalClass=(hit,score)=>hit!==null?2:approaching&&score>input.currentScore&&score<=upcoming?1:0;
  const originalPath=targetPath(input.currentScore,baseline.moves,targets);
  let best=moves,bestScore=baseline.score,bestClass=goalClass(originalPath.hit,baseline.after),nodes=0,stopped=false;
  const seen=new Map(),trail=[];
  function visit(board,mask,remaining,heldSkills,score,hit){
    if(stopped)return;
    if(++nodes>maxNodes||(nodes%32===1&&performance.now()>=deadline)){stopped=true;return;}
    const remainingMask=iconMask(remaining);
    if(mask===all){
      if(remainingMask!==expectedIcons||!sameBoard(board,expectedBoard))return;
      const after=input.currentScore==null?null:Math.min(500000,input.currentScore+score),kind=goalClass(hit,after);
      if(kind>bestClass||kind===bestClass&&score>bestScore){best=trail.slice();bestScore=score;bestClass=kind;}
      return;
    }
    // Identical subsets can reach different boards when cells are reused after
    // clears. Targets also need distinct intermediate scores and prefix hits.
    const key=`${mask}/${board}/${remainingMask}${targets.length?`/${score}/${hit}`:''}`;
    if((seen.get(key)??-1)>=score)return;
    seen.set(key,score);
    for(let i=0;i<moves.length&&!stopped;i++){
      if(mask&(1<<i))continue;
      const move=moves[i];if(move.kind==='dot'&&heldSkills.dot<1)continue;
      const placed=place(board,input.cols,move.cells,move.x,move.y,input.options?.gravity);
      if(!placed)continue;
      const after=input.currentScore==null?null:Math.min(500000,input.currentScore+score);
      const step=scoreMoves(after,[{...move,cleared:placed.cleared,boardBefore:board,boardAfter:placed.board}],{skills:heldSkills,skillIcons:remaining});
      const nextHit=hit??(step.held<7&&step.after!==input.currentScore&&targets.includes(step.after)?step.after:null);
      trail.push(step.moves[0]);
      visit(placed.board,mask|(1<<i),step.icons,step.skillsAfter,score+step.score,nextHit);
      trail.pop();
    }
  }
  visit(input.board,0,icons,skills,0,null);
  if(best===moves)return candidate;
  const replay=scoreMoves(input.currentScore,best,{skills,skillIcons:icons});
  return {...candidate,moves:replay.moves,board:expectedBoard,score:replay.score,
    placementScore:replay.placementScore,lineScore:replay.lineScore,acquisitionScore:replay.acquisitionScore,
    acquiredCount:replay.acquiredCount,held:replay.held,lines:best.reduce((sum,m)=>sum+m.cleared.length,0)};
}
