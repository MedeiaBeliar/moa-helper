import test from 'node:test';
import assert from 'node:assert/strict';
import {recommendedParallelism,createResourceBudget} from './target-resource-budget.mjs';

const idle=()=>({cpuPercent:0,memoryFreeGiB:8}),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('automatic parallelism leaves most CPU threads available and obeys memory limits',()=>{
  assert.equal(recommendedParallelism({threads:12,memoryBytes:32*2**30}),3);
  assert.equal(recommendedParallelism({threads:32,memoryBytes:64*2**30}),4);
  assert.equal(recommendedParallelism({threads:12,memoryBytes:3*2**30}),1);
  assert.equal(recommendedParallelism({threads:1,memoryBytes:2**30}),1);
});
test('many games share a bounded, fair computation queue',async()=>{
  const budget=createResourceBudget({maxParallel:2,sample:idle,cooldownRatio:0,minRestMs:0,pollMs:2});
  let active=0,peak=0;const order=[];
  await Promise.all(Array.from({length:7},(_,i)=>budget.run(async()=>{active++;peak=Math.max(peak,active);order.push(i);await pause(10);active--;return i;})));
  assert.equal(peak,2);assert.deepEqual(order,[0,1,2,3,4,5,6]);assert.equal(budget.snapshot().active,0);budget.close();
});
test('cooldown occupies its slot so queued games cannot bypass the rest period',async()=>{
  const budget=createResourceBudget({maxParallel:1,sample:idle,cooldownRatio:0,minRestMs:40,pollMs:2});
  let ended,second;
  await Promise.all([budget.run(async()=>{ended=performance.now();}),budget.run(async()=>{second=performance.now();})]);
  assert.ok(second-ended>=35);budget.close();
});
test('heavy computer use pauses new work; stopping releases all queued requests',async()=>{
  let stopped=false;
  const budget=createResourceBudget({maxParallel:3,shouldStop:()=>stopped,sample:()=>({cpuPercent:90,memoryFreeGiB:8}),sampleIntervalMs:0,pollMs:2});
  let calls=0;const results=Promise.allSettled([budget.run(()=>calls++),budget.run(()=>calls++)]);
  await pause(15);assert.equal(calls,0);assert.equal(budget.snapshot().limit,0);stopped=true;
  const settled=await results;assert.ok(settled.every(s=>s.status==='rejected'&&s.reason.code==='BENCHMARK_STOPPED'));assert.equal(budget.snapshot().queued,0);budget.close();
});
test('moderate load reduces the limit and low memory suspends new calculations',()=>{
  let values={cpuPercent:65,memoryFreeGiB:8};
  const budget=createResourceBudget({maxParallel:3,sample:()=>values,sampleIntervalMs:0});
  assert.equal(budget.snapshot().limit,1);values={cpuPercent:2,memoryFreeGiB:.25};assert.equal(budget.snapshot().limit,0);
  values={cpuPercent:2,memoryFreeGiB:8};assert.equal(budget.snapshot().limit,3);budget.close();
});

test('explicit maximum-speed mode keeps two slots without CPU throttling or cooldown',async()=>{
  const budget=createResourceBudget({maxParallel:2,throttle:false,cooldownRatio:0,minRestMs:0,pollMs:1,sample:()=>({cpuPercent:95,memoryFreeGiB:8})});
  assert.equal(budget.snapshot().limit,2);assert.equal(budget.snapshot().throttled,false);
  let active=0,peak=0;
  await Promise.all([1,2].map(()=>budget.run(async()=>{active++;peak=Math.max(peak,active);await pause(5);active--;})));
  assert.equal(peak,2);assert.equal(budget.snapshot().active,0);budget.close();
});
