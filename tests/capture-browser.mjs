import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-capture-ui-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser;
try{
  const state=initialState(),blocks=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8'));
  state.blocks=blocks.map((b,i)=>({...b,id:`b${i}`}));state.skills={dot:0,reroll:1};await store.write(state);
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
  await page.goto(base);await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#tab-manual').getAttribute('aria-pressed'),'true');
  await page.locator('#tab-capture').click();await page.locator('#capture-sample').click();
  await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('이미지가 준비됐습니다'));
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  await page.locator('#capture-read').click();
  await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden&&!document.querySelector('#complete-plan').disabled);
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅋ','ㅁ','ㅋ']);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  assert.match(await page.locator('#capture-detection').textContent(),/1번 6칸 · 2번 8칸 · 3번 6칸/);
  assert.match(await page.locator('#search-meta').textContent(),/21종 공간 평가/);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.deepEqual((await store.read()).board,[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0]);
  const read=await store.read();assert.equal(read.blocks.length,21);assert.deepEqual(read.skills,{dot:0,reroll:1});
  // Preview buttons redraw the overlay even for a still frame, without a video timer.
  const overview=await page.locator('#capture-canvas').evaluate(c=>c.toDataURL());
  await page.locator('.move-button').nth(1).click();const single=await page.locator('#capture-canvas').evaluate(c=>c.toDataURL());assert.notEqual(overview,single);
  await page.locator('#show-all').click();assert.equal(await page.locator('#capture-canvas').evaluate(c=>c.toDataURL()),overview);
  // Drag calibration uses displayed coordinates scaled back to source pixels.
  await page.locator('.capture-calibration summary').click();await page.locator('[data-capture-region="board"]').click();
  const rect=await page.locator('#capture-canvas').boundingBox();
  await page.mouse.move(rect.x+17/432*rect.width,rect.y+136/618*rect.height);await page.mouse.down();
  await page.mouse.move(rect.x+278/432*rect.width,rect.y+553/618*rect.height,{steps:8});await page.mouse.up();
  assert.match(await page.locator('#capture-status').textContent(),/영역을 저장했습니다/);
  assert.equal(await page.locator('#complete-plan').isVisible(),false);
  await page.locator('#capture-read').click();
  await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden&&!document.querySelector('#complete-plan').disabled);
  const savedRegions=await page.evaluate(()=>JSON.parse(localStorage.getItem('moa-capture-regions-v1')));
  assert.ok(Math.abs(savedRegions.regions.board.x-17)<=1);assert.ok(Math.abs(savedRegions.regions.board.w-261)<=1);
  await page.locator('.capture-calibration summary').click();
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.querySelectorAll('.mode-menu button')].every(button=>Number(getComputedStyle(button).opacity)===1));
  await mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/capture-desktop.png',fullPage:true,animations:'disabled'});
  for(const width of [320,375,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`capture overflow ${width}`);}
  await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'test-results/capture-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  // Current and original user samples, at multiple scales. Browser-decoded pixels
  // exercise the actual detector; no server and no OS screen capture is needed.
  const images=await page.evaluate(async()=>{
    const {detectBoards,defaultSlots,recognize}=await import('/vision.js'),reports=[];
    for(const source of ['/sample-game.png','/sample.png'])for(const scale of [1,1.5]){
      const img=new Image();img.src=source;await img.decode();const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);const ctx=c.getContext('2d');ctx.drawImage(img,0,0,c.width,c.height);
      const pixels=ctx.getImageData(0,0,c.width,c.height),boards=detectBoards(pixels);
      reports.push({source,scale,boards:boards.map(board=>recognize(pixels,{board,slots:defaultSlots(board)}))});
    }return reports;
  });
  for(const report of images){assert.ok(report.boards.length,JSON.stringify(report));assert.equal(report.boards[0].safe,true,JSON.stringify(report));assert.deepEqual(report.boards[0].pieces.map(p=>p.cells.length),report.source==='/sample-game.png'?[6,8,6]:[8,8,10]);}
  // Both live sharing and pasted images use this renderer. Check actual canvas
  // text calls while keeping the three colored placement rectangles intact.
  const overlays=await page.evaluate(async()=>{
    const {ScreenCapture}=await import('/capture.js');
    const {place}=await import('/solver.js');
    const moves=[0,1,2].map(i=>({kind:'piece',pieceId:String(i),x:i,y:0,cells:[[0,0]],cleared:[]}));
    function draw(result,preview=-2){
      const frame=document.createElement('canvas'),canvas=document.createElement('canvas');frame.width=200;frame.height=200;
      const ctx=canvas.getContext('2d'),numbers=[],colors=new Set(),fillText=ctx.fillText,fillRect=ctx.fillRect;
      ctx.fillText=function(text,...args){if(/^\d+$/.test(text))numbers.push(text);return fillText.call(this,text,...args);};
      ctx.fillRect=function(...args){if(Math.abs(this.globalAlpha-.82)<.01)colors.add(this.fillStyle);return fillRect.call(this,...args);};
      ScreenCapture.prototype.draw.call({active:true,hasFrame:true,frame,canvas,accepted:true,
        calibration:{board:{x:0,y:0,w:120,h:120},slots:[0,1,2].map(i=>({x:130,y:i*50+20,w:30,h:30}))},
        callbacks:{getState:()=>({cols:4,rows:4}),getPlan:()=>({result,preview,stepColor:i=>`step-${i+1}`})}});
      return {numbers,colors:colors.size};
    }
    const free={complete:true,lines:0,moves};
    const ordered={...free,lines:1,moves:moves.map((move,i)=>i===2?{...move,cleared:[0]}:move)};
    function plan(board,placements){
      const moves=placements.map(([cells,x,y],i)=>{
        const next=place(board,4,cells,x,y),move={kind:'piece',pieceId:String(i),cells,x,y,cleared:next.cleared,boardBefore:board,boardAfter:next.board};
        board=next.board;return move;
      });return {complete:true,moves,lines:moves.reduce((sum,move)=>sum+move.cleared.length,0)};
    }
    const unit=[[0,0]],clearFree=plan([7,7,0,0],[[unit,3,0],[unit,3,1],[unit,0,2]]);
    const sensitive=plan([3,3,0,0],[[unit,2,0],[unit,2,1],[[[0,0],[0,1]],3,0]]);
    return {free:draw(free),single:draw(free,1),ordered:draw(ordered),clearFree:draw(clearFree),clearPreview:draw(clearFree,1),sensitive:draw(sensitive)};
  });
  assert.deepEqual(overlays.free,{numbers:[],colors:3});assert.deepEqual(overlays.single,{numbers:[],colors:1});
  assert.deepEqual(overlays.ordered,{numbers:['1','2','3'],colors:3});
  assert.deepEqual(overlays.clearFree,{numbers:[],colors:3});assert.deepEqual(overlays.clearPreview,{numbers:[],colors:1});
  assert.deepEqual(overlays.sensitive,{numbers:['1','2','3','3'],colors:3});
  // Native video keeps playing while snapshots and analysis occur only on click.
  await page.evaluate(async()=>{
    const {ScreenCapture}=await import('/capture.js'),copy=ScreenCapture.prototype.copyFrame,read=ScreenCapture.prototype.readObservation;
    window.captureCalls={copy:0,read:0};
    ScreenCapture.prototype.copyFrame=function(source){if(source instanceof HTMLVideoElement)window.captureCalls.copy++;return copy.call(this,source);};
    ScreenCapture.prototype.readObservation=function(){window.captureCalls.read++;return read.call(this);};
    Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
      const image=new Image();image.src='/sample-game.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      window.testSource=canvas;window.testStream=canvas.captureStream(30);
      window.sourceTimer=setInterval(()=>ctx.drawImage(image,0,0),40);return window.testStream;
    }});
  });
  const calls=()=>page.evaluate(()=>window.captureCalls);
  const pause=()=>page.waitForTimeout(1100);
  await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('실시간 미리보기'));
  assert.equal(await page.locator('#capture-video').isVisible(),true);
  assert.equal(await page.locator('#complete-plan').isVisible(),false);
  const initialTime=await page.locator('#capture-video').evaluate(video=>video.currentTime);
  await pause();assert.deepEqual(await calls(),{copy:0,read:0});
  assert.ok(await page.locator('#capture-video').evaluate((video,time)=>video.currentTime>time,initialTime));
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.locator('#capture-read').click();
  await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden&&!document.querySelector('#complete-plan').disabled);
  assert.deepEqual(await calls(),{copy:1,read:1});
  const held=await page.locator('#moves').textContent();await pause();
  assert.deepEqual(await calls(),{copy:1,read:1});assert.equal(await page.locator('#moves').textContent(),held);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  for(const width of [1440,768,375,320]){
    await page.setViewportSize({width,height:1080});
    const video=await page.locator('#capture-video').boundingBox(),overlay=await page.locator('#capture-canvas').boundingBox();
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(video[key]-overlay[key])<1,`video overlay ${width}: ${key}`);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#capture-panel').screenshot({path:'test-results/capture-live.png'});
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();const ids=(await store.read()).slots.map(s=>s.instanceId);
  await page.locator('#capture-read').click();
  await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden&&!document.querySelector('#complete-plan').disabled);
  assert.deepEqual(await calls(),{copy:2,read:2});
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.deepEqual((await store.read()).slots.map(s=>s.instanceId),ids);
  await page.locator('#complete-plan').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('다음 조각이 나오면 인식'));
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await pause();assert.deepEqual(await calls(),{copy:2,read:2});
  await page.evaluate(()=>clearInterval(window.sourceTimer));
  await page.locator('#tab-manual').click();assert.equal(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),true);
  await page.locator('#tab-capture').click();
  await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{throw new DOMException('cancel','NotAllowedError');}}));
  await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('취소됐습니다'));
  assert.equal(await page.locator('#capture-start').isEnabled(),true);assert.deepEqual(errors,[]);
  console.log('PASS capture: supplied images/scaling, 21-shape naming, shared overlay, click-only snapshots, uninterrupted native preview, deferred statistics, media lifecycle/cancel, mode switch, responsive layout; no server');
}finally{await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
