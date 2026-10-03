import {variants} from './solver.js';

const bitCount=n=>{n-=n>>>1&0x55555555;n=(n&0x33333333)+(n>>>2&0x33333333);return ((n+(n>>>4)&0x0f0f0f0f)*0x01010101)>>>24;};

// Only board symmetries permitted by the shape transformations are equivalent.
// Keep this key out of current-hand search: icons and target paths still matter.
export function policyBoardKey(board,cols,options={}){
  const identity=board.join(','),rotate=options.rotate!==false,reflect=options.reflect!==false;
  if(!rotate&&!reflect)return identity;
  const mirrored=board.map(row=>{let result=0;for(let x=0;x<cols;x++)result|=((row>>>x)&1)<<(cols-x-1);return result;});
  let key=identity;
  if(reflect){const horizontal=mirrored.join(',');if(horizontal<key)key=horizontal;}
  if(rotate){const rotated=mirrored.slice().reverse().join(',');if(rotated<key)key=rotated;}
  if(rotate&&reflect){const vertical=board.slice().reverse().join(',');if(vertical<key)key=vertical;}
  return key;
}

// Cheap geometry in score units, used during placement search. Broad empty
// rectangles matter because the final catalogue includes large hollow shapes.
export function createEvaluator(cols,weights={}) {
  const w={occupied:110,concentration:1,activeRows:180,transitions:10,isolated:600,deadEnd:180,narrow:45,square:6,rectangle:8,...weights};
  const full=2**cols-1,table=new Map();
  function rowData(row){
    let value=table.get(row);if(value)return value;
    const count=bitCount(row),empty=full^row;
    value={empty,count,transitions:bitCount((row^(row>>>1))&(full>>>1))};table.set(row,value);return value;
  }
  return board=>{
    let occupied=0,activeRows=0,concentration=0,transitions=0,isolated=0,deadEnd=0,narrow=0,square=0,rectangle=0;
    for(let y=0;y<board.length;y++){
      const row=board[y],info=rowData(row);occupied+=info.count;concentration+=info.count*info.count;
      activeRows+=Number(row!==0);
      transitions+=info.transitions;
      isolated+=bitCount(info.empty&((row<<1)|1)&((row>>>1)|(1<<(cols-1)))&(board[y-1]??full)&(board[y+1]??full));
      const left=(info.empty<<1)&full,right=info.empty>>>1,up=full^(board[y-1]??full),down=full^(board[y+1]??full);
      const pairs=(left&right)|(left&up)|(left&down)|(right&up)|(right&down)|(up&down);
      const triples=(left&right&(up|down))|(up&down&(left|right));
      deadEnd+=bitCount(info.empty&(left|right|up|down)&~pairs);
      narrow+=bitCount(info.empty&pairs&~triples);
      if(y){
        transitions+=bitCount(row^board[y-1]);
        const e=info.empty&rowData(board[y-1]).empty;
        square+=bitCount(e&(e>>>1));
        if(y>1){const f=e&rowData(board[y-2]).empty;rectangle+=bitCount(f&(f>>>1)&(f>>>2));}
      }
    }
    return -occupied*w.occupied-activeRows*w.activeRows+concentration*w.concentration-transitions*w.transitions-isolated*w.isolated-deadEnd*w.deadEnd-narrow*w.narrow+square*w.square+rectangle*w.rectangle;
  };
}

export function preparePolicyCatalogue(catalogue,cols,rows,options={}) {
  return catalogue.map((block,index)=>{
    const placements=[];
    for(const shape of variants(block.cells,options.rotate!==false,options.reflect!==false)){
      const rowMasks=Array(shape.height).fill(0);for(const[x,y]of shape.cells)rowMasks[y]|=1<<x;
      for(let y=0;y<=rows-shape.height;y++)for(let x=0;x<=cols-shape.width;x++)
        placements.push({y,masks:rowMasks.map(mask=>mask<<x)});
    }
    return {index,id:block.id,name:block.name,area:block.cells.length,placements};
  });
}

// Count real legal placements of every saved shape, not just connected free
// area. No probability claim is made by this geometric bottleneck measure.
export function mobilityReport(board,cols,prepared,weights=prepared.map(()=>1)){
  const counts=[],full=2**cols-1;
  const total=weights.reduce((sum,n)=>sum+n,0)||1;
  let weighted=0,bestCombo=0,deadTypes=0,blockedMass=0,scarcity=0,expectedCombo=0;
  const coverage=new Float64Array(board.length*cols);
  for(const [index,block] of prepared.entries()){
    let count=0,combo=0;const covered=new Int32Array(board.length);
    for(const p of block.placements){
      let fits=true,lines=0;
      for(let i=0;i<p.masks.length;i++){
        if(board[p.y+i]&p.masks[i]){fits=false;break;}
        if((board[p.y+i]|p.masks[i])===full)lines++;
      }
      if(fits){count++;combo=Math.max(combo,lines);for(let i=0;i<p.masks.length;i++)covered[p.y+i]|=p.masks[i];}
    }
    const probability=weights[index]/total;
    counts.push(count);if(!count){deadTypes++;blockedMass+=probability;}
    weighted+=probability*Math.log1p(count);scarcity+=probability/(1+count);
    expectedCombo+=probability*300*combo*combo;
    bestCombo=Math.max(bestCombo,300*combo*combo);
    for(let y=0;y<covered.length;y++)for(let mask=covered[y];mask;mask&=mask-1){
      const x=31-Math.clz32(mask&-mask);coverage[y*cols+x]+=probability;
    }
  }
  const minFits=counts.length?Math.min(...counts):0,meanLog=weighted;
  // This is the mass of a hand containing a currently blocked shape, not a
  // death probability: another piece or a skill can clear room first.
  const blockedHandMass=1-(1-Math.min(1,blockedMass))**3;
  // A legal placement somewhere is not enough: a row's last hole may require
  // a rarely drawn shape while every other shape fits in the empty buffer.
  // Count each identity once per cell, independent of its number of rotations.
  let repairDebt=0;
  for(let y=0;y<board.length;y++){
    const filled=bitCount(board[y]);if(!filled)continue;
    for(let mask=full^board[y];mask;mask&=mask-1){
      const x=31-Math.clz32(mask&-mask),chance=coverage[y*cols+x];
      repairDebt+=(filled/cols)**2*(1-Math.min(1,chance))**3;
    }
  }
  return {counts,deadTypes,minFits,meanLog,bestCombo,blockedMass,blockedHandMass,scarcity,expectedCombo,repairDebt,
    value:180*meanLog+140*Math.log1p(minFits)-400*deadTypes-6000*blockedHandMass-600*scarcity+expectedCombo*.12-160*repairDebt};
}

// Enumerate every observed identity for the next placement. This is a board
// value, not a next-hand survival probability: the other two pieces and skills
// may still create room. A partial enumeration must never change the winner.
export function expectedPlacementValue(board,cols,prepared,weights,evaluate,deadline=Infinity,scoreWeight=1){
  if(performance.now()>=deadline)return null;
  const full=2**cols-1,total=weights.reduce((sum,n)=>sum+n,0)||1,outcomes=[];
  let nodes=0;
  for(let index=0;index<prepared.length;index++){
    const block=prepared[index];let best=-20000+evaluate(board);
    outer:for(const p of block.placements){
      if((++nodes&127)===0&&performance.now()>=deadline)return null;
      for(let i=0;i<p.masks.length;i++)if(board[p.y+i]&p.masks[i])continue outer;
      const next=board.slice();let lines=0;
      for(let i=0;i<p.masks.length;i++){
        const y=p.y+i;next[y]|=p.masks[i];if(next[y]===full){next[y]=0;lines++;}
      }
      best=Math.max(best,scoreWeight*(block.area+300*lines*lines)+evaluate(next));
    }
    outcomes.push({value:best,probability:weights[index]/total});
  }
  outcomes.sort((a,b)=>a.value-b.value);
  let mass=.25,tail=0,mean=0;
  for(const outcome of outcomes){mean+=outcome.value*outcome.probability;const take=Math.min(mass,outcome.probability);tail+=take*outcome.value;mass-=take;}
  return {mean,lowerQuartile:tail/.25,value:.55*mean+.45*tail/.25,nodes};
}

// A conservative structural warning, not a calibrated death or score forecast.
// Skills and an unresolved reroll can still rescue a crowded board.
export function restartAssessment(board,cols,report,heldSkills,{pendingReroll=false,dotSkills=heldSkills}={}){
  const occupied=board.reduce((sum,row)=>sum+bitCount(row),0),totalCells=board.length*cols,density=occupied/totalCells;
  const blockedTypes=report.deadTypes??0,blockedMass=report.blockedMass??0,repairDebt=report.repairDebt??0;
  const severe=dotSkills===0&&density>=.6&&repairDebt>=9&&blockedMass>=.25&&(report.minFits??Infinity)===0;
  const recommended=!pendingReroll&&(severe||heldSkills<=1&&density>=.55&&blockedMass>=.18&&blockedTypes>=2&&repairDebt>=2);
  const caution=density>=.45&&(blockedMass>=.05||repairDebt>=3);
  return {recommended,level:recommended?'reset':caution?'caution':'normal',occupied,totalCells,
    blockedTypes,catalogueTypes:report.counts?.length??0,heldSkills,dotSkills,repairDebt,pendingReroll,basis:'after-plan'};
}

// Regularize actual normal-draw counts; unknown/deleted identities are excluded.
// The flat prior is a search scenario fallback, never a claim about game odds.
export function scenarioWeights(catalogue,statistics,{stage=null,source='normal'}={}){
  const valid=n=>Number.isSafeInteger(n)&&n>=0?n:0;
  const byId=new Map((statistics?.entries||[]).filter(e=>e.blockId!=null).map(e=>[e.blockId,e]));
  const entries=catalogue.map(b=>byId.get(b.id)),normal=entries.map(e=>valid(e?.normal)+1),normalTotal=normal.reduce((s,n)=>s+n,0)||1;
  const counts=entries.map(e=>valid(e?.[source])),samples=counts.reduce((s,n)=>s+n,0);
  const overall=source==='reroll'?counts.map((n,i)=>n+30*normal[i]/normalTotal):normal;
  const overallTotal=overall.reduce((s,n)=>s+n,0)||1;
  const currentStage=Number.isInteger(stage)&&stage>=1&&stage<=5?stage:null;
  const stageCounts=entries.map(e=>valid(e?.stages?.[currentStage]?.[source])),stageSamples=stageCounts.reduce((s,n)=>s+n,0);
  const weights=stageSamples?stageCounts.map((n,i)=>n+30*overall[i]/overallTotal):overall;
  const total=weights.reduce((s,n)=>s+n,0)||1;
  return {samples,stage:currentStage,stageSamples,source,weights,probabilities:weights.map(n=>n/total),basis:stageSamples?'stage-with-overall-prior':samples?'overall':'prior'};
}

export function makeScenarios(catalogue,weights,count=12,depth=2,seed=1){
  let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const total=weights.reduce((s,n)=>s+n,0),pick=()=>{let target=random()*total;for(let i=0;i<weights.length;i++){target-=weights[i];if(target<0)return i;}return weights.length-1;};
  return Array.from({length:count},()=>Array.from({length:depth},()=>Array.from({length:3},(_,id)=>({...catalogue[pick()],id}))));
}
