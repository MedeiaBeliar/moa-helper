import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-studio-ui-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser;
try{
  const state=initialState(),blocks=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8'));
  state.blocks=blocks.map((b,i)=>({...b,id:`b${i}`}));state.skills={dot:2,reroll:3};state.currentScore=120080;state.clearedLines=42;state.board=[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0];state.statistics={entries:state.blocks.map((b,i)=>({blockId:b.id,name:b.name,normal:(21-i)*3,reroll:i%4}))};await store.write(state);
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      try{const body=route.request().method()==='PUT'?await store.write(route.request().postDataJSON()):await store.read();return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});}
      catch(error){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
    }
    const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));
    const mime={'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};
    try{return route.fulfill({contentType:mime[path.extname(file)],body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const saved=()=>page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.goto(base);await saved();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.title(),'모아모아 도우미');
  assert.ok(await page.evaluate(()=>document.fonts.check('700 16px Pretendard')));
  assert.match(await page.locator('.project-notice').textContent(),/2026년 10월 14일 오후 11시 59분/);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/studio-empty.png'});
  // A selection starts a bounded canvas flight and persists immediately.
  await page.getByRole('button',{name:'ㅋ 선택',exact:true}).click();
  assert.equal(await page.locator('.tray-slot.occupied').count(),1);
  assert.ok(await page.locator('.flying-piece').count()>0);
  await page.waitForTimeout(600);assert.equal(await page.locator('.flying-piece').count(),0);
  const countsBeforeMerge=(await store.read()).statistics.entries.reduce((n,e)=>n+e.normal+e.reroll,0);
  await page.locator('#merge-blocks').click();await saved();
  assert.equal((await store.read()).blocks.length,19);
  assert.equal((await store.read()).statistics.entries.reduce((n,e)=>n+e.normal+e.reroll,0),countsBeforeMerge);
  await page.locator('#search-blocks').fill('ㅋㅁㅋ');await page.locator('#search-blocks').press('Enter');
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();await saved();
  await page.waitForTimeout(550);
  await page.screenshot({path:'test-results/studio-desktop.png'});
  const snapshot=await store.read();
  await page.locator('#play-plan').click();
  await page.waitForFunction(()=>document.querySelector('#play-plan').getAttribute('aria-pressed')==='false');
  assert.deepEqual(await store.read(),snapshot,'playback is presentation only');
  await page.locator('#plan-scrubber').fill('1');await page.locator('#plan-scrubber').dispatchEvent('input');
  assert.equal(await page.locator('#playback-step').textContent(),`1 / ${await page.locator('.move-button').count()}`);
  await page.locator('#show-all').click();
  await page.locator('#focus-board').click();assert.equal(await page.locator('.library').isVisible(),false);
  await page.waitForTimeout(500);await page.screenshot({path:'test-results/studio-focus.png'});
  const chips=await page.locator('.recommendation-chip').count();
  await page.keyboard.press('Escape');assert.equal(await page.locator('.library').isVisible(),true);
  assert.equal(await page.locator('.recommendation-chip').count(),chips,'Escape exits focus without discarding the plan overlay');
  await page.keyboard.press('Control+k');await page.locator('#command-dialog').waitFor();
  await page.getByRole('button',{name:'블록 이름 입력',exact:false}).click();assert.equal(await page.locator('#search-blocks').evaluate(n=>n===document.activeElement),true);
  for(const [width,height]of [[1920,1080],[1366,768],[1024,768],[768,1000],[375,900],[320,900]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(120);
    const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1&&getComputedStyle(n).position!=='fixed').slice(0,8).map(n=>[n.id,n.className,n.getBoundingClientRect().right]));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),JSON.stringify({width,overflow}));
    if(width===1366)await page.screenshot({path:'test-results/studio-laptop.png'});
    if(width===375)await page.screenshot({path:'test-results/studio-mobile.png',fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#open-statistics').click();await page.waitForTimeout(550);
  assert.equal(await page.locator('.statistics-bar').count(),19);
  await page.locator('.draw-statistics').screenshot({path:'test-results/studio-statistics.png'});
  await page.locator('.statistics-bar').first().click();assert.equal(await page.locator('#statistics-rows tr').count(),1);
  await page.locator('#statistics-search').fill('');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#complete-plan').click();await saved();
  assert.equal(await page.locator('#motion-layer').evaluate(n=>n.childElementCount),0);
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  // A fresh player can load the complete, deduplicated example set in one action.
  await store.write(initialState());await page.reload();await saved();
  await page.locator('#add-examples').click();
  await page.waitForFunction(()=>document.querySelectorAll('.block-card').length===19);await saved();
  assert.equal((await store.read()).blocks.length,19);
  assert.deepEqual((await store.read()).statistics.entries,[]);
  // The editor also rejects a rotation of an existing example.
  await page.locator('#new-block').click();await page.locator('#block-name').fill('중복');
  for(let y=0;y<3;y++)await page.locator(`.dot-cell[data-x="0"][data-y="${y}"]`).click();
  await page.locator('#save-block').click();assert.match(await page.locator('#editor-error').textContent(),/회전·반전으로 같은 모양/);
  await page.locator('#close-editor').click();
  assert.deepEqual(errors,[]);
  console.log('PASS studio: Pretendard, selection flights, replay/scrub without mutation, focus, command keyboard, responsive layout, statistics chart, reduced motion, completion, duplicate merge and all 19 examples; no server');
}finally{await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
