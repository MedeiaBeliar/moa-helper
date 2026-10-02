import {createRequire} from 'node:module';
import {mkdtemp,rm,readFile,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
import {fixtures,catalogue} from './speed-fixtures.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-speed-browser-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser,puts=0;
const results=[];
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      if(route.request().method()==='PUT')puts++;
      const value=route.request().method()==='PUT'?await store.write(route.request().postDataJSON()):await store.read();
      return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
    }
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    try{const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));return route.fulfill({contentType:types[path.extname(file)]||'application/octet-stream',body:await readFile(file)});}
    catch{return route.fulfill({status:404,body:'Not found'});}
  });
  const saved=()=>page.getByText('파일에 저장됨',{exact:true}).waitFor();
  async function load(fixture){
    const state=initialState();Object.assign(state,{blocks:catalogue,board:fixture.board,skills:fixture.skills,
      slots:fixture.batch.map((i,index)=>({instanceId:`p${index}`,blockId:catalogue[i].id,name:catalogue[i].name,cells:catalogue[i].cells,used:false}))});
    await store.write(state);await page.goto(base);await saved();
  }
  // Measure inside the renderer, from click through worker startup/module loads
  // and rendering, to the next animation frame with a usable recommendation.
  const measure=()=>page.evaluate(()=>new Promise((resolve,reject)=>{
    let started,finished=false;
    const observer=new MutationObserver(()=>{
      if(finished||document.querySelector('#solve').disabled)return;
      const hasPlan=!document.querySelector('#complete-plan').hidden||!document.querySelector('#reroll-panel').hidden;
      if(!hasPlan)return;
      finished=true;observer.disconnect();clearTimeout(timeout);
      requestAnimationFrame(()=>resolve(performance.now()-started));
    });
    const timeout=setTimeout(()=>{observer.disconnect();reject(new Error(document.querySelector('#message').textContent));},12000);
    observer.observe(document.querySelector('main'),{subtree:true,attributes:true,childList:true});
    started=performance.now();document.querySelector('#solve').click();
  }));
  for(const fixture of fixtures){
    await load(fixture);const elapsed=await measure();assert.ok(elapsed<1000,`${fixture.name}: ${elapsed}ms`);
    if(fixture.name!=='seven-rerolls')assert.equal(await page.locator('#complete-plan').isDisabled(),false);
    results.push({name:fixture.name,profile:'fast',clickToPaintMs:Math.round(elapsed)});await saved();
  }
  for(const id of ['solver-profile','search-time','solve-deep','look-ahead','safety-first'])assert.equal(await page.locator(`#${id}`).count(),0);
  assert.equal((await store.read()).options.solverProfile,'fast');
  assert.equal((await store.read()).options.timeLimit,850);
  // Deliberately hung worker sends a complete incumbent, then a worse partial.
  // The 950ms watchdog must retain the complete result and terminate the worker.
  const dot={name:'watchdog',board:Array(16).fill(0),batch:[3,3,3],skills:{dot:0,reroll:0}};
  assert.equal(catalogue[3].cells.length,1);await load(dot);
  await page.evaluate(()=>{
    window.RealWorker=window.Worker;window.stopped=false;
    window.Worker=class{
      postMessage({id,input}){
        let board=input.board.slice();const moves=input.pieces.map((p,i)=>{const before=board;board=board.slice();board[0]|=1<<i;return {kind:'piece',pieceId:p.id,cells:[[0,0]],x:i,y:0,rotation:0,reflected:false,width:1,height:1,cleared:[],score:1,placementScore:1,lineScore:0,boardBefore:before,boardAfter:board};});
        const complete={moves,lines:0,score:3,placementScore:3,lineScore:0,depth:3,complete:true,remaining:0,skillsUsed:{dot:0,reroll:0},reroll:null,duration:5,nodes:3,pruned:false};
        setTimeout(()=>this.onmessage({data:{id,progress:true,result:complete}}),5);
        setTimeout(()=>this.onmessage({data:{id,progress:true,result:{...complete,moves:moves.slice(0,1),complete:false,depth:1,remaining:2}}}),20);
      }
      terminate(){window.stopped=true;}
    };
  });
  const watchdogMs=await measure();assert.ok(watchdogMs>=940&&watchdogMs<1000,`watchdog ${watchdogMs}`);
  assert.equal(await page.evaluate(()=>window.stopped),true);assert.equal(await page.locator('.move-button').count(),3);
  await page.locator('#complete-plan').click();await saved();assert.equal((await store.read()).slots.every(s=>s===null),true);
  await page.evaluate(()=>{window.Worker=window.RealWorker;});results.push({name:'hung-worker',profile:'fast',clickToPaintMs:Math.round(watchdogMs)});
  // A running old server must not undo the fixed solver migration or discard
  // statistics. Keep a recoverable draft until the server is restarted.
  const old=await store.read();Object.assign(old.options,{solverProfile:'original',timeLimit:8000,strategyVersion:2,lookAhead:false,beamWidth:240});
  await page.route('**/api/state',route=>route.request().method()==='GET'?route.fulfill({contentType:'application/json',body:JSON.stringify(old)}):route.fallback());
  await page.reload();await page.locator('#stage-server-warning').waitFor();const before=puts;
  await page.locator('.settings summary').click();await page.locator('#rotate').uncheck();
  await page.getByText('저장 실패 · 임시 보관 중',{exact:true}).waitFor();assert.equal(puts,before);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('moa-manual-unsaved-v1')).options.solverProfile),'fast');
  await page.unroute('**/api/state');await page.reload();await saved();
  const restored=await store.read();assert.deepEqual(restored.options,{solverProfile:'fast',rotate:false,reflect:true,gravity:false,timeLimit:850,strategyVersion:3});
  assert.deepEqual(restored.board,old.board);assert.deepEqual(restored.blocks,old.blocks);assert.deepEqual(restored.statistics,old.statistics);
  assert.deepEqual(errors,[]);await mkdir('test-results',{recursive:true});
  await writeFile('test-results/speed-browser.json',JSON.stringify({createdAt:new Date().toISOString(),results},null,2));
  console.log(JSON.stringify({passed:true,results}));
}finally{await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
