import {solveFast} from './fast.js';
// Arbitrary polyominoes, no predefined shape catalogue. Coordinates are [x, y].
export function normalize(cells) {
  if (!Array.isArray(cells) || !cells.length) return [];
  const minX = Math.min(...cells.map(c => c[0]));
  const minY = Math.min(...cells.map(c => c[1]));
  return [...new Map(cells.map(([x,y]) => [`${x-minX},${y-minY}`, [x-minX,y-minY]])).values()].sort((a,b) => a[1]-b[1] || a[0]-b[0]);
}
export function variants(cells, rotate = true, reflect = true) {
  const result = [], seen = new Set();
  for (let flip = 0; flip <= Number(reflect); flip++) {
    let points = cells.map(([x,y]) => [flip ? -x : x,y]);
    for (let turn = 0; turn < (rotate ? 4 : 1); turn++) {
      const shape = normalize(points), key = JSON.stringify(shape);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ cells:shape, rotation:turn*90, reflected:!!flip, width:Math.max(...shape.map(c=>c[0]))+1, height:Math.max(...shape.map(c=>c[1]))+1 });
      }
      points = points.map(([x,y]) => [-y,x]); // clockwise in screen coordinates
    }
  }
  return result;
}
export function canPlace(board, cols, cells, x, y) {
  return cells.every(([dx,dy]) => x+dx >= 0 && x+dx < cols && y+dy >= 0 && y+dy < board.length && !(board[y+dy] & (1 << (x+dx))));
}
export function place(board, cols, cells, x, y, gravity = false) {
  if (!canPlace(board, cols, cells, x, y)) return null;
  const next = board.slice(), full = (1 << cols)-1, cleared = [];
  for (const [dx,dy] of cells) next[y+dy] |= 1 << (x+dx);
  for (let row = 0; row < next.length; row++) if (next[row] === full) { next[row] = 0; cleared.push(row); }
  if (gravity && cleared.length) {
    const keep = next.filter((_,i) => !cleared.includes(i));
    next.splice(0, next.length, ...Array(cleared.length).fill(0), ...keep);
  }
  return { board:next, cleared };
}
function popcount(n) { n -= (n >>> 1) & 0x55555555; n = (n & 0x33333333) + ((n >>> 2) & 0x33333333); return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
export function clearScore(lines) { return 300 * lines * lines; }
export function actionScore(cellCount, lines, kind='piece') {
  // A dot skill also earns one placement point, confirmed by the user.
  const placementScore=kind==='dot'?1:cellCount,lineScore=clearScore(lines);
  return {placementScore,lineScore,score:placementScore+lineScore};
}
export function skillCounts(skills = {}) {
  const counts = { dot:skills.dot ?? 0, reroll:skills.reroll ?? 0 };
  if (Object.values(counts).some(n => !Number.isSafeInteger(n) || n < 0)) throw new Error('스킬 개수는 0 이상의 정수로 입력하세요.');
  if(counts.dot+counts.reroll>7)throw new Error('점 찍기와 다시 뽑기는 합쳐서 최대 7개까지 보유할 수 있습니다.');
  return counts;
}
function quality(board, cols) {
  let value = 0, isolated = 0, transitions = 0;
  const full = (1 << cols)-1;
  for (let y = 0; y < board.length; y++) {
    const row = board[y], count = popcount(row);
    // Concentrate occupied rows and preserve broad open space for unknown future pieces.
    value += count*count*2 - (count ? 18 : 0);
    value += count * (board.length-y) * 0.12; // deterministic top-first tie break
    const empty = ~row & full;
    const left = (row << 1) | 1, right = (row >>> 1) | (1 << (cols-1));
    isolated += popcount(empty & left & right & (board[y-1] ?? full) & (board[y+1] ?? full));
    transitions += popcount((row ^ (row >>> 1)) & (full >>> 1));
    if (y) transitions += popcount(row ^ board[y-1]);
  }
  return value - isolated*100 - transitions*2;
}
function validate(input) {
  const {board,cols,pieces} = input;
  if (!Number.isInteger(cols) || cols < 2 || cols > 20 || !Array.isArray(board) || board.length < 2 || board.length > 40) throw new Error('보드 크기가 올바르지 않습니다.');
  if (board.some(row => !Number.isInteger(row) || row < 0 || row >= 2**cols)) throw new Error('보드 데이터가 올바르지 않습니다.');
  if (!Array.isArray(pieces) || pieces.length > 3) throw new Error('조각은 최대 3개까지 탐색합니다.');
  for (const p of pieces) if (!p.cells?.length || p.cells.length > 100 || p.cells.some(c=>!Array.isArray(c) || c.length!==2 || c.some(v=>!Number.isInteger(v)||v<0||v>20))) throw new Error('조각 칸 좌표를 확인해 주세요.');
  if(input.catalogue){if(!Array.isArray(input.catalogue)||input.catalogue.length>500)throw new Error('미래 조각 목록을 확인하세요.');for(const p of input.catalogue)if(!p.cells?.length||p.cells.length>100||p.cells.some(c=>!Array.isArray(c)||c.length!==2||c.some(v=>!Number.isInteger(v)||v<0||v>20)))throw new Error('미래 조각 모양을 확인하세요.');}
}
// A beam can prune the only surviving order. Before proposing a reroll, use
// remaining time to look for an actual witness across every current-piece order.
export function findSurvival(input,deadline=performance.now()+1000){
  validate(input);
  const {board,cols,pieces}=input,options={rotate:true,reflect:true,gravity:false,...input.options};
  const prepared=pieces.map(p=>({...p,variants:variants(p.cells,options.rotate,options.reflect)})),failed=new Set();
  const full=(1<<pieces.length)-1;let nodes=0,expired=false;
  function dfs(current,used){
    if(used===full)return [];
    if(performance.now()>=deadline){expired=true;return null;}
    const key=`${used}/${current}`;if(failed.has(key))return null;
    const groups=[];
    for(let i=0;i<prepared.length;i++)if(!(used&(1<<i))){
      const moves=[];
      for(const variant of prepared[i].variants)for(let y=0;y<=board.length-variant.height;y++)for(let x=0;x<=cols-variant.width;x++){
        if((++nodes&127)===0&&performance.now()>=deadline){expired=true;return null;}
        const next=place(current,cols,variant.cells,x,y,options.gravity);
        if(next)moves.push({index:i,kind:'piece',pieceId:prepared[i].id??i,...variant,x,y,cleared:next.cleared,
          ...actionScore(variant.cells.length,next.cleared.length),boardBefore:current,boardAfter:next.board});
      }
      moves.sort((a,b)=>b.score-a.score);groups.push(moves);
    }
    groups.sort((a,b)=>a.length-b.length);
    for(const moves of groups)for(const move of moves){
      const tail=dfs(move.boardAfter,used|(1<<move.index));if(tail)return [move,...tail];if(expired)return null;
    }
    failed.add(key);return null;
  }
  const moves=dfs(board,0);
  return {moves,nodes,timedOut:expired,provedImpossible:!moves&&!expired};
}
export function solve(input,callbacks={}) {
  validate(input);skillCounts(input.skills);
  return solveFast({...input,options:{...input.options,timeLimit:850}},callbacks);
}
// Internal current-batch rescue used only by the one-second solver. This is a
// bounded fallback for a pruned beam, not a separately selectable algorithm.
export function solveFallback(input) {
  validate(input);
  const {board,cols,pieces} = input;
  const skills = skillCounts(input.skills);
  const mustSpendSkill=skills.dot+skills.reroll===7;
  const options = { rotate:true, reflect:true, gravity:false, beamWidth:80, timeLimit:850, ...input.options };
  const started = performance.now(), deadline = started + Math.max(20,Math.min(850,options.timeLimit));
  // Reserve a witness search so a pruned beam can still recover the third piece.
  const placementDeadline=started+(deadline-started)*.85;
  const width = Math.max(8,Math.min(600,options.beamWidth));
  const prepared = pieces.map(p => ({...p, variants:variants(p.cells,options.rotate,options.reflect)}));
  const root = {board:board.slice(), used:0, depth:0, dots:0, moves:[], lines:0, score:0, quality:quality(board,cols)};
  let nodes = 0, timedOut = false, pruned = false;
  // Survival of all current pieces comes first, then placement + combo points.
  // A full inventory must spend at least one skill. Below the cap, equal-point
  // plans retain skills. An unknown reroll is never treated as a completed batch.
  const hasSkillSpace=state=>!mustSpendSkill||state.dots>0;
  const complete=state=>state.depth===pieces.length&&hasSkillSpace(state);
  const rank = (a,b) => b.score-a.score || b.quality-a.quality;
  const progress = (a,b) => Number(complete(b))-Number(complete(a)) || b.depth-a.depth
    || Number(hasSkillSpace(b))-Number(hasSkillSpace(a)) || b.score-a.score || a.dots-b.dots || b.quality-a.quality;
  // Seed a legal skill-spending plan from a known full placement, even when the
  // beam times out. Try an early dot first, replaying every later move; inserting
  // a clear can invalidate their original coordinates or change combo scores.
  function makeSkillSpace(candidate) {
    if(!mustSpendSkill||!skills.dot||candidate.dots||candidate.depth!==pieces.length)return candidate;
    let best=candidate;
    for(let at=0;at<=candidate.moves.length;at++) {
      const before=candidate.moves[at]?.boardBefore??candidate.board;
      for(let y=0;y<board.length;y++)for(let x=0;x<cols;x++) {
        nodes++;
        const next=place(before,cols,[[0,0]],x,y,options.gravity);if(!next)continue;
        const move={kind:'dot',cells:[[0,0]],rotation:0,reflected:false,width:1,height:1,x,y,
          cleared:next.cleared,...actionScore(1,next.cleared.length,'dot'),boardBefore:before,boardAfter:next.board};
        const moves=[...candidate.moves.slice(0,at),move];let current=next.board,valid=true;
        for(const original of candidate.moves.slice(at)) {
          const placed=place(current,cols,original.cells,original.x,original.y,options.gravity);
          if(!placed){valid=false;break;}
          moves.push({...original,cleared:placed.cleared,...actionScore(original.cells.length,placed.cleared.length,original.kind),boardBefore:current,boardAfter:placed.board});
          current=placed.board;
        }
        if(!valid)continue;
        const spent={...candidate,board:current,dots:1,moves,quality:quality(current,cols),
          lines:moves.reduce((sum,m)=>sum+m.cleared.length,0),score:moves.reduce((sum,m)=>sum+m.score,0)};
        if(progress(spent,best)<0)best=spent;
      }
    }
    return best;
  }
  function retain(bucket,limit){
    bucket.sort(rank);return bucket.slice(0,limit);
  }
  function search(dotBudget, until) {
    let frontier = [root], best = root;
    for (let d=0; d<pieces.length+dotBudget; d++) {
      if (performance.now() >= until) { timedOut=true; break; }
      const buckets = Array.from({length:pieces.length+1},()=>[]), seen = new Map();
      let expired = false;
      function attempt(state, variant, x, y, index = -1) {
        if ((++nodes & 255) === 0 && performance.now() >= until) { expired=true; timedOut=true; return; }
        const next = place(state.board,cols,variant.cells,x,y,options.gravity);
        if (!next) return;
        const dot = index === -1, used = dot ? state.used : state.used | (1<<index);
        const reward=actionScore(variant.cells.length,next.cleared.length,dot?'dot':'piece');
        const score = state.score+reward.score;
        const key = `${used}/${next.board.join(',')}`;
        if ((seen.get(key) ?? -1) >= score) return;
        seen.set(key,score);
        const move = {kind:dot?'dot':'piece', ...(dot?{}:{pieceId:prepared[index].id ?? index}), ...variant,
          x,y,cleared:next.cleared,...reward,boardBefore:state.board,boardAfter:next.board};
        const candidate = {board:next.board,used,depth:popcount(used),dots:state.dots+Number(dot),
          lines:state.lines+next.cleared.length,score,quality:quality(next.board,cols),moves:[...state.moves,move]};
        if (progress(candidate,best)<0) best=candidate;
        const bucket=buckets[candidate.depth];bucket.push(candidate);
        if(bucket.length>width*20){const keep=retain(bucket,width*4);bucket.splice(0,bucket.length,...keep);pruned=true;}
      }
      expand: for (const state of frontier) {
        for(let i=0;i<prepared.length;i++) {
          if(state.used & (1<<i))continue;
          for(const variant of prepared[i].variants) {
            for(let y=0;y<=board.length-variant.height;y++)for(let x=0;x<=cols-variant.width;x++) {
              attempt(state,variant,x,y,i);if(expired)break expand;
            }
          }
        }
        if(state.dots<dotBudget) {
          // Every empty cell is eligible, including preparations for a later combo.
          const dot={cells:[[0,0]],rotation:0,reflected:false,width:1,height:1};
          for(let y=0;y<board.length;y++)for(let x=0;x<cols;x++) {
            attempt(state,dot,x,y);if(expired)break expand;
          }
        }
      }
      if(expired)break;
      frontier=[];
      // Keep preparation states as well as states that already placed a piece.
      // Otherwise a required run of several dots could be pruned immediately.
      for(let i=0;i<pieces.length;i++){const bucket=buckets[i];if(bucket.length>width)pruned=true;frontier.push(...retain(bucket,width));}
      if(mustSpendSkill&&dotBudget)frontier.push(...retain(buckets[pieces.length].filter(state=>!hasSkillSpace(state)),width));
      if(!frontier.length)break;
    }
    return best;
  }
  const ordinaryDeadline=skills.dot>0?started+(placementDeadline-started)*.35:placementDeadline;
  let best=search(0,ordinaryDeadline), skillsConsidered=false;
  if(mustSpendSkill&&skills.dot&&pieces.length){best=makeSkillSpace(best);skillsConsidered=true;}
  if(skills.dot>0 && pieces.length && performance.now()<placementDeadline) {
    skillsConsidered=true;
    const rescued=search(skills.dot,placementDeadline);
    if(progress(rescued,best)<0)best=rescued;
  }
  // Retry with an actual current-batch witness before recommending a reroll.
  if(best.depth<pieces.length&&performance.now()<deadline){
    const until=skills.dot?performance.now()+(deadline-performance.now())*.5:deadline;
    const witness=findSurvival(input,until);nodes+=witness.nodes;
    if(witness.moves){
      const finalBoard=witness.moves.at(-1)?.boardAfter??board;
      const survivor=makeSkillSpace({board:finalBoard,used:(1<<pieces.length)-1,depth:pieces.length,dots:0,moves:witness.moves,
        lines:witness.moves.reduce((s,m)=>s+m.cleared.length,0),score:witness.moves.reduce((s,m)=>s+m.score,0),quality:quality(finalBoard,cols)});
      if(progress(survivor,best)<0)best=survivor;
    }else if(skills.dot&&performance.now()<deadline){const rescue=search(skills.dot,deadline);if(progress(rescue,best)<0)best=rescue;}
  }
  let reroll=null;
  const capacityReroll=mustSpendSkill&&!hasSkillSpace(best)&&skills.reroll>0&&pieces.length>0;
  // Spend a required reroll before placing anything, so all three pieces remain
  // available for a new plan once the actual replacement is known.
  if(capacityReroll)best=root;
  if(best.depth<pieces.length && skills.reroll>0) {
    // No invented draw distribution or simulated winning outcome. Stop at this
    // decision boundary and let the user enter the actual replacement piece.
    const remaining=prepared.map((p,i)=>({...p,index:i})).filter(p=>!(best.used & (1<<p.index)));
    const countFits=p=>p.variants.reduce((sum,v)=>{
      for(let y=0;y<=board.length-v.height;y++)for(let x=0;x<=cols-v.width;x++)if(canPlace(best.board,cols,v.cells,x,y))sum++;
      return sum;
    },0);
    const choices=remaining.map(p=>({...p,fits:countFits(p)})).sort((a,b)=>a.fits-b.fits || b.cells.length-a.cells.length || a.index-b.index);
    if(choices.length)reroll={pieceId:choices[0].id??choices[0].index,legalPlacements:choices[0].fits,reason:capacityReroll?'capacity':'survival'};
  }
  const placementScore=best.moves.reduce((sum,move)=>sum+move.placementScore,0),lineScore=best.moves.reduce((sum,move)=>sum+move.lineScore,0);
  return {moves:best.moves,lines:best.lines,score:best.score,placementScore,lineScore,depth:best.depth,nodes,duration:Math.round(performance.now()-started),
    timedOut,pruned,method:'beam',complete:complete(best)&&!reroll,remaining:pieces.length-best.depth,
    skillsUsed:{dot:best.dots,reroll:reroll?1:0},reroll,skillsConsidered,future:null};
}
