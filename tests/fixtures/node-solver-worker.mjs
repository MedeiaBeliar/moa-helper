import {Worker} from 'node:worker_threads';

// Adapt only the message transport; execute the production worker unchanged.
export function nodeSolverWorker(workerData={}){
  const worker=new Worker(new URL('./web-worker-host.mjs',import.meta.url),{workerData});
  let stopped=false;
  const api={onmessage:null,onerror:null,compilations:0,termination:null,
    postMessage:data=>worker.postMessage(data),
    terminate(){if(!stopped){stopped=true;api.termination=worker.terminate();}return api.termination;}};
  worker.on('message',data=>{
    if(stopped)return;
    if(data.testEvent==='unhandled-input'){api.onerror?.(new Error('Calculation request was dropped'));return;}
    if(data.testEvent==='engine-loading')api.compilations++;
    api.onmessage?.({data});
  });
  worker.on('error',error=>{if(!stopped)api.onerror?.(error);});
  worker.on('exit',code=>{if(!stopped)api.onerror?.(new Error(`Worker exited early: ${code}`));});
  return api;
}
