import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {initialState,validateState} from './public/state-schema.js';
export {initialState,validateState};

export function createStore(directory) {
  const filename=path.join(directory,'state.json');
  let queue=Promise.resolve();
  return {
    async read() {
      await queue;
      try { return validateState(JSON.parse(await readFile(filename,'utf8'))); }
      catch(error) { if(error.code==='ENOENT') return initialState(); throw error; }
    },
    write(state) {
      const clean=validateState(state);
      const operation=queue.catch(()=>{}).then(async()=>{
        await mkdir(directory,{recursive:true});
        const temporary=path.join(directory,`state-${randomUUID()}.tmp`);
        const savedAt=new Date().toISOString();
        await writeFile(temporary,JSON.stringify({...clean,savedAt},null,2),'utf8');
        await rename(temporary,filename); // atomic replacement; previous state survives a failed write
        return {savedAt};
      });
      queue=operation.catch(()=>{});
      return operation;
    }
  };
}
