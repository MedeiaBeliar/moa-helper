import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {root} from './release-files.mjs';
import {deduplicateLibrary} from '../public/library.js';
import {validateState} from '../storage.mjs';

const args=new Set(process.argv.slice(2));
for(const arg of args)assert.ok(['--apply','--examples','--reconcile-stage-totals'].includes(arg),`Unknown option: ${arg}`);
const filename=path.join(root,'data/state.json'),raw=await readFile(filename,'utf8'),original=JSON.parse(raw),source=structuredClone(original),corrections=[];
if(args.has('--reconcile-stage-totals'))for(const entry of source.statistics?.entries??[]){
  for(const column of ['normal','reroll']){
    const sum=Object.values(entry.stages??{}).reduce((n,stage)=>n+stage[column],0);
    if(sum>entry[column]){corrections.push({name:entry.name,column,before:entry[column],after:sum});entry[column]=sum;}
  }
}
const {state,groups}=deduplicateLibrary(source),clean=validateState(state);
for(const key of Object.keys(original))if(!['blocks','slots','statistics','savedAt'].includes(key))assert.deepEqual(clean[key],original[key],`Unrelated field changed: ${key}`);
const totals=s=>s.statistics.entries.reduce((n,e)=>n+e.normal+e.reroll,0);
assert.equal(totals(clean),totals(original)+corrections.reduce((n,c)=>n+c.after-c.before,0));
console.log(JSON.stringify({before:original.blocks.length,after:clean.blocks.length,observations:totals(clean),corrections,
  merges:groups.map(g=>({keep:g.keep.name,remove:g.removed.map(b=>b.name)}))},null,2));
if(args.has('--apply')&&(groups.length||corrections.length)){
  const backupDir=path.join(root,'data/backups');await mkdir(backupDir,{recursive:true});
  const backup=path.join(backupDir,`before-dedupe-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
  await writeFile(backup,raw,{flag:'wx'});
  assert.equal(await readFile(filename,'utf8'),raw,'Save changed during migration; retry after reloading the app.');
  const temporary=path.join(root,'data',`state-${randomUUID()}.tmp`);
  await writeFile(temporary,JSON.stringify({...clean,savedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
  assert.equal(await readFile(filename,'utf8'),raw,'Save changed before replacement; the original was not overwritten.');
  await rename(temporary,filename);
  console.log(`Updated data/state.json; backup: ${path.relative(root,backup)}`);
}
if(args.has('--examples')){
  const example={version:1,blocks:clean.blocks.map((b,i)=>({id:`example-${i}`,name:b.name,cells:b.cells}))};
  const body=JSON.stringify(example,null,2)+'\n';
  await writeFile(path.join(root,'examples/blocks.json'),body);await writeFile(path.join(root,'public/example-blocks.json'),body);
  console.log(`Wrote ${example.blocks.length} example shapes without private IDs or observations.`);
}
if(!args.has('--apply'))console.log('Preview only. Add --apply to save after reviewing the merge report.');
