import {readFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {releaseFiles,root} from './release-files.mjs';
import {initialState,validateState} from '../storage.mjs';
import {shapeKey} from '../public/library.js';

const files=await releaseFiles(),included=new Set(files),errors=[];
assert.ok(!files.some(file=>file.startsWith('.github/workflows/')),'Hosted CI workflows are excluded from this project.');
for(const file of files){
  if(!/\.(md|mjs|js|html|css|json|yml|cmd|svg|txt)$/.test(file))continue;
  const text=await readFile(path.join(root,file),'utf8');
  if(/(?:[A-Z]:[\\/]Users[\\/]|[A-Z]:[\\/]Programming[\\/])/i.test(text))errors.push(`${file}: 개인 절대 경로`);
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}\b/.test(text))errors.push(`${file}: 비밀 정보 형식`);
  if(!file.endsWith('.md'))continue;
  for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
    const target=match[1].split(/\s+"/)[0].replace(/^<|>$/g,'').split('#')[0];
    if(!target||/^[a-z]+:/i.test(target))continue;
    const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(target)));
    if(!included.has(resolved))errors.push(`${file}: 배포 파일에서 찾을 수 없는 링크 ${target}`);
  }
}
const html=await readFile(path.join(root,'public/index.html'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,'중복 HTML ID');
assert.ok(html.includes('<title>모아모아 도우미</title>'),'사이트 제목');
const example=JSON.parse(await readFile(path.join(root,'examples/blocks.json'),'utf8'));
assert.equal(example.version,1);assert.equal(example.blocks.length,19);
assert.equal(new Set(example.blocks.map(b=>shapeKey(b.cells))).size,example.blocks.length);
assert.deepEqual(example,JSON.parse(await readFile(path.join(root,'public/example-blocks.json'),'utf8')));
validateState({...initialState(),blocks:example.blocks});
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
assert.equal(Object.keys(pkg.dependencies??{}).length,0,'런타임 의존성 0개');
assert.equal(pkg.license,'MIT');
assert.equal(pkg.devDependencies.playwright,JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8')).packages[''].devDependencies.playwright);
assert.ok(included.has('public/fonts/Pretendard-LICENSE.txt'));
if(errors.length)throw new Error(errors.join('\n'));
console.log(`PASS release: ${files.length} allowed files, local document links, unique UI IDs, 19 unique example blocks, dependency lock and font license`);
console.log('Private save files, generated output, installed packages and workspace archives are excluded.');
