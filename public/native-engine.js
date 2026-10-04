// The computation-only WebAssembly module supplied with the reference HTML.
// It has no imports, so it cannot access the DOM, storage, network or host APIs.
export const NATIVE_SETTINGS=Object.freeze({beam:640,probe:32,scenarios:8,finalists:24,
  open_square:20,fragment:8,final_diversity:1,ensemble:true,future_mobility:100,
  observed_draws:true,affordable_holes:true});
export const SOLVER_MAX_MS=5000;
// Leave time for worker termination, message dispatch and result rendering.
export const SOLVER_WATCHDOG_MS=SOLVER_MAX_MS-100;
export const NATIVE_PASSES=Object.freeze([
  Object.freeze({...NATIVE_SETTINGS,beam:128,probe:8,scenarios:3,finalists:6}),
  Object.freeze({...NATIVE_SETTINGS,beam:320,probe:16,scenarios:6,finalists:12}),
  NATIVE_SETTINGS
]);
let engine=null,loadError=null;
try{
  const url=new URL('./native-engine.wasm',import.meta.url);
  const bytes=url.protocol==='file:'
    ?await (await import('node:fs/promises')).readFile(url)
    :await (async()=>{const response=await fetch(url);if(!response.ok)throw new Error('Engine download failed');return response.arrayBuffer();})();
  const module=await WebAssembly.compile(bytes);
  if(WebAssembly.Module.imports(module).length)throw new Error('Unexpected native engine imports');
  engine=new WebAssembly.Instance(module,{}).exports;
}catch(error){loadError=error;}

export function nativeEngineStatus(){return {ready:!!engine,error:loadError?.message??null};}
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
