import {shapeKey} from './library.js';

// Only canonical shape IDs, stage buckets and counts cross the network.
// User names, board cells, scores, screenshots and preferences stay local.
export function contributionCounts(state,catalogue,identity={}){
  const shapes=new Map(catalogue.map(block=>[shapeKey(block.cells),block.id]));
  for(const block of state.blocks)Object.defineProperty(identity,block.id,{value:shapes.get(shapeKey(block.cells))??null,writable:true,enumerable:true,configurable:true});
  const counts=new Map();
  for(const entry of state.statistics?.entries||[]){
    const id=entry.blockId!==null&&Object.hasOwn(identity,entry.blockId)?identity[entry.blockId]:null;
    const unknown={normal:entry.normal,reroll:entry.reroll};
    for(const stage of [1,2,3,4,5,0]){
      const value=stage===0?unknown:entry.stages?.[stage]||{normal:0,reroll:0};
      if(stage!==0){unknown.normal-=value.normal;unknown.reroll-=value.reroll;}
      if(!value.normal&&!value.reroll)continue;
      const key=JSON.stringify([id,stage]),row=counts.get(key)||{blockId:id,stage,normal:0,reroll:0};
      row.normal+=value.normal;row.reroll+=value.reroll;counts.set(key,row);
    }
  }
  return [...counts.values()].sort((a,b)=>String(a.blockId).localeCompare(String(b.blockId))||a.stage-b.stage);
}

export function statisticsFromCounts(counts,catalogue){
  const blocks=new Map(catalogue.map(block=>[block.id,block])),entries=new Map();
  for(const row of counts){
    const entry=entries.get(row.blockId)||{blockId:row.blockId,name:blocks.get(row.blockId)?.name||'미분류 (화면 인식)',normal:0,reroll:0,stages:{}};
    entry.normal+=row.normal;entry.reroll+=row.reroll;
    if(row.stage)entry.stages[row.stage]={normal:row.normal,reroll:row.reroll};
    entries.set(row.blockId,entry);
  }
  return {entries:[...entries.values()]};
}

export function communityForLibrary(statistics,catalogue,blocks){
  const counts=new Map(statistics.entries.map(entry=>[entry.blockId,entry]));
  const byShape=new Map(catalogue.map(block=>[shapeKey(block.cells),counts.get(block.id)]));
  // Rotation/reflection duplicates split their sample mass instead of
  // multiplying the chance of that shape in the solver catalogue.
  const copies=new Map();for(const block of blocks){const key=shapeKey(block.cells);copies.set(key,(copies.get(key)||0)+1);}
  return {entries:blocks.flatMap(block=>{
    const key=shapeKey(block.cells),entry=byShape.get(key);if(!entry)return [];
    const n=copies.get(key),scale=value=>({normal:value.normal/n,reroll:value.reroll/n});
    return [{...entry,...scale(entry),blockId:block.id,name:block.name,stages:Object.fromEntries(Object.entries(entry.stages||{}).map(([stage,value])=>[stage,scale(value)]))}];
  })};
}
