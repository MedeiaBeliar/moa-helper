// Node-only host for the production browser worker. Incoming messages are
// queued during its initial task, but can dispatch once async engine loading
// yields. Unlike target-worker.mjs, this does not add a ready handshake.
import {parentPort,workerData} from 'node:worker_threads';
import {setTimeout as delay} from 'node:timers/promises';

globalThis.self={postMessage:message=>parentPort.postMessage(message)};
let bootstrapping=true;
const queued=[];
function dispatch(data){
  if(typeof self.onmessage!=='function'){
    parentPort.postMessage({testEvent:'unhandled-input',id:data.id});return;
  }
  self.onmessage({data});
}
function releaseMessages(){
  if(!bootstrapping)return;
  bootstrapping=false;for(const data of queued.splice(0))dispatch(data);
}
parentPort.on('message',data=>bootstrapping?queued.push(data):dispatch(data));
const compile=WebAssembly.compile;
WebAssembly.compile=async bytes=>{
  releaseMessages();
  parentPort.postMessage({testEvent:'engine-loading'});
  if(workerData?.compileDelayMs)await delay(workerData.compileDelayMs);
  if(workerData?.failCompile)throw new Error('Simulated native compile failure');
  return compile(bytes);
};
await import('../../public/solver-worker.js');
releaseMessages();
