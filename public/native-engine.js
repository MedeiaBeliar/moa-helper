// The computation-only WebAssembly module supplied with the reference HTML.
// It has no imports, so it cannot access the DOM, storage, network or host APIs.
export const NATIVE_SETTINGS=Object.freeze({beam:640,probe:32,scenarios:8,finalists:24,
  open_square:20,fragment:8,final_diversity:1,ensemble:true,future_mobility:100,
  observed_draws:true,affordable_holes:true});
export const SOLVER_MAX_MS=1000;
// Leave time for worker termination, message dispatch and result rendering.
export const SOLVER_WATCHDOG_MS=SOLVER_MAX_MS-100;
export const NATIVE_PASSES=Object.freeze([
  [32,4,3,4],[64,6,4,6],[128,8,6,8],[160,8,6,10],
  [192,12,8,12],[320,16,8,16],[640,32,8,24]
].map(([beam,probe,scenarios,finalists])=>Object.freeze({...NATIVE_SETTINGS,beam,probe,scenarios,finalists})));
// Ensemble mode checks at least seven future hands per finalist. Estimate
// total work from both current-hand breadth and future-hand comparisons.
export const nativeWork=settings=>settings.beam+2*settings.probe*Math.max(7,settings.scenarios)*settings.finalists;
export function nextNativePass(index,elapsedMs,remainingMs){
  const cost=nativeWork(NATIVE_PASSES[index]),allowance=remainingMs-30;
  for(let next=NATIVE_PASSES.length-1;next>index;next--){
    if(Math.max(1,elapsedMs)*nativeWork(NATIVE_PASSES[next])/cost*1.25<=allowance)return next;
  }
  // The first call can include tier-up costs that do not recur. If its
  // estimate is pessimistic, try the next level while keeping the incumbent;
  // the host watchdog, not this estimate, enforces the deadline.
  return index+1<NATIVE_PASSES.length&&remainingMs>120?index+1:-1;
}
let engine=null,loadError=null,compiledModule=null;
try{
  compiledModule=globalThis[Symbol.for('moa.nativeModule')];
  if(!(compiledModule instanceof WebAssembly.Module)){
    const url=new URL('./native-engine.wasm',import.meta.url);
    const bytes=url.protocol==='file:'
      ?await (await import('node:fs/promises')).readFile(url)
      :await (async()=>{const response=await fetch(url);if(!response.ok)throw new Error('Engine download failed');return response.arrayBuffer();})();
    compiledModule=await WebAssembly.compile(bytes);
  }
  if(WebAssembly.Module.imports(compiledModule).length)throw new Error('Unexpected native engine imports');
  engine=new WebAssembly.Instance(compiledModule,{}).exports;
}catch(error){loadError=error;}

export function nativeEngineStatus(){return {ready:!!engine,error:loadError?.message??null};}
export function nativeEngineModule(){return engine?compiledModule:null;}
export function runNativeEngine(input){
  if(!engine)throw new Error('Native engine unavailable');
  const bytes=new TextEncoder().encode(JSON.stringify(input)),pointer=engine.alloc(bytes.length);
  new Uint8Array(engine.memory.buffer,pointer,bytes.length).set(bytes);
  try{
    const output=engine.solve(pointer,bytes.length),length=engine.output_len();
    if(length<1||length>4_000_000)throw new Error('Invalid native output size');
    const result=JSON.parse(new TextDecoder().decode(new Uint8Array(engine.memory.buffer,output,length)));
    if(result.error)throw new Error(result.error);
    return result;
  }finally{engine.release(pointer,bytes.length);}
}
