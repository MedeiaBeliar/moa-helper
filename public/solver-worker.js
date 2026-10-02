import { solve } from './solver.js';
self.onmessage = ({data}) => {
  let lastPosted=0;
  try { self.postMessage({id:data.id, result:solve(data.input,{onProgress:result=>{
    if(performance.now()-lastPosted<150&&!result.complete)return;
    lastPosted=performance.now();self.postMessage({id:data.id,progress:true,result});
  }})}); }
  catch (error) { self.postMessage({id:data.id,error:error.message}); }
};
