import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-clipboard-ui-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser;
try{
  const state=initialState(),blocks=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8'));
  state.blocks=blocks.map((b,i)=>({...b,id:`b${i}`}));await store.write(state);
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
  // Browser-native paste payloads, with no access to the user's OS clipboard.
  const paste=async(kind='image',selector='body')=>page.evaluate(async({kind,selector})=>{
    const data=new DataTransfer();
    if(kind==='text')data.setData('text/plain','ㅅㅅㅡ');
    else if(kind==='url')data.setData('text/plain','https://example.com/game.png');
    else {
      let blob;
      if(kind==='broken')blob=new Blob(['not an image'],{type:'image/png'});
      else if(kind==='blank'){
        const canvas=document.createElement('canvas');canvas.width=32;canvas.height=24;
        canvas.getContext('2d').fillRect(0,0,32,24);blob=await new Promise(resolve=>canvas.toBlob(resolve));
      }else blob=await (await fetch('/sample-game.png')).blob();
      data.items.add(new File([blob],'clipboard.png',{type:'image/png'}));
    }
    const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true});
    document.querySelector(selector).dispatchEvent(event);return event.defaultPrevented;
  },{kind,selector});
  const settled=async()=>{
    try{await page.waitForFunction(()=>/추천을 색(?:으로|과 번호로) 표시했습니다/.test(document.querySelector('#capture-status').textContent)&&!document.querySelector('#complete-plan').disabled);}
    catch(error){console.error(await page.evaluate(()=>({message:document.querySelector('#message').textContent,capture:document.querySelector('#capture-status').textContent,solveDisabled:document.querySelector('#solve').disabled,completeDisabled:document.querySelector('#complete-plan').disabled,moves:document.querySelectorAll('.move-button').length})));throw error;}
  };
  const ready=()=>page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('이미지가 준비됐습니다'));
  const recognizePasted=async()=>{await ready();await page.locator('#capture-read').click();await settled();};
  const renderedState=()=>page.evaluate(()=>({board:[...document.querySelectorAll('.board-cell.filled')].map(c=>`${c.dataset.x},${c.dataset.y}`),tray:[...document.querySelectorAll('.tray-slot strong')].map(n=>n.textContent),stats:document.querySelector('#statistics-total').textContent}));

  assert.equal(await paste(),false);assert.equal(await page.locator('#capture-source').textContent(),'공유 대기');
  await page.locator('#tab-capture').click();
  assert.equal(await paste(),true);await ready();
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  assert.equal(await page.locator('#complete-plan').isVisible(),false);
  await page.locator('#capture-read').click();await settled();
  assert.equal(await page.locator('#capture-source').textContent(),'클립보드 이미지');
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅋ','ㅁ','ㅋ']);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  const observed=await renderedState();assert.equal(observed.board.length,18);
  assert.equal(await paste(),true);await recognizePasted();assert.deepEqual(await renderedState(),observed);
  assert.equal(await paste('text','#statistics-search'),false);assert.equal(await paste('url'),false);
  const frame=await page.locator('#capture-canvas').evaluate(c=>c.toDataURL());
  assert.equal(await paste('broken'),true);await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('읽지 못했습니다'));
  assert.deepEqual(await renderedState(),observed);assert.equal(await page.locator('#capture-canvas').evaluate(c=>c.toDataURL()),frame);
  await page.locator('#new-block').click();assert.equal(await paste(),false);await page.locator('#close-editor').click();
  await paste('blank');await ready();await page.locator('#capture-read').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('보드를 찾지 못했습니다'));
  assert.deepEqual(await renderedState(),observed);assert.equal(await page.locator('#capture-read').isEnabled(),true);
  await paste();await recognizePasted();

  // Decode completion order must not resurrect an older paste or a hidden tab.
  const deferDecodes=()=>page.evaluate(()=>{
    window.originalDecode=HTMLImageElement.prototype.decode;window.decodeJobs=[];
    HTMLImageElement.prototype.decode=function(){const actual=window.originalDecode.call(this);return new Promise((resolve,reject)=>{actual.then(()=>window.decodeJobs.push(resolve),reject);});};
  });
  await deferDecodes();await paste('blank');await page.waitForFunction(()=>window.decodeJobs.length===1);
  await paste();await page.waitForFunction(()=>window.decodeJobs.length===2);
  await page.evaluate(()=>window.decodeJobs[1]());await recognizePasted();
  await page.evaluate(async()=>{window.decodeJobs[0]();await new Promise(resolve=>setTimeout(resolve,0));HTMLImageElement.prototype.decode=window.originalDecode;});
  assert.equal(await page.locator('#capture-canvas').evaluate(c=>c.width),432);assert.deepEqual(await renderedState(),observed);
  await deferDecodes();await paste('blank');await page.waitForFunction(()=>window.decodeJobs.length===1);
  await page.locator('#tab-manual').click();
  await page.evaluate(async()=>{window.decodeJobs[0]();await new Promise(resolve=>setTimeout(resolve,0));HTMLImageElement.prototype.decode=window.originalDecode;});
  assert.equal(await page.locator('#capture-canvas').evaluate(c=>c.width),432);assert.deepEqual(await renderedState(),observed);
  await page.locator('#tab-capture').click();

  // A valid paste replaces a live stream. A corrupt one leaves it running.
  await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{
    const image=new Image();image.src='/sample-game.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').drawImage(image,0,0);
    window.testSource=canvas;window.testStream=canvas.captureStream(6);return window.testStream;
  }}));
  await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('실시간 미리보기'));
  await page.locator('#capture-read').click();await settled();
  assert.equal(await page.locator('#capture-source').textContent(),'화면 공유 중');
  await paste('broken');await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('읽지 못했습니다'));
  assert.equal(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='live')),true);
  await paste();await recognizePasted();assert.equal(await page.evaluate(()=>window.testStream.getTracks().every(t=>t.readyState==='ended')),true);
  assert.equal(await page.locator('#capture-stop').isDisabled(),true);assert.deepEqual(await renderedState(),observed);
  await mkdir('test-results',{recursive:true});await page.locator('#capture-panel').screenshot({path:'test-results/clipboard.png'});
  for(const width of [320,375,768]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  await page.setViewportSize({width:1440,height:1080});

  // Provisional state survives reload; completing it records once, undo restores it.
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.ok((await store.read()).slots.every(slot=>slot.capturePending&&!slot.drawRecorded));
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.deepEqual(await renderedState(),observed);
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.locator('#complete-plan').click();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await page.locator('#undo').click();assert.deepEqual(await renderedState(),observed);
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();await page.locator('#complete-plan').click();
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);

  // Pasting while a reroll is pending must not silently replace the batch,
  // classify the replacement as a normal draw, or spend the skill prematurely.
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const pending={...state,board:Array(16).fill(1023),skills:{dot:0,reroll:1},slots:state.blocks.slice(0,3).map((b,i)=>({instanceId:`r${i}`,blockId:b.id,name:b.name,cells:b.cells,used:false}))};
  await store.write(pending);await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.locator('#tab-capture').click();await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  const before=await renderedState(),title=await page.locator('#reroll-title').textContent();
  await paste();await ready();assert.deepEqual(await renderedState(),before);
  await page.locator('#capture-read').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('바꾸기 결과 이미지'));
  assert.deepEqual(await renderedState(),before);assert.equal(await page.locator('#reroll-title').textContent(),title);assert.equal(await page.locator('#skill-reroll').inputValue(),'1');
  await page.locator('#capture-locate').evaluate(button=>button.click());
  assert.equal(await page.locator('#reroll-title').textContent(),title);
  await page.locator('#capture-reroll').click();assert.match(await page.locator('#message').textContent(),/먼저 확인/);
  await page.locator('#capture-read').click();
  await page.evaluate(async()=>{const {ScreenCapture}=await import('/capture.js');ScreenCapture.prototype.readObservation=()=>{throw new Error('Reroll must use the last explicit read');};});
  await page.locator('#capture-reroll').click();assert.match(await page.locator('#message').textContent(),/먼저 추천된 배치/);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'1');assert.deepEqual(await renderedState(),before);
  // A recognized reroll remains provisional, survives persistence, and is counted
  // as a reroll only when placed. Applying it must not read the image again.
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await store.write({...state,skills:{dot:0,reroll:7}});await page.reload();
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.locator('#tab-capture').click();
  await paste();await ready();await page.locator('#capture-read').click();await page.locator('#reroll-panel').waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.evaluate(()=>Object.defineProperty(navigator.mediaDevices,'getDisplayMedia',{configurable:true,value:async()=>{throw new DOMException('cancel','NotAllowedError');}}));
  await page.locator('#capture-start').click();await page.waitForFunction(()=>document.querySelector('#capture-status').textContent.includes('취소됐습니다')||document.querySelector('#capture-status').textContent.includes('공유하지 못했습니다'));
  assert.equal(await page.locator('#reroll-panel').isVisible(),true);
  await page.locator('#capture-read').click();
  await page.evaluate(async()=>{const {ScreenCapture}=await import('/capture.js');ScreenCapture.prototype.readObservation=()=>{throw new Error('Reroll must use the last explicit read');};});
  await page.locator('#capture-reroll').click();await page.locator('#complete-plan').waitFor();
  assert.equal(await page.locator('#skill-reroll').inputValue(),'6');
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const rerolled=await store.read();assert.ok(rerolled.slots.some(s=>s.capturePending&&s.drawSource==='reroll'));
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();await page.locator('#complete-plan').click();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 2회 · 바꾸기 1회 · 합계 3회');
  assert.deepEqual(errors,[]);
  console.log('PASS clipboard: image paste/recognition/overlay, live stream replacement, corrupt image preservation, text/manual/modal guards, deferred statistics, completion/undo/reload, explicit reroll reads, decode races, reroll preservation and mobile layout; no server or OS clipboard access');
}finally{await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
