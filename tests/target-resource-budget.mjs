import {cpus,totalmem,freemem} from 'node:os';

export function recommendedParallelism({threads=cpus().length,memoryBytes=totalmem()}={}){
  return Math.max(1,Math.min(4,Math.floor(threads/4)||1,Math.floor(memoryBytes/2**30/2)||1));
}
export function createCpuSampler(){
  const counters=()=>cpus().reduce((out,cpu)=>{
    out.idle+=cpu.times.idle;out.total+=Object.values(cpu.times).reduce((a,b)=>a+b,0);return out;
  },{idle:0,total:0});
  let previous=counters();
  return ()=>{
    const now=counters(),elapsed=now.total-previous.total;
    const cpuPercent=elapsed>0?Math.max(0,Math.min(100,100*(1-(now.idle-previous.idle)/elapsed))):0;previous=now;
    return {cpuPercent,memoryFreeGiB:freemem()/2**30};
  };
}

export function createResourceBudget({maxParallel=recommendedParallelism(),shouldStop=()=>false,
  sample=createCpuSampler(),sampleIntervalMs=1000,cooldownRatio=1,minRestMs=100,pollMs=100}={}){
  if(!Number.isInteger(maxParallel)||maxParallel<1||maxParallel>4)throw new Error('병렬 계산은 1~4개 사이여야 합니다.');
  let active=0,closed=false,reading={cpuPercent:0,memoryFreeGiB:freemem()/2**30},sampledAt=-Infinity;
  const queue=[];
  const stopped=()=>closed||shouldStop();
  const stopError=()=>Object.assign(new Error('사용자가 테스트를 중지했습니다.'),{code:'BENCHMARK_STOPPED'});
  function refresh(){
    const now=performance.now();if(now-sampledAt>=sampleIntervalMs){reading=sample();sampledAt=now;}
    return reading;
  }
  function state(){
    const {cpuPercent,memoryFreeGiB}=refresh();
    const blocked=cpuPercent>=85||memoryFreeGiB<.5;
    const throttled=blocked||cpuPercent>=60||memoryFreeGiB<1.5;
    return {maxParallel,limit:blocked?0:throttled?1:maxParallel,active,queued:queue.length,cpuPercent,memoryFreeGiB,throttled,blocked};
  }
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function run(task){
    const ticket={};queue.push(ticket);
    try{
      while(true){
        if(stopped())throw stopError();
        const current=state();
        if(queue[0]===ticket&&active<current.limit){queue.shift();active++;break;}
        await pause(pollMs);
      }
    }catch(error){const at=queue.indexOf(ticket);if(at>=0)queue.splice(at,1);throw error;}
    const started=performance.now();
    try{return await task();}
    finally{
      // Hold this slot while resting; otherwise another queued game could use
      // the supposedly idle half of the CPU budget immediately.
      const elapsed=performance.now()-started,current=state();
      const until=performance.now()+Math.max(minRestMs,elapsed*cooldownRatio)*(current.throttled?3:1);
      while(performance.now()<until&&!stopped())await pause(Math.min(pollMs,until-performance.now()));
      active--;
    }
  }
  return {run,snapshot:state,close(){closed=true;}};
}
