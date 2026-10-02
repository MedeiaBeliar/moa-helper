import {variants} from './solver.js';

const bitCount=n=>{n-=n>>>1&0x55555555;n=(n&0x33333333)+(n>>>2&0x33333333);return ((n+(n>>>4)&0x0f0f0f0f)*0x01010101)>>>24;};

// Cheap geometry in score units, used during placement search. Broad empty
// rectangles matter because the final catalogue includes large hollow shapes.
export function createEvaluator(cols,weights={}) {
  const w={occupied:8,concentration:1,transitions:8,isolated:90,square:8,rectangle:12,...weights};
  const full=2**cols-1,table=new Map();
  function rowData(row){
    let value=table.get(row);if(value)return value;
    const count=bitCount(row),empty=full^row;
    value={empty,count,transitions:bitCount((row^(row>>>1))&(full>>>1))};table.set(row,value);return value;
  }
  return board=>{
    let occupied=0,concentration=0,transitions=0,isolated=0,square=0,rectangle=0;
    for(let y=0;y<board.length;y++){
      const row=board[y],info=rowData(row);occupied+=info.count;concentration+=info.count*info.count;
      transitions+=info.transitions;
      isolated+=bitCount(info.empty&((row<<1)|1)&((row>>>1)|(1<<(cols-1)))&(board[y-1]??full)&(board[y+1]??full));
      if(y){
        transitions+=bitCount(row^board[y-1]);
        const e=info.empty&rowData(board[y-1]).empty;
        square+=bitCount(e&(e>>>1));
        if(y>1){const f=e&rowData(board[y-2]).empty;rectangle+=bitCount(f&(f>>>1)&(f>>>2));}
      }
    }
    return -occupied*w.occupied+concentration*w.concentration-transitions*w.transitions-isolated*w.isolated+square*w.square+rectangle*w.rectangle;
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
export function mobilityReport(board,cols,prepared){
  const counts=[],full=2**cols-1;
  let weighted=0,weight=0,bestCombo=0,deadTypes=0;
  for(const block of prepared){
    let count=0,combo=0;
    for(const p of block.placements){
      let fits=true,lines=0;
      for(let i=0;i<p.masks.length;i++){
        if(board[p.y+i]&p.masks[i]){fits=false;break;}
        if((board[p.y+i]|p.masks[i])===full)lines++;
      }
      if(fits){count++;combo=Math.max(combo,lines);}
    }
    counts.push(count);if(!count)deadTypes++;
    const importance=Math.sqrt(block.area);weighted+=importance*Math.log1p(count);weight+=importance;
    bestCombo=Math.max(bestCombo,300*combo*combo);
  }
  const minFits=counts.length?Math.min(...counts):0,meanLog=weight?weighted/weight:0;
  return {counts,deadTypes,minFits,meanLog,bestCombo,
    value:180*meanLog+140*Math.log1p(minFits)-1200*deadTypes+bestCombo*.12};
}

// Regularize actual normal-draw counts; unknown/deleted identities are excluded.
// The flat prior is a search scenario fallback, never a claim about game odds.
export function scenarioWeights(catalogue,statistics){
  const entries=statistics?.entries||[],counts=catalogue.map(b=>entries.find(e=>e.blockId===b.id)?.normal||0);
  const samples=counts.reduce((s,n)=>s+n,0),prior=30/Math.max(1,catalogue.length);
  return {samples,weights:counts.map(n=>n+prior)};
}

export function makeScenarios(catalogue,weights,count=12,depth=2,seed=1){
  let rng=seed>>>0;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const total=weights.reduce((s,n)=>s+n,0),pick=()=>{let target=random()*total;for(let i=0;i<weights.length;i++){target-=weights[i];if(target<0)return i;}return weights.length-1;};
  return Array.from({length:count},()=>Array.from({length:depth},()=>Array.from({length:3},(_,id)=>({...catalogue[pick()],id}))));
}
