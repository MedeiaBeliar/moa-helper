import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,rename,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {atomicJson} from './atomic-json.mjs';
test('transient Windows replacement denial preserves old JSON and retries full file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'moa-atomic-')),file=join(root,'checkpoint.json');
  try{
    await writeFile(file,'{"old":true}');let calls=0;
    await atomicJson(file,{new:true},{delay:async()=>{},renameFile:async(from,to)=>{
      if(++calls<3){assert.deepEqual(JSON.parse(await readFile(to,'utf8')),{old:true});throw Object.assign(new Error('file reader lock'),{code:'EPERM'});}
      await rename(from,to);
    }});
    assert.equal(calls,3);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{new:true});
  }finally{await rm(root,{recursive:true,force:true});}
});
