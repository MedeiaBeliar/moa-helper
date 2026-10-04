import {SOLVER_WATCHDOG_MS,nativeEngineModule} from './native-engine.js';
import {solveFast} from './fast.js';

// Own the wall-clock deadline outside the synchronous Wasm call. This module
// is shared by the UI and Node-only transport tests, including stalled workers.
export function startSolverRequest(input,{id,onProgress=()=>{},onFinish,
  createWorker=()=>new Worker('/solver-worker.js',{type:'module'})}={}){
  const started=performance.now();
  let worker,latest=null,settled=false,timer,backupTimer;
  function stop(){
    settled=true;clearTimeout(timer);clearTimeout(backupTimer);
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}
  }
  function finish(data){
    if(settled)return;stop();onFinish(data);
  }
  function accept(result){
    if(!latest?.complete||result.complete)latest=result;
    onProgress(latest);
  }
  function backup(){
    if(latest)return;
    // Only used when initialization or transport has not delivered any plan.
    // Reserve this before the deadline so a slow download cannot yield nothing.
    accept({...solveFast({...input,options:{...input.options,timeLimit:45}}),nativeFallback:true});
  }
  function recover(timedOut,error){
    if(settled)return;
    try{
      backup();
      finish({id,result:{...latest,timedOut,duration:Math.round(performance.now()-started),
        ...(error?{nativeFallback:true,nativeError:error.message||String(error)}:{})}});
    }catch(failure){finish({id,error:failure.message});}
  }
  timer=setTimeout(()=>recover(true),SOLVER_WATCHDOG_MS);
  backupTimer=setTimeout(()=>{if(!settled&&!latest)try{backup();}catch(error){recover(false,error);}},600);
  try{
    worker=createWorker();
    worker.onmessage=({data})=>{
      if(settled||data.id!==id)return;
      if(data.error){recover(false,new Error(data.error));return;}
      if(!data.result)return;
      if(data.progress)accept(data.result);
      else finish({id,result:{...data.result,duration:Math.round(performance.now()-started)}});
    };
    worker.onerror=error=>recover(false,error);
    worker.postMessage({id,input,engineModule:nativeEngineModule(),
      deadline:performance.timeOrigin+started+SOLVER_WATCHDOG_MS-60});
  }catch(error){recover(false,error);}
  return {terminate:stop};
}
