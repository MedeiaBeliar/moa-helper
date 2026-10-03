import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';

// Browser interception keeps the player's save and local server untouched.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-keyboard-')),store=createStore(dir);
const base='http://localhost:3210',publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const blocks=[['ㄱ',[[0,0]]],['ㅅ',[[0,0],[1,0]]],['ㅡ',[[0,0],[1,0],[2,0]]],['ㅣ',[[0,0],[0,1]]]].map(([name,cells],i)=>({id:`b${i}`,name,cells}));
const fixture=extra=>({...initialState(),cols:6,rows:6,board:Array(6).fill(0),blocks,...extra});
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.searchInputs=[];const NativeWorker=Worker;
    window.Worker=class extends NativeWorker{postMessage(message,...rest){if(message?.input)window.searchInputs.push(structuredClone(message.input));return super.postMessage(message,...rest);}};
  });
  await page.context().route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      const body=request.method()==='PUT'?await store.write(request.postDataJSON()):await store.read();
      return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
    }
    const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
    try{return route.fulfill({contentType:mime[path.extname(url.pathname)]||'text/html; charset=utf-8',body:await readFile(path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1)))});}catch{return route.fulfill({status:404,body:''});}
  });
  const saved=()=>page.locator('#save-status').filter({hasText:/파일에 저장됨|Saved to file/}).waitFor();
  async function load(extra={}){await store.write(fixture(extra));await page.goto(base);await saved();}
  async function persist(action){const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state'&&r.request().method()==='PUT');await action();await response;await saved();return store.read();}
  const search=page.locator('#search-blocks'),cell=(x,y)=>page.locator(`.board-cell[data-x="${x}"][data-y="${y}"]`);
  const requests=()=>page.evaluate(()=>window.searchInputs.length);
  async function planned(count){await page.waitForFunction(n=>window.searchInputs.length===n&&!document.querySelector('#solve').disabled&&!document.querySelector('#complete-plan').hidden,count);await saved();}
  const blur=()=>page.evaluate(()=>document.activeElement?.blur());

  await load();await page.keyboard.type('ttm');
  assert.equal(await search.inputValue(),'ttm');assert.equal(await search.evaluate(n=>n===document.activeElement),true);
  await search.press('Enter');assert.equal(await page.locator('.tray-slot.occupied').count(),3);assert.equal(await requests(),0);
  await search.press('Enter');await planned(1);
  const selected=(await store.read()).slots.map(s=>s.instanceId);
  await search.fill('rrr');await search.press('Enter');await planned(2);
  assert.deepEqual((await store.read()).slots.map(s=>s.instanceId),selected,'Enter on a full hand solves without replacing it');
  await blur();await cell(0,0).focus();await page.keyboard.press('Enter');await planned(3);
  assert.equal(await cell(0,0).evaluate(n=>n.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}))),false);
  assert.equal(await requests(),3,'holding Enter must not restart the worker');
  assert.equal(await page.locator('.board-cell.filled').count(),0,'Enter must not toggle the focused board cell');
  console.log('PASS Enter selection, empty-search solve, full-hand solve and focused-cell safety');

  await load();await persist(()=>page.locator('#quick-input').check());await blur();
  await page.keyboard.type('ttm');await planned(1);assert.equal(await search.inputValue(),'');
  assert.deepEqual((await store.read()).slots.map(s=>s.name),['ㅅ','ㅅ','ㅡ']);
  await page.reload();await saved();assert.equal(await page.locator('#quick-input').isChecked(),true);
  await persist(()=>page.locator('#reset-tray').click());
  await search.focus();await search.evaluate(input=>{
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='긔';
    input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true,data:'긔'}));
  });
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);assert.equal(await requests(),0);
  await search.evaluate(input=>{
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
    input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'긔'}));
    input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'긔'}));
  });
  await planned(1);assert.deepEqual((await store.read()).slots.map(s=>s.name),['ㄱ','ㅡ','ㅣ']);
  await persist(()=>page.locator('#reset-tray').click());await search.fill('zzz');
  await page.waitForFunction(()=>document.querySelector('#message').classList.contains('error'));
  assert.equal(await requests(),1);assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  console.log('PASS quick input, persistence, composed Hangul and unknown-name rejection');

  await load({skills:{dot:2,reroll:1}});await cell(2,3).hover();await blur();
  let state=await persist(()=>page.keyboard.press('1'));
  assert.deepEqual(state.skillIcons,[{x:2,y:3,kind:'dot'}]);assert.deepEqual(state.skills,{dot:2,reroll:1});
  await page.keyboard.press('1');
  assert.deepEqual((await store.read()).skillIcons,state.skillIcons,'same shortcut is idempotent');
  state=await persist(()=>page.keyboard.press('2'));assert.equal(state.skillIcons[0].kind,'reroll');
  state=await persist(()=>page.keyboard.press('`'));assert.deepEqual(state.skillIcons,[]);assert.equal(state.board[3],0);
  await page.locator('#current-score').fill('');await page.keyboard.press('1');await page.keyboard.press('2');
  await persist(()=>page.locator('#current-score').press('Enter'));
  assert.equal((await store.read()).currentScore,12);assert.deepEqual((await store.read()).skillIcons,[]);
  await page.mouse.move(5,5);await blur();await page.keyboard.press('1');assert.deepEqual((await store.read()).skillIcons,[]);
  await page.locator('#new-block').click();await page.keyboard.type('ttm');assert.equal(await requests(),0);await page.locator('#close-editor').click();
  console.log('PASS cursor marker add/change/delete, idempotence and input/dialog isolation');

  const run=fixture({currentScore:45678,clearedLines:92,skills:{dot:3,reroll:2},skillSpawnRemaining:2,
    board:[7,1,0,0,0,0],skillIcons:[{x:2,y:3,kind:'dot'}],skillIconOrder:['2,3'],manualTargets:[100123],quickInput:true,
    slots:blocks.slice(0,3).map((block,i)=>({...block,instanceId:`p${i}`,blockId:block.id,used:false})),
    statistics:{entries:[{blockId:'b0',name:'ㄱ',normal:17,reroll:2}]}});
  await load(run);const before=await store.read();
  state=await persist(()=>page.locator('#reset-game').click());
  for(const key of ['blocks','statistics','manualTargets','quickInput','targetEnabled'])assert.deepEqual(state[key],before[key]);
  assert.equal(state.currentScore,0);assert.equal(state.clearedLines,0);assert.equal(state.skillSpawnRemaining,7);
  assert.deepEqual(state.skills,{dot:0,reroll:0});assert.deepEqual(state.slots,[null,null,null]);assert.deepEqual(state.skillIcons,[]);assert.deepEqual(state.skillIconOrder,[]);assert.ok(state.board.every(row=>row===0));
  assert.equal(await page.locator('.recommendation-chip').count(),0);
  await persist(()=>page.locator('#undo').click());assert.deepEqual(await store.read(),before);
  console.log('PASS whole-game reset and atomic undo preserve library and statistics');

  await load({currentScore:12344});await page.locator('.target-list-details summary').click();
  for(const score of ['12345','500000','12345']){
    await page.locator('#manual-target').fill(score);
    if(score==='12345'&&(await store.read()).manualTargets.length)await page.locator('#manual-target').press('Enter');
    else await persist(()=>page.locator('#manual-target').press('Enter'));
  }
  assert.deepEqual((await store.read()).manualTargets,[12345,500000]);
  await persist(()=>page.locator('#target-enabled').uncheck());assert.equal(await page.locator('#target-list').textContent(),'12,345 · 500,000');
  await page.locator('#manual-target').fill('500001');await page.locator('#manual-target').press('Enter');assert.equal(await page.locator('#manual-target').getAttribute('aria-invalid'),'true');
  await page.locator('.target-list-details summary').click();
  await search.fill('rrr');await search.press('Enter');await search.press('Enter');
  await page.locator('#finish-target').waitFor();await saved();
  assert.equal(await page.evaluate(()=>window.searchInputs.at(-1).targetEnabled),false);
  assert.deepEqual(await page.evaluate(()=>window.searchInputs.at(-1).manualTargets),[12345,500000]);
  state=await persist(()=>page.locator('#finish-target').click());assert.equal(state.currentScore,12345);
  await page.reload();await saved();await page.locator('.target-list-details summary').click();
  assert.equal(await page.locator('#manual-targets button').count(),2);
  await persist(()=>page.locator('#target-enabled').check());assert.match(await page.locator('#target-list').textContent(),/100,000/);
  await persist(()=>page.locator('#manual-targets button').first().click());assert.deepEqual((await store.read()).manualTargets,[500000]);
  await page.locator('#language').selectOption('en');assert.equal(await page.locator('#reset-game').textContent(),'Reset game');
  assert.match(await page.locator('.target-settings-panel').innerText(),/Custom targets/);
  for(const width of [1440,768,375,320]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`target settings overflow at ${width}`);
    const rect=await page.locator('.target-settings-panel').boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1);
  }
  await page.setViewportSize({width:1440,height:1080});await mkdir('test-results',{recursive:true});
  await page.waitForTimeout(800);
  await page.screenshot({path:'test-results/keyboard-targets.png'});
  assert.deepEqual(errors,[]);console.log('PASS multiple custom targets, combined goals, real solver/confirmation, bilingual responsive controls');
}finally{await browser?.close();await rm(dir,{recursive:true,force:true});}
