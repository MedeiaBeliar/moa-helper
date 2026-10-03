import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-stage-browser-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser,puts=0;
try{
  const legacy=initialState();delete legacy.clearedLines;
  Object.assign(legacy,{cols:3,rows:3,board:[3,0,0],blocks:[{id:'a',name:'.',cells:[[0,0]]},{id:'b',name:'ㅡ',cells:[[0,0],[1,0]]}],statistics:{entries:[{blockId:'a',name:'.',normal:10,reroll:2}]}});
  await store.write(legacy);
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      if(route.request().method()==='PUT')puts++;
      try{const result=route.request().method()==='PUT'?await store.write(route.request().postDataJSON()):await store.read();return route.fulfill({contentType:'application/json',body:JSON.stringify(result)});}
      catch(error){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
    }
    const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    try{return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const saved=()=>page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const scope=async value=>{await page.locator('#open-statistics').click();await page.locator('#statistics-stage').selectOption(String(value));};
  const summary=()=>page.locator('#statistics-total').textContent();
  const counter=async value=>{await page.locator('#cleared-lines').fill(String(value));await page.locator('#cleared-lines').press('Enter');};
  const count=(id,source)=>page.locator(`#statistics-rows tr[data-block-id="${id}"] input[data-source="${source}"]`);
  const edit=async(id,source,value)=>{await count(id,source).fill(String(value));await count(id,source).press('Enter');await saved();};
  await page.goto(base);await saved();
  assert.equal(await page.locator('#cleared-lines').inputValue(),'');assert.equal(await page.locator('#current-stage').textContent(),'단계 미상');
  assert.equal(await summary(),'일반 10회 · 바꾸기 2회 · 합계 12회');
  await scope('unknown');assert.equal(await summary(),'일반 10회 · 바꾸기 2회 · 합계 12회');
  await scope(1);assert.equal(await summary(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await counter(30);await saved();assert.equal(await page.locator('#current-stage').textContent(),'1단계');
  await page.locator('#tab-manual').click();await page.locator('#search-blocks').fill('...');await page.locator('#search-blocks').press('Enter');
  await page.getByRole('button',{name:'직접 배치',exact:true}).first().click();
  await page.locator('.board-cell[data-x="2"][data-y="0"]').click();await saved();
  assert.equal(await page.locator('#cleared-lines').inputValue(),'31');assert.equal(await page.locator('#current-stage').textContent(),'2단계');
  assert.equal(await summary(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await scope(2);assert.equal(await summary(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.locator('#tab-manual').click();await page.locator('#solve').click();await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden);
  await saved();await scope('all');assert.equal(await summary(),'일반 13회 · 바꾸기 2회 · 합계 15회');
  await page.locator('#statistics-back').click();await page.locator('#complete-plan').click();await saved();assert.equal((await store.read()).clearedLines,31);
  await scope(2);await edit('b','normal',6);assert.equal(await summary(),'일반 6회 · 바꾸기 0회 · 합계 6회');
  await edit('a','normal',2);await edit('a','reroll',1);assert.equal(await summary(),'일반 8회 · 바꾸기 1회 · 합계 9회');
  await page.locator('#statistics-search').fill('.');
  assert.equal(await page.locator('#statistics-rows tr').count(),1);
  assert.equal(await page.locator('#statistics-rows tr td[data-source="normal"] strong').textContent(),'25.0%');
  assert.equal(await summary(),'일반 8회 · 바꾸기 1회 · 합계 9회');
  await page.locator('#statistics-search').fill('');await scope('all');
  assert.equal(await summary(),'일반 21회 · 바꾸기 3회 · 합계 24회');
  await count('a','normal').fill('1');await count('a','normal').press('Enter');
  assert.match(await page.locator('#message').textContent(),/각 단계/);assert.equal((await store.read()).statistics.entries.find(e=>e.blockId==='a').normal,15);
  await scope(2);await edit('a','normal',4);await saved();
  await page.reload();await saved();await scope(2);assert.equal(await count('a','normal').inputValue(),'4');
  assert.equal(await page.locator('#cleared-lines').inputValue(),'31');
  for(const [lines,stage] of [[60,2],[61,3],[100,3],[101,4],[150,4],[151,5]]){await counter(lines);assert.equal(await page.locator('#current-stage').textContent(),`${stage}단계`);}
  await saved();await counter('');await saved();assert.equal((await store.read()).clearedLines,null);
  for(const width of [320,375,768]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:1280,height:1000});await mkdir('test-results',{recursive:true});await page.locator('#statistics-panel').screenshot({path:'test-results/stage-statistics.png'});
  // Reset is global even while a stage with no records is selected; undo restores all scopes.
  const beforeReset=await store.read();await scope(5);assert.equal(await page.locator('#statistics-reset').isDisabled(),false);
  await page.locator('#statistics-reset').click();await saved();assert.deepEqual((await store.read()).statistics,{entries:[]});
  await page.locator('#statistics-undo').click();await saved();assert.deepEqual((await store.read()).statistics,beforeReset.statistics);
  // An older running server must not silently drop the newly added data fields.
  const oldResponse=await store.read();delete oldResponse.captureStatsVersion;
  await page.route('**/api/state',route=>route.request().method()==='GET'?route.fulfill({contentType:'application/json',body:JSON.stringify(oldResponse)}):route.fallback());
  await page.reload();await page.locator('#stage-server-warning').waitFor();const beforePuts=puts;
  await counter(101);await page.getByText('저장 실패 · 임시 보관 중',{exact:true}).waitFor();
  assert.equal(puts,beforePuts);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moa-manual-unsaved-v1')).clearedLines),101);
  await page.unroute('**/api/state');await page.reload();await saved();assert.equal((await store.read()).clearedLines,101);
  assert.equal(await page.locator('#current-stage').textContent(),'4단계');assert.equal(await page.locator('#stage-server-warning').isHidden(),true);
  assert.deepEqual(errors,[]);
  console.log('PASS stages: legacy unknown, all-stage totals, 30-to-31 transition, no recount, scoped probabilities/search/editing, persistence, global reset/undo, mobile layout and old-server draft recovery; no server');
}finally{
  await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});
}
