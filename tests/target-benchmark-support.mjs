import assert from 'node:assert/strict';
import {TARGET_SCORES} from '../public/targets.js';
import {scenarioWeights} from '../public/policy.js';

const validCount=n=>Number.isSafeInteger(n)&&n>=0?n:0;

export function benchmarkPreset(name='comparison'){
  assert.ok(['comparison','500k'].includes(name),'Unknown benchmark preset');
  return name==='500k'?{name,pairs:2,parallel:2,targetOnly:true,maxSpeed:true,stopAtCap:true}:
    {name,pairs:3,targetOnly:false,maxSpeed:false,stopAtCap:false};
}
export function benchmarkJobs({seed,pairs,preset='comparison'}){
  const config=benchmarkPreset(preset);
  return Array.from({length:config.targetOnly?config.pairs:pairs},(_,i)=>(config.targetOnly?['target']:['normal','target'])
    .map(mode=>({gameId:`${i+1}-${mode}`,mode,seed:(seed+i)>>>0}))).flat();
}
export function benchmarkStopStatus(score,dead,stopAtCap=false){
  return stopAtCap&&score>=500000?'cap-reached':dead?'dead':null;
}

// This intentionally reads only long-standing library/statistics fields. A
// saved game from before target mode does not need a migration for a benchmark.
export function catalogueFromState(state){
  assert.ok(Array.isArray(state.blocks)&&state.blocks.length>0&&state.blocks.length<=500,'블록 목록은 1~500개여야 합니다.');
  return state.blocks.map((block,index)=>{
    assert.ok(Array.isArray(block.cells)&&block.cells.length&&block.cells.every(cell=>Array.isArray(cell)&&cell.length===2&&cell.every(n=>Number.isInteger(n)&&n>=0&&n<=20)),'잘못된 조각 좌표입니다.');
    const entry=state.statistics?.entries?.find(e=>e.blockId===block.id),stages={};
    for(const stage of [1,2,3,4,5])if(entry?.stages?.[stage]){
      stages[stage]={normal:validCount(entry.stages[stage].normal),reroll:validCount(entry.stages[stage].reroll)};
    }
    return {id:`type-${index}`,name:block.name,cells:block.cells.map(cell=>cell.slice()),normal:validCount(entry?.normal),reroll:validCount(entry?.reroll),stages};
  });
}

export function createDrawModel(catalogue){
  const blocks=catalogue.map((block,index)=>({...block,id:`draw-${index}`}));
  const statistics={entries:blocks.map(block=>({...block,blockId:block.id}))};
  const table={},description={};
  for(const stage of [1,2,3,4,5]){
    table[stage]={};description[stage]={};
    for(const source of ['normal','reroll']){
      const distribution=scenarioWeights(blocks,statistics,{stage,source});
      table[stage][source]=distribution.weights;
      description[stage][source]={source:distribution.stageSamples?'stage-with-overall-prior':'overall',stageSamples:distribution.stageSamples};
    }
  }
  return {description,weights(stage,source){assert.ok(table[stage]?.[source],'잘못된 단계 또는 추첨 종류');return table[stage][source];}};
}

export function validateResume(saved,{mode,seed,hashes}){
  assert.equal(saved.version,1,'알 수 없는 체크포인트 형식입니다.');
  assert.equal(saved.mode,mode);assert.equal(saved.seed,seed);
  assert.deepEqual(saved.hashes,hashes,'코드 또는 입력이 바뀌었습니다. 기존 게임에 이어 붙일 수 없습니다. 새 비교를 실행하세요.');
  assert.ok(saved.game&&saved.rng&&saved.ledger,'체크포인트에 게임/난수/진행 기록이 없습니다.');
  for(const key of ['normal','reroll','icon','type'])assert.ok(Number.isInteger(saved.rng[key])&&saved.rng[key]>=0&&saved.rng[key]<2**32,'체크포인트 난수 상태가 올바르지 않습니다.');
}

export function predictionAtStep(result,index){
  return result?.target?.hitStep===index+1&&Number.isSafeInteger(result.target.hit)?result.target.hit:null;
}

export function recordTargetArrival(hits,{score,skillTotal,...details}){
  if(!TARGET_SCORES.includes(score))return false;
  const arrival=hits.find(hit=>hit.score===score);
  if(!arrival){hits.push({score,...details,skillTotal,canStopBelowSkillCap:skillTotal<7});return true;}
  if(!arrival.canStopBelowSkillCap&&skillTotal<7){
    arrival.canStopBelowSkillCap=true;arrival.stopAction=details.action;arrival.stopSkillTotal=skillTotal;
  }
  return false;
}
