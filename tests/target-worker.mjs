import {parentPort} from 'node:worker_threads';
import {solve} from '../public/solver.js';

parentPort.postMessage({ready:true});
parentPort.on('message',({id,input})=>{
  try{
    const result=solve(input,{onProgress:result=>parentPort.postMessage({id,progress:true,result})});
    parentPort.postMessage({id,result});
  }catch(error){parentPort.postMessage({id,error:error.stack||String(error)});}
});
