import {variants, actionScore, skillCounts} from './solver.js';
import {activeTargets,nextTarget} from './targets.js';

// Placements depend on the shape and board dimensions, never on a saved game.
// Keeping masks here removes coordinate arrays and cell-by-cell work from the
// millions of collision checks made during a recommendation.
const placementCache=new Map();
const noAcquiredIcons=Object.freeze([]);
export function compilePlacements(cells,cols,rows,options={}) {
  const rotate=options.rotate!==false,reflect=options.reflect!==false;
  const key=`${cols}/${rows}/${Number(rotate)}/${Number(reflect)}/${JSON.stringify(cells)}`;
  if(placementCache.has(key))return placementCache.get(key);
  const shapes=variants(cells,rotate,reflect),compiled=[];
  for(const variant of shapes) {
    const masks=Array(variant.height).fill(0);
    for(const [x,y] of variant.cells)masks[y]|=1<<x;
    for(let y=0;y<=rows-variant.height;y++)for(let x=0;x<=cols-variant.width;x++) {
      compiled.push({variant,x,y,masks:masks.map(mask=>mask<<x),area:variant.cells.length});
    }
  }
  Object.defineProperty(compiled,'signature',{value:shapes.map(v=>JSON.stringify(v.cells)).sort().join('|')});
  if(placementCache.size>=128)placementCache.delete(placementCache.keys().next().value);
  placementCache.set(key,compiled);
  return compiled;
}
export function countLegalPlacements(board,compiled,limit=Infinity) {
  let count=0;
  outer:for(const placement of compiled) {
    for(let row=0;row<placement.masks.length;row++)if(board[placement.y+row]&placement.masks[row])continue outer;
    if(++count>=limit)break;
  }
  return count;
}
function bitCount(value) {
  value-=(value>>>1)&0x55555555;value=(value&0x33333333)+((value>>>2)&0x33333333);
  return (((value+(value>>>4))&0x0f0f0f0f)*0x01010101)>>>24;
}
function rowHash(value,row) {
  let n=(value^Math.imul(row+1,0x9e3779b9))>>>0;
  n=Math.imul(n^(n>>>16),0x85ebca6b);n=Math.imul(n^(n>>>13),0xc2b2ae35);
  return (n^(n>>>16))>>>0;
}
function sameBoard(a,b) {for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
function defaultQuality(board,cols) {
  const full=(1<<cols)-1;let value=0;
  for(let y=0;y<board.length;y++) {
    const row=board[y],count=bitCount(row);
    value+=count*count*2-(count?18:0)-count*22+count*(board.length-y)*.12;
    value-=bitCount((row^(row>>>1))&(full>>>1))*2;
    if(y)value-=bitCount(row^board[y-1])*2;
    value-=bitCount((~row&full)&((row<<1)|1)&((row>>>1)|(1<<(cols-1)))&(board[y-1]??full)&(board[y+1]??full))*100;
  }
  return value;
}

// Every retained node owns only its board and one parent pointer. Full public
// move histories are materialized only for returned plans or progress updates.
function materialize(node,pieces) {
  const trail=[];for(let at=node;at.parent;at=at.parent)trail.push(at);
  const moves=trail.reverse().map(at=>{
    const {placement,index,cleared,acquiredIcons}=at.action,kind=index<0?'dot':'piece',acquisitionScore=acquiredIcons.length*50;
    const points=actionScore(placement.area,cleared.length,kind);
    return {kind,...(index<0?{}:{pieceId:pieces[index].id??index}),...placement.variant,
      x:placement.x,y:placement.y,cleared:cleared.slice(),...points,acquiredIcons,acquisitionScore,score:points.score+acquisitionScore,heldSkills:at.held,
      boardBefore:at.parent.board,boardAfter:at.board};
  });
  return {board:node.board,used:node.used,depth:node.depth,dots:node.dots,acquiredCount:node.acquiredCount,moves,lines:node.lines,score:node.score,quality:node.quality};
}

/** Bounded search. deadline is an absolute performance.now() timestamp. */
export function searchPlacements(input,{deadline=performance.now()+2000,width=100,evaluate,onCandidate}={}) {
  const {board,cols,pieces}=input,options={rotate:true,reflect:true,gravity:false,...input.options};
  const skills=skillCounts(input.skills);
  const skillIcons=input.skillIcons??[],initialHeld=skills.dot+skills.reroll;
  const beam=Math.max(4,Math.min(1200,Math.floor(width)||100)),full=(1<<cols)-1,all=(1<<pieces.length)-1;
  const scoreWeight=Number.isFinite(options.scoreWeight)?options.scoreWeight:1;
  const dotPenalty=Number.isFinite(options.dotPenalty)?options.dotPenalty:40;
  const quality=evaluate??(current=>defaultQuality(current,cols));
  const targets=activeTargets({...input,targetEnabled:input.targetEnabled===true});
  const targetMode=targets.length>0&&Number.isSafeInteger(input.currentScore)&&input.currentScore>=0&&input.currentScore<=500000;
  const targetSet=targetMode?new Set(targets):null,upcoming=targetMode?nextTarget(input.currentScore,targets):null;
  const approaching=upcoming!==null&&upcoming-input.currentScore<=1800;
  const prepared=pieces.map(p=>compilePlacements(p.cells,cols,board.length,options));
  const dots=skills.dot?compilePlacements([[0,0]],cols,board.length,{rotate:false,reflect:false}):[];
  const predecessors=prepared.map((shape,i)=>prepared.findIndex((other,j)=>j<i&&other.signature===shape.signature));
  const initiallyFull=[];for(let y=0;y<board.length;y++)if(board[y]===full)initiallyFull.push(y);
  let nodes=0,pruned=false,timedOut=false,lastClockCheck=0;
  let rootHash=0;for(let y=0;y<board.length;y++)rootHash^=rowHash(board[y],y);
  const root={board:board.slice(),hash:rootHash>>>0,used:0,depth:0,dots:0,lines:0,score:0,quality:quality(board),parent:null,targetHit:null,targetStep:null,iconMask:0,acquiredCount:0};
  let bestPartial=root,bestComplete=null,bestTarget=null,finalists=[],finalSeen=new Map();
  const eligible=n=>n.used===all&&initialHeld-n.dots+n.acquiredCount<7;
  const utility=n=>n.score*scoreWeight+n.quality-n.dots*dotPenalty;
  const rank=(a,b)=>utility(b)-utility(a)||b.score-a.score||a.dots-b.dots||b.quality-a.quality;
  const scoreRank=(a,b)=>b.score-a.score||a.dots-b.dots||b.quality-a.quality;
  const spaceRank=(a,b)=>b.quality-a.quality||b.score-a.score||a.dots-b.dots;
  const targetClass=n=>n.targetHit!==null?2:approaching&&input.currentScore+n.score<=upcoming?1:0;
  const targetRank=(a,b)=>targetClass(b)-targetClass(a)||rank(a,b);
  const progress=(a,b)=>Number(eligible(b))-Number(eligible(a))||b.depth-a.depth||rank(a,b);
  const finalLimit=Math.min(80,Math.max(40,beam));
  function select(list,limit) {
    if(list.length<=limit)return list;
    pruned=true;
    // A strong geometric board and a strong immediate combo can both matter
    // several turns later. Retain each rather than collapsing to one ordering.
    const chosen=new Set(),take=(compare,count)=>{
      list.sort(compare);let added=0;
      for(const item of list)if(!chosen.has(item)){chosen.add(item);if(++added>=count)break;}
    };
    if(targetMode){take(targetRank,Math.ceil(limit*.25));take(rank,Math.ceil(limit*.35));take(scoreRank,Math.ceil(limit*.15));take(spaceRank,limit-chosen.size);}
    else{take(rank,Math.ceil(limit*.5));take(scoreRank,Math.ceil(limit*.25));take(spaceRank,limit-chosen.size);}
    return [...chosen].slice(0,limit).sort(rank);
  }
  function findSame(map,node) {
    const entries=map.get(node.hash);if(!entries)return null;
    // Equal final geometry does not imply an equal target path: a split clear
    // can touch a target that a higher-scoring simultaneous clear skips.
    for(const other of entries)if(other.used===node.used&&other.dots===node.dots&&other.iconMask===node.iconMask&&other.acquiredCount===node.acquiredCount&&(!targetMode||(other.score===node.score&&other.targetHit===node.targetHit&&other.targetStep===node.targetStep))&&sameBoard(other.board,node.board))return other;
    return null;
  }
  function addSeen(map,node) {const entries=map.get(node.hash);if(entries)entries.push(node);else map.set(node.hash,[node]);}
  function retainFinal(node) {
    if(!eligible(node))return;
    const previous=findSame(finalSeen,node);
    if(previous&&previous.score>=node.score)return;
    if(previous){const at=finalists.indexOf(previous);if(at>=0)finalists.splice(at,1);const entries=finalSeen.get(node.hash);entries.splice(entries.indexOf(previous),1);}
    finalists.push(node);addSeen(finalSeen,node);
    if(finalists.length>finalLimit*3) {
      finalists=select(finalists,finalLimit);finalSeen=new Map();for(const n of finalists)addSeen(finalSeen,n);
    }
    let announce=false;
    if(!bestComplete||rank(node,bestComplete)<0) {
      bestComplete=node;
      announce=true;
    }
    if(targetMode&&targetClass(node)>0&&(!bestTarget||targetRank(node,bestTarget)<0)){bestTarget=node;announce=true;}
    if(announce&&onCandidate)onCandidate(materialize(node,pieces));
  }
  function consider(node) {
    if(node.quality===undefined)node.quality=quality(node.board);
    if(progress(node,bestPartial)<0)bestPartial=node;
    retainFinal(node);
  }
  function expired(until) {
    // Called after collisions as well as successful placements: a nearly full
    // board must not evade the cooperative deadline check.
    if(nodes-lastClockCheck<512)return false;
    lastClockCheck=nodes;
    return performance.now()>=until;
  }
  function placeNode(parent,placement,index) {
    const masks=placement.masks,y=placement.y,current=parent.board;
    for(let row=0;row<masks.length;row++)if(current[y+row]&masks[row])return null;
    const next=current.slice(),cleared=[];let hash=parent.hash;
    for(let row=0;row<masks.length;row++) {
      const at=y+row,old=current[at];let value=old|masks[row];
      if(value===full){value=0;cleared.push(at);}
      next[at]=value;
      if(old!==value)hash^=rowHash(old,at)^rowHash(value,at);
    }
    // A hand-edited initial board may already contain a full row. After the
    // first move, only rows touched by the new shape can become full.
    if(!parent.parent&&initiallyFull.length)for(const row of initiallyFull)if(next[row]===full) {
      next[row]=0;cleared.push(row);hash^=rowHash(full,row)^rowHash(0,row);
    }
    if(cleared.length>1)cleared.sort((a,b)=>a-b);
    if(options.gravity&&cleared.length) {
      const keep=next.filter((_,row)=>!cleared.includes(row));next.splice(0,next.length,...Array(cleared.length).fill(0),...keep);
      hash=0;for(let row=0;row<next.length;row++)hash^=rowHash(next[row],row);
    }
    const dot=index<0,used=dot?parent.used:parent.used|(1<<index);
    let iconMask=parent.iconMask,acquiredCount=parent.acquiredCount,held=initialHeld-parent.dots-Number(dot)+acquiredCount;
    const acquiredIcons=skillIcons.length&&cleared.length?[]:noAcquiredIcons;
    if(cleared.length)for(let i=0;i<skillIcons.length;i++)if(!(iconMask&(1<<i))&&cleared.includes(skillIcons[i].y)){
      if(held<7){iconMask|=1<<i;acquiredCount++;held++;acquiredIcons.push(skillIcons[i]);}
    }
    const score=parent.score+placement.area+300*cleared.length*cleared.length+acquiredIcons.length*50;
    let targetHit=parent.targetHit,targetStep=parent.targetStep;
    if(targetMode&&targetHit===null&&held<7){const after=Math.min(500000,input.currentScore+score);if(after>input.currentScore&&targetSet.has(after)){targetHit=after;targetStep=parent.depth+parent.dots+1;}}
    return {board:next,hash:hash>>>0,used,depth:parent.depth+Number(!dot),dots:parent.dots+Number(dot),
      lines:parent.lines+cleared.length,score,targetHit,targetStep,iconMask,acquiredCount,held,quality:undefined,parent,action:{placement,index,cleared,acquiredIcons}};
  }
  function sweep(dotBudget,until,limit) {
    let frontier=[root];
    for(let step=0;step<pieces.length+dotBudget;step++) {
      if(performance.now()>=until){timedOut=true;break;}
      const buckets=new Map();let hitDeadline=false;
      function accept(node) {
        const key=node.used*8+node.dots;
        let bucket=buckets.get(key);if(!bucket){bucket={list:[],seen:new Map()};buckets.set(key,bucket);}
        const previous=findSame(bucket.seen,node);
        if(previous&&previous.score>=node.score)return;
        if(previous){const at=bucket.list.indexOf(previous);if(at>=0)bucket.list.splice(at,1);const entries=bucket.seen.get(node.hash);entries.splice(entries.indexOf(previous),1);}
        bucket.list.push(node);addSeen(bucket.seen,node);consider(node);
        if(bucket.list.length>limit*6) {
          bucket.list=select(bucket.list,limit*2);bucket.seen=new Map();for(const n of bucket.list)addSeen(bucket.seen,n);
        }
      }
      expand:for(const state of frontier) {
        for(let index=0;index<pieces.length;index++) {
          if(state.used&(1<<index))continue;
          if(predecessors[index]>=0&&!(state.used&(1<<predecessors[index])))continue;
          for(const placement of prepared[index]) {
            nodes++;if(expired(until)){hitDeadline=true;break expand;}
            const node=placeNode(state,placement,index);if(node)accept(node);
          }
        }
        if(state.dots<dotBudget)for(const placement of dots) {
          nodes++;if(expired(until)){hitDeadline=true;break expand;}
          const node=placeNode(state,placement,-1);if(node)accept(node);
        }
      }
      if(hitDeadline){timedOut=true;break;}
      frontier=[];
      for(const bucket of buckets.values()) {
        const keep=select(bucket.list,limit);
        for(const state of keep)if(state.used!==all||state.dots<dotBudget)frontier.push(state);
      }
      frontier.sort((a,b)=>b.depth-a.depth||rank(a,b));
      if(!frontier.length)break;
    }
  }
  // A cheap complete witness survives even if a much wider search is stopped
  // later. Never spend the whole budget expanding the first of three pieces.
  const started=performance.now(),available=Math.max(0,deadline-started);
  const witnessDeadline=Math.min(deadline,started+Math.min(12,available*.08));
  function seedWitness(state) {
    if(state.used===all){consider(state);return true;}
    if(performance.now()>=witnessDeadline)return false;
    for(let index=0;index<pieces.length;index++) {
      if(state.used&(1<<index))continue;
      if(predecessors[index]>=0&&!(state.used&(1<<predecessors[index])))continue;
      for(const placement of prepared[index]) {
        nodes++;if(expired(witnessDeadline))return false;
        const node=placeNode(state,placement,index);
        if(node){consider(node);if(seedWitness(node))return true;}
      }
    }
    return false;
  }
  seedWitness(root);
  sweep(0,Math.min(deadline,started+Math.max(10,available*.12)),Math.min(24,beam));
  if(initialHeld-bestPartial.dots+bestPartial.acquiredCount>=7&&skills.dot&&bestPartial.used===all&&bestPartial.dots<skills.dot&&performance.now()<deadline) {
    const source=bestPartial;
    for(const placement of dots) {
      nodes++;if(expired(deadline)){timedOut=true;break;}
      const node=placeNode(source,placement,-1);if(node)consider(node);
    }
  }
  if(performance.now()<deadline) {
    if(skills.dot) {
      // First finish a broader ordinary search, then allow every held dot. A
      // seven-dot rescue must be reachable without guessing a smaller budget.
      sweep(0,Math.min(deadline,started+available*.30),beam);
      if(performance.now()<deadline)sweep(skills.dot,deadline,beam);
    } else sweep(0,deadline,beam);
  }
  if(eligible(root))retainFinal(root);
  finalists=select(finalists,finalLimit).sort(rank);
  if(bestComplete&&!finalists.includes(bestComplete))finalists.unshift(bestComplete);
  if(bestTarget&&!finalists.includes(bestTarget))finalists.push(bestTarget);
  return {candidates:finalists.map(node=>materialize(node,pieces)),bestPartial:materialize(bestPartial,pieces),nodes,pruned,timedOut:timedOut||performance.now()>=deadline};
}
