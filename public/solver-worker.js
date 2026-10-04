// Register synchronously: solver.js loads Wasm with top-level await. A static
// import here would let the first message arrive before its handler exists.
let solver;
self.onmessage = async ({data}) => {
  let lastPosted=-Infinity;
  try {
    if(!solver&&data.engineModule instanceof WebAssembly.Module)globalThis[Symbol.for('moa.nativeModule')]=data.engineModule;
    const {solve}=await (solver??=import('./solver.js'));
    const input={...data.input,options:{...data.input.options,nativeDeadline:data.deadline}};
    self.postMessage({id:data.id, result:solve(input,{onProgress:result=>{
    if(performance.now()-lastPosted<150&&!result.complete)return;
    lastPosted=performance.now();self.postMessage({id:data.id,progress:true,result});
  }})}); }
  catch (error) { self.postMessage({id:data.id,error:error.message}); }
};
