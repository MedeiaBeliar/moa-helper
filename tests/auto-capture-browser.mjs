import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-auto-capture-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser,writes=0;
try{
  const state=initialState();state.blocks=JSON.parse(await readFile(new URL('../examples/blocks.json',import.meta.url),'utf8')).blocks;
  state.targetEnabled=false;await store.write(state);
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      try{
        const body=route.request().method()==='PUT'?(writes++,await store.write(route.request().postDataJSON())):await store.read();
        return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
      }catch(error){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
    }
    const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));
    const mime={'.js':'text/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2'};
    try{return route.fulfill({contentType:mime[path.extname(file)],body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto(base);await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.locator('#tab-capture').click();
  assert.equal(await page.locator('#capture-auto').isChecked(),false);
  // Real video frames and the actual detector are used for the first hand.
  // Later observations model game transitions without manipulating OS windows.
  await page.evaluate(async()=>{
    const {ScreenCapture}=await import('/capture.js'),copy=ScreenCapture.prototype.copyFrame,read=ScreenCapture.prototype.readObservation;
    window.probe={copies:0,reads:0,applies:0,times:[]};
    ScreenCapture.prototype.copyFrame=function(source,...args){
      if(source instanceof HTMLVideoElement)window.probe.copies++;
      return copy.call(this,source,...args);
    };
    ScreenCapture.prototype.readObservation=function(){
      if(!window.captureHarness){
        window.captureHarness=this;
        const apply=this.callbacks.onRead;this.callbacks.onRead=(...args)=>{window.probe.applies++;return apply(...args);};
      }
      window.probe.reads++;window.probe.times.push(performance.now());
      if(window.pixelError)throw new Error('Temporary pixel failure');
      const observation=window.nextObservation?structuredClone(window.nextObservation):read.call(this);
      window.firstObservation??=structuredClone(observation);return observation;
    };
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      const image=new Image();image.src='/sample-game.png';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      window.testStream=canvas.captureStream(30);window.sourceCanvas=canvas;
      clearInterval(window.sourceTimer);window.sourceTimer=setInterval(()=>ctx.drawImage(image,0,0),40);
      return window.testStream;
    }});
  });
  const probe=()=>page.evaluate(()=>window.probe);
  const readMore=async(count=2)=>{const target=(await probe()).reads+count;await page.waitForFunction(target=>window.probe.reads>=target,target);};
  const settled=()=>page.waitForFunction(()=>window.captureHarness?.callbacks.getPlan().result?.complete&&!window.captureHarness.callbacks.getPlan().busy);
  const saved=()=>page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const total=async()=>page.evaluate(()=>window.captureHarness.callbacks.getState().statistics.entries.reduce((sum,e)=>sum+e.normal+e.reroll,0));
  const snapshot=()=>page.evaluate(()=>({state:window.captureHarness.callbacks.getState(),plan:window.captureHarness.callbacks.getPlan().result}));
  const noReads=async(action,label)=>{
    await action();const before=await probe();await page.waitForTimeout(1100);
    assert.equal((await probe()).reads,before.reads,label);
  };
  await page.locator('#capture-start').click();await page.waitForFunction(()=>!!document.querySelector('#capture-video').srcObject);
  await page.waitForTimeout(650);assert.equal((await probe()).reads,0,'default remains manual');
  await page.locator('#capture-auto').check();await readMore(3);await settled();await saved();
  const first=await snapshot(),firstWrites=writes,firstProbe=await probe();
  assert.equal(firstProbe.applies,1);assert.equal(await total(),0);
  assert.equal(first.state.slots.filter(s=>s.capturePending).length,3);
  assert.ok(firstProbe.times[2]-firstProbe.times[0]>=800&&firstProbe.times[2]-firstProbe.times[0]<1800,'two intervals are approximately one second');
  await readMore();assert.deepEqual(await snapshot(),first);assert.equal(writes,firstWrites,'duplicates do not persist or recalculate');
  assert.equal((await probe()).applies,1);
  const videoTime=await page.locator('#capture-video').evaluate(video=>video.currentTime);
  // A bad frame must not invalidate the plan; the next good frame clears its error.
  await page.evaluate(()=>{window.pixelError=true;});await readMore(1);
  assert.match(await page.locator('#capture-status').textContent(),/Temporary pixel failure/);
  assert.deepEqual(await snapshot(),first);
  await page.evaluate(()=>{window.pixelError=false;});await readMore(1);
  assert.equal(await page.locator('#capture-status').evaluate(node=>node.classList.contains('error')),false);
  assert.ok(await page.locator('#capture-video').evaluate((video,time)=>video.currentTime>time,videoTime),'preview continues while recognition runs');
  // Changed pixels while following the plan must not overwrite its starting board.
  await page.evaluate(()=>{
    const plan=window.captureHarness.callbacks.getPlan().result;
    const next=structuredClone(window.firstObservation);next.board=plan.moves.at(-1).boardAfter.slice();
    next.pieces=[0,1,2].map(id=>({id,status:'ready',confidence:1,cells:[[0,0]]}));
    next.signature=JSON.stringify([next.board,next.pieces]);window.nextObservation=next;
  });
  await readMore();assert.deepEqual(await snapshot(),first);assert.equal(await total(),0);
  // Leave the old game frame visible until completion. It must not be re-imported.
  const nextObservation=await page.evaluate(()=>window.nextObservation);
  await page.evaluate(()=>{window.nextObservation=structuredClone(window.firstObservation);});
  await page.locator('#complete-plan').click();await saved();await readMore();
  const committed=await snapshot();assert.equal(await total(),3);assert.equal((await probe()).applies,1);
  assert.ok(committed.state.slots.every(slot=>slot===null));assert.deepEqual(committed.state.board,nextObservation.board);
  await page.evaluate(next=>{window.nextObservation=next;},nextObservation);
  await readMore();await settled();await saved();
  assert.equal((await probe()).applies,2);assert.equal(await total(),3);
  assert.deepEqual((await snapshot()).state.board,nextObservation.board);
  // The stream stays open during pauses; only analysis is suspended.
  await noReads(()=>page.locator('.capture-calibration summary').click(),'calibration pauses recognition');
  assert.equal(await page.locator('#capture-auto-state').textContent(),'일시정지');
  await page.locator('.capture-calibration summary').click();await readMore(1);
  await noReads(()=>page.locator('#new-block').click(),'dialogs pause recognition');
  await page.locator('#close-editor').click();await readMore(1);
  await noReads(()=>page.locator('#open-statistics').click(),'statistics pauses recognition');
  assert.equal(await page.evaluate(()=>window.testStream.getTracks()[0].readyState),'live');
  await page.locator('#statistics-back').click();await readMore(1);
  // Turning it off is immediate; a manual read still works and re-arms confirmation.
  await noReads(()=>page.locator('#capture-auto').uncheck(),'off cancels the timer');
  await page.locator('#capture-read').click();await settled();await saved();
  assert.equal((await probe()).applies,3);assert.equal(await total(),3);
  await page.locator('#capture-auto').check();await readMore(1);
  // An explicit region reset releases the held plan; closing calibration reads
  // it again automatically, including an unchanged observation.
  await page.locator('.capture-calibration summary').click();await page.locator('#capture-locate').click();
  await page.locator('.capture-calibration summary').click();await readMore(2);await settled();await saved();
  assert.equal((await probe()).applies,4);assert.equal(await total(),3);
  await page.locator('#language').selectOption('en');
  assert.match(await page.locator('.capture-auto-control label').textContent(),/Auto recognition · 0.5s/);
  assert.equal(await page.locator('#capture-auto-state').textContent(),'Every 0.5s · awaiting completion');
  for(const width of [320,375,768,1440]){
    await page.setViewportSize({width,height:1080});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`auto controls fit at ${width}px`);
  }
  await mkdir('test-results',{recursive:true});await page.locator('#capture-panel').screenshot({path:'test-results/auto-capture.png'});
  await noReads(()=>page.locator('#capture-stop').click(),'stop sharing cancels the timer');
  assert.equal(await page.evaluate(()=>window.testStream.getTracks()[0].readyState),'ended');
  assert.equal(await page.locator('#capture-auto-state').textContent(),'Waiting for a live screen');
  await page.locator('#capture-start').click();await readMore();
  await noReads(()=>page.locator('#tab-manual').click(),'manual mode ends sharing and polling');
  assert.equal(await page.evaluate(()=>window.testStream.getTracks()[0].readyState),'ended');
  await page.locator('#tab-capture').click();await page.locator('#capture-start').click();await readMore();
  // Pasting stops the stream and leaves analysis to the button, even with auto enabled.
  await noReads(async()=>{
    await page.evaluate(async()=>{
      const data=new DataTransfer(),blob=await(await fetch('/sample-game.png')).blob();
      data.items.add(new File([blob],'pasted.png',{type:'image/png'}));
      document.body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    });
    await page.waitForFunction(()=>!document.querySelector('#capture-video').srcObject);
  },'pasted images are not polled');
  assert.equal(await page.evaluate(()=>window.testStream.getTracks()[0].readyState),'ended');
  await page.reload();await page.getByText('Saved to file',{exact:true}).waitFor();
  assert.equal(await page.locator('#capture-auto').isChecked(),true,'preference survives reload');
  assert.equal(await page.locator('#capture-auto-state').textContent(),'Waiting for a live screen');
  assert.deepEqual(errors,[]);
  console.log('PASS auto capture: 500 ms cadence, real video/detection, preserved plans, deferred statistics, completion/next-hand gating, duplicate suppression, pauses, errors, manual override, stop/paste/reload lifecycle and bilingual layouts; no server');
}finally{
  await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});
}
