import {normalize,variants} from './solver.js';

// Translation, quarter turns and reflection all describe the same library shape.
export function shapeKey(cells){
  if(!cells?.length)throw new Error('블록 모양이 비어 있습니다.');
  return variants(normalize(cells),true,true).map(v=>JSON.stringify(v.cells)).sort()[0];
}

export function deduplicateLibrary(state){
  const entries=state.statistics?.entries??[],counts=new Map(entries.map(e=>[e.blockId,e.normal+e.reroll]));
  const shapes=new Map();
  state.blocks.forEach((block,index)=>{
    const key=shapeKey(block.cells);
    if(!shapes.has(key))shapes.set(key,[]);
    shapes.get(key).push({block,index,count:counts.get(block.id)??0});
  });
  const aliases=new Map(),groups=[];
  for(const group of shapes.values()){
    if(group.length<2)continue;
    group.sort((a,b)=>b.count-a.count||a.index-b.index);
    const keep=group[0].block,removed=group.slice(1).map(({block})=>block);
    for(const block of removed)aliases.set(block.id,keep);
    groups.push({keep,removed});
  }
  if(!groups.length)return {state,groups};
  const survivors=new Map(state.blocks.filter(b=>!aliases.has(b.id)).map(b=>[b.id,b]));
  const merged=new Map();
  for(const source of entries){
    const block=aliases.get(source.blockId)??survivors.get(source.blockId),id=block?.id??source.blockId;
    let target=merged.get(id);
    if(!target){target={...source,blockId:id,name:block?.name??source.name,normal:0,reroll:0};delete target.stages;merged.set(id,target);}
    target.normal+=source.normal;target.reroll+=source.reroll;
    if(!Number.isSafeInteger(target.normal+target.reroll))throw new Error('통계 합계가 저장 가능한 범위를 초과합니다.');
    if(source.stages){
      target.stages??={};
      for(const [stage,value]of Object.entries(source.stages)){
        target.stages[stage]??={normal:0,reroll:0};
        target.stages[stage].normal+=value.normal;target.stages[stage].reroll+=value.reroll;
      }
    }
  }
  const slots=state.slots.map(slot=>{
    const keep=slot&&aliases.get(slot.blockId);
    // Keep the active piece's orientation, instance and deferred draw marker.
    return keep?{...slot,blockId:keep.id,name:keep.name}:slot;
  });
  return {state:{...state,blocks:[...survivors.values()],statistics:{...state.statistics,entries:[...merged.values()]},slots},groups};
}
