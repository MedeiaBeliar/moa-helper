import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
import {fixtures,catalogue,statistics} from './speed-fixtures.mjs';

// Serve requests directly from files and an isolated store. This opens no port
// and never reads or writes the player's data/state.json.
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-target-browser-')),store=createStore(dir);
const base='http://localhost:3210',publicDir=fileURLToPath(new URL('../public/',import.meta.url));
const block={id:'unit',name:'·',cells:[[0,0]]};
function fixture(extra={}){
  const state=initialState();
  return {...state,cols:4,rows:4,board:[1,0,0,0],blocks:[block],
    slots:Array.from({length:3},(_,i)=>({instanceId:`p${i}`,blockId:block.id,name:block.name,cells:block.cells,used:false})),...extra};
}
let browser;
const passed=[];
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.context().route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      const value=request.method()==='PUT'?await store.write(request.postDataJSON()):await store.read();
      return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    }
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    try{
      const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));
      return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await readFile(file)});
    }catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const saved=()=>page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const cell=(x,y)=>page.locator(`.board-cell[data-x="${x}"][data-y="${y}"]`);
  async function load(state){await store.write(state);await page.goto(base);await saved();}
  async function save(action){
    const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state'&&r.request().method()==='PUT');
    await action();await response;await saved();return store.read();
  }
  async function score(value){return save(async()=>{await page.locator('#current-score').fill(value);await page.locator('#current-score').press('Enter');});}
  async function solve(){
    await page.locator('#solve').click();
    await page.waitForFunction(()=>!document.querySelector('#solve').disabled&&
      (!document.querySelector('#complete-plan').hidden||!document.querySelector('#finish-target').hidden));
    await saved();
  }

  await load(fixture());
  const listedGoals=(await page.locator('#target-list').textContent()).split(' · ').map(score=>Number(score.replaceAll(',','')));
  assert.equal(listedGoals.length,16);assert.equal(listedGoals[0],100000);
  assert.ok(listedGoals.every(score=>score>=100000));
  assert.match(await page.locator('#target-status').textContent(),/100,000/);
  assert.equal((await score('111034')).currentScore,111034);
  assert.match(await page.locator('#target-status').textContent(),/111,111/);
  await save(()=>page.locator('#target-enabled').uncheck());
  await page.reload();await saved();
  assert.equal(await page.locator('#current-score').inputValue(),'111034');
  assert.equal(await page.locator('#target-enabled').isChecked(),false);
  assert.match(await page.locator('#target-status').textContent(),/고득점/);
  await save(()=>page.locator('#target-enabled').check());
  assert.equal((await score('')).currentScore,null);
  assert.equal(await page.locator('#score-plus-50').isDisabled(),true);
  await page.reload();await saved();assert.equal(await page.locator('#current-score').inputValue(),'');
  await score('499975');
  assert.equal((await save(()=>page.locator('#score-plus-50').click())).currentScore,500000);
  assert.equal(await page.locator('#score-plus-50').isDisabled(),true);
  passed.push('current score, unknown score, target preference and capped correction persist');

  await load(fixture());
  assert.equal(await page.locator('#skill-spawn-remaining').inputValue(),'7');
  await save(async()=>{await page.locator('#skill-spawn-remaining').fill('2');await page.locator('#skill-spawn-remaining').press('Enter');});
  await page.reload();await saved();assert.equal(await page.locator('#skill-spawn-remaining').inputValue(),'2');
  await page.locator('#skill-spawn-remaining').fill('8');await page.locator('#skill-spawn-remaining').press('Enter');
  assert.equal(await page.locator('#skill-spawn-remaining').getAttribute('aria-invalid'),'true');
  assert.equal((await store.read()).skillSpawnRemaining,2);
  await save(async()=>{await page.locator('#skill-spawn-remaining').fill('');await page.locator('#skill-spawn-remaining').press('Tab');});
  assert.equal((await store.read()).skillSpawnRemaining,null);
  await save(()=>page.locator('#undo').click());assert.equal(await page.locator('#skill-spawn-remaining').inputValue(),'2');
  passed.push('editable 1–7 spawn countdown validates, persists, accepts unknown and undoes');

  await load(fixture());
  await page.locator('#mode-icon-dot').click();
  let state=await save(()=>cell(0,0).click());
  assert.deepEqual(state.skillIcons,[{x:0,y:0,kind:'dot'}]);
  assert.deepEqual(state.board,[1,0,0,0]);assert.deepEqual(state.skills,{dot:0,reroll:0});
  assert.match(await cell(0,0).getAttribute('aria-label'),/점 찍기 능력 위치/);
  await page.locator('#mode-icon-reroll').click();
  state=await save(()=>cell(0,0).click());assert.deepEqual(state.skillIcons,[{x:0,y:0,kind:'reroll'}]);
  state=await save(()=>cell(0,0).click());assert.deepEqual(state.skillIcons,[]);
  await page.locator('#mode-icon-dot').click();await save(()=>cell(0,0).click());
  await page.locator('#mode-icon-reroll').click();await save(()=>cell(1,0).click());
  await save(()=>cell(2,1).click());
  await page.locator('#icon-entry').selectOption('new');
  await cell(3,1).click();assert.match(await page.locator('#message').textContent(),/직접 지운 뒤/);
  assert.deepEqual((await store.read()).skillIconOrder,[]);
  assert.match(await page.locator('#icon-order-status').textContent(),/3개 순서 모름/);
  await page.locator('#mode-icon-dot').click();await save(()=>cell(0,0).click());
  await page.locator('#mode-icon-reroll').click();state=await save(()=>cell(3,1).click());
  assert.deepEqual(state.skillIconOrder,['3,1']);
  assert.deepEqual(state.skillIcons,[{x:1,y:0,kind:'reroll'},{x:2,y:1,kind:'reroll'},{x:3,y:1,kind:'reroll'}]);
  assert.deepEqual(state.board,[1,0,0,0]);assert.equal(state.currentScore,0);assert.deepEqual(state.skills,{dot:0,reroll:0});
  await page.reload();await saved();assert.equal(await page.locator('.skill-marker').count(),3);
  assert.match(await page.locator('#icon-order-status').textContent(),/2개 순서 모름/);
  // A fully observed sequence can expire its oldest location after reloading.
  await load({...state,skillIconOrder:['1,0','2,1','3,1']});
  await page.locator('#icon-entry').selectOption('new');
  await page.locator('#mode-icon-dot').click();await save(()=>cell(1,0).click());
  const beforeExpiry=await store.read();state=await save(()=>cell(0,3).click());
  assert.deepEqual(state.skillIcons,[{x:2,y:1,kind:'reroll'},{x:3,y:1,kind:'reroll'},{x:0,y:3,kind:'dot'}]);
  state=await save(()=>page.locator('#undo').click());assert.deepEqual(state.skillIcons,beforeExpiry.skillIcons);
  const ordered=await store.read();state=await save(()=>page.locator('#forget-icon-order').click());assert.deepEqual(state.skillIconOrder,[]);
  state=await save(()=>page.locator('#undo').click());assert.deepEqual(state.skillIconOrder,ordered.skillIconOrder);
  const marked=await store.read();
  state=await save(()=>page.locator('#clear-icons').click());assert.deepEqual(state.skillIcons,[]);
  state=await save(()=>page.locator('#undo').click());assert.deepEqual(state.skillIcons,marked.skillIcons);
  assert.equal(state.currentScore,0);assert.deepEqual(state.skills,{dot:0,reroll:0});
  passed.push('unknown marker ages require manual removal; new observations track order, persist, auto-expire only known ages and undo');

  await load(fixture({board:[7,0,0,0],currentScore:100,skillIcons:[{x:0,y:0,kind:'dot'}],skillIconOrder:['0,0'],skillSpawnRemaining:1}));
  await page.locator('.tray-slot').first().getByRole('button',{name:'직접 배치',exact:true}).click();
  state=await save(()=>cell(3,0).click());
  assert.equal(state.currentScore,451);assert.equal(state.clearedLines,1);assert.equal(state.skillSpawnRemaining,7);assert.deepEqual(state.skillIconOrder,[]);
  assert.deepEqual(state.skillIcons,[]);assert.deepEqual(state.skills,{dot:1,reroll:0});
  assert.deepEqual(state.board,[0,0,0,0]);assert.equal(state.slots.filter(s=>s.used).length,1);
  state=await save(()=>page.locator('#undo').click());
  assert.equal(state.currentScore,100);assert.deepEqual(state.board,[7,0,0,0]);assert.equal(state.skillSpawnRemaining,1);assert.deepEqual(state.skillIconOrder,['0,0']);
  assert.deepEqual(state.skillIcons,[{x:0,y:0,kind:'dot'}]);assert.deepEqual(state.skills,{dot:0,reroll:0});
  assert.ok(state.slots.every(s=>!s.used));
  passed.push('manual row clear adds piece, clear and known acquisition points exactly once; undo restores all');

  await load(fixture({cols:2,rows:2,board:[1,0],currentScore:110760,skillIcons:[{x:0,y:0,kind:'reroll'}]}));
  await solve();
  assert.equal(await page.locator('#finish-target').isVisible(),true);
  assert.match(await page.locator('#finish-target').textContent(),/111,111/);
  assert.match(await page.locator('#recommend-summary').textContent(),/능력 획득 50점/);
  assert.equal(await page.locator('.move-button').count(),3);
  state=await save(()=>page.locator('#finish-target').click());
  assert.equal(state.currentScore,111111);assert.equal(state.clearedLines,1);
  assert.deepEqual(state.board,[0,0]);assert.deepEqual(state.skillIcons,[]);
  assert.deepEqual(state.skills,{dot:0,reroll:1});
  assert.equal(state.skillSpawnRemaining,6);
  assert.equal(state.slots.filter(s=>s.used).length,1);assert.equal(state.slots.filter(s=>!s.used).length,2);
  assert.match(await page.locator('#message').textContent(),/111,111점 목표까지 반영/);
  assert.equal(await page.locator('#finish-target').isVisible(),false);
  assert.equal(await page.locator('#solve').isDisabled(),false);
  await page.reload();await saved();assert.equal(await page.locator('#current-score').inputValue(),'111111');
  assert.equal((await store.read()).slots.filter(s=>s.used).length,1);
  await solve();state=await save(()=>page.locator('#complete-plan').click());
  assert.ok(state.currentScore>111111);assert.ok(state.slots.every(s=>s===null));
  assert.equal(state.skillSpawnRemaining,4);
  assert.deepEqual(state.skills,{dot:0,reroll:1});assert.deepEqual(state.skillIcons,[]);
  assert.equal(state.statistics.entries[0].normal,3,'continuation must not count the original draw twice');
  state=await save(()=>page.locator('#undo').click());
  assert.equal(state.currentScore,111111);assert.equal(state.slots.filter(s=>s.used).length,1);
  passed.push('actual solver hits a goal including +50 acquisition, preserves two pieces, then continues without duplicate counts');

  const pair={id:'pair',name:'ㅡ',cells:[[0,0],[1,0]]};
  await load(fixture({cols:10,rows:2,board:[0,0],currentScore:111110,skills:{dot:1,reroll:0},blocks:[pair],
    slots:Array.from({length:3},(_,i)=>({instanceId:`p${i}`,blockId:pair.id,name:pair.name,cells:pair.cells,used:false}))}));
  await solve();assert.equal(await page.locator('#finish-target').isVisible(),true);
  assert.match(await page.locator('.move-button').first().textContent(),/배치 \+1점/);
  assert.equal(await page.locator('.move-button').first().getAttribute('data-kind'),'dot');
  state=await save(()=>page.locator('#finish-target').click());
  assert.equal(state.currentScore,111111);assert.deepEqual(state.skills,{dot:0,reroll:0});
  assert.equal(state.skillSpawnRemaining,7,'a dot-only target prefix does not advance the spawn countdown');
  assert.equal(state.clearedLines,0);assert.ok(state.slots.every(s=>!s.used));
  state=await save(()=>page.locator('#undo').click());
  assert.equal(state.currentScore,111110);assert.deepEqual(state.skills,{dot:1,reroll:0});assert.deepEqual(state.board,[0,0]);
  await page.reload();await saved();assert.equal(await page.locator('#current-score').inputValue(),'111110');
  passed.push('a dot adds one point to hit an exact goal, leaves all three pieces, persists and undoes');

  await load(fixture({cols:5,rows:2,board:[0,0],currentScore:99999}));
  await solve();assert.equal(await page.locator('#recommend-title').textContent(),'추천 순서');
  assert.equal(await page.locator('.move-number').count(),3,'target prefix requires order numbers even without clears');
  state=await save(()=>page.locator('#finish-target').click());
  assert.equal(state.currentScore,100000);assert.equal(state.clearedLines,0);
  assert.equal(state.slots.filter(s=>s.used).length,1);
  state=await save(()=>page.locator('#undo').click());
  assert.equal(state.currentScore,99999);assert.deepEqual(state.board,[0,0]);
  assert.ok(state.slots.every(s=>!s.used));
  assert.doesNotMatch(await page.locator('#board-caption').textContent(),/목표 점수에 도달/);
  await save(()=>page.locator('#target-enabled').uncheck());await solve();
  assert.equal(await page.locator('#finish-target').isVisible(),false);
  assert.equal(await page.locator('#recommend-title').textContent(),'추천 배치');
  state=await save(()=>page.locator('#complete-plan').click());
  assert.equal(state.currentScore,100002);assert.ok(state.slots.every(s=>s===null));
  passed.push('100000 target stops at a prefix, undo restores it, and disabled goals use normal unordered completion');

  const timing=[];
  for(const [index,sample] of fixtures.slice(0,4).entries()){
    await load({...initialState(),blocks:catalogue,statistics,board:sample.board,skills:sample.skills,
      currentScore:[99999,110760,120000,120162][index],skillIcons:[{x:0,y:0,kind:'dot'},{x:2,y:2,kind:'reroll'}],
      slots:sample.batch.map((b,i)=>({instanceId:`p${i}`,blockId:catalogue[b].id,name:catalogue[b].name,cells:catalogue[b].cells,used:false}))});
    const elapsed=await page.evaluate(()=>new Promise((resolve,reject)=>{
      let start,finished=false;
      const observer=new MutationObserver(()=>{
        if(finished||document.querySelector('#solve').disabled)return;
        if(document.querySelector('#complete-plan').hidden&&document.querySelector('#finish-target').hidden&&document.querySelector('#reroll-panel').hidden)return;
        finished=true;observer.disconnect();clearTimeout(timeout);requestAnimationFrame(()=>resolve(performance.now()-start));
      });
      const timeout=setTimeout(()=>{observer.disconnect();reject(new Error(document.querySelector('#message').textContent));},5000);
      observer.observe(document.querySelector('main'),{subtree:true,attributes:true,childList:true});
      start=performance.now();document.querySelector('#solve').click();
    }));
    assert.ok(elapsed<1000,`${sample.name} with targets and icons: ${elapsed}ms`);
    timing.push({name:sample.name,clickToPaintMs:Math.round(elapsed)});await saved();
  }
  passed.push('21-block catalogue with near targets and known abilities returns within one second on four boards');
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/target-desktop.png',fullPage:true});
  await page.setViewportSize({width:320,height:780});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'320px layout must not overflow');
  await page.screenshot({path:'test-results/target-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  await writeFile('test-results/target-browser.json',JSON.stringify({createdAt:new Date().toISOString(),passed:true,checks:passed,timing},null,2));
  console.log(JSON.stringify({passed:true,checks:passed,timing},null,2));
}finally{
  await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));
  await rm(dir,{recursive:true,force:true});
}
