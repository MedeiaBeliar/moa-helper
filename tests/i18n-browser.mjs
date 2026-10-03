import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createStore,initialState} from '../storage.mjs';

const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-i18n-ui-')),store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser,writes=0;
try{
  const state=initialState(),{blocks}=JSON.parse(await readFile(new URL('../examples/blocks.json',import.meta.url),'utf8'));
  state.blocks=blocks.map((block,i)=>({...block,id:`b${i}`}));
  state.skills={dot:2,reroll:3};state.currentScore=120080;state.clearedLines=42;
  state.board=[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0];
  state.statistics={entries:state.blocks.map((block,i)=>({blockId:block.id,name:block.name,normal:(21-i)*3,reroll:i%4}))};
  await store.write(state);
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const context=await browser.newContext({viewport:{width:1440,height:1080}}),errors=[];
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await context.route('**/*',async route=>{
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
  const page=await context.newPage(),saved=()=>page.getByText('Saved to file',{exact:true}).waitFor();
  await page.goto(base);await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.title(),'모아모아 도우미');
  const original=await store.read(),initialWrites=writes;
  await page.locator('#language').selectOption('en');
  assert.equal(await page.title(),'Moa Helper');
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.equal(await page.locator('#tab-manual').getAttribute('aria-label'),'Manual');
  assert.equal(await page.locator('#tab-capture').getAttribute('aria-label'),'Screen capture');
  assert.equal(await page.locator('#language').inputValue(),'en');
  await page.reload();await saved();
  assert.equal(await page.title(),'Moa Helper');assert.deepEqual(await store.read(),original);
  assert.equal(writes,initialWrites,'switching language and reloading do not save game state');
  await page.locator('#search-blocks').fill('ㅋㅁㅋ');await page.locator('#search-blocks').press('Enter');
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();await saved();
  const planned=await store.read(),plannedWrites=writes;
  const chips=await page.locator('.recommendation-chip').count();assert.ok(chips>0);
  await page.locator('#language').selectOption('ko');
  assert.match(await page.locator('#message').textContent(),/[가-힣]/);
  await page.locator('#language').selectOption('en');
  assert.equal(await page.locator('.recommendation-chip').count(),chips);
  assert.equal(await page.locator('.tray-slot.occupied').count(),3);
  assert.deepEqual(await store.read(),planned);assert.equal(writes,plannedWrites);
  await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(500);
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/i18n-desktop.png'});
  for(const [width,height]of [[1366,768],[1024,768],[768,1000],[375,900],[320,900]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(120);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`English layout overflow at ${width}px`);
    if(width===1366)await page.screenshot({path:'test-results/i18n-laptop.png'});
    if(width===375)await page.screenshot({path:'test-results/i18n-mobile.png',fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1080});
  await page.keyboard.press('Control+k');await page.locator('#command-dialog').waitFor();
  await page.getByRole('button',{name:'Search block names',exact:false}).click();
  assert.equal(await page.locator('#search-blocks').evaluate(node=>node===document.activeElement),true);
  await page.locator('#open-statistics').click();await page.waitForTimeout(500);
  await page.locator('.draw-statistics').screenshot({path:'test-results/i18n-statistics.png'});
  const count=page.locator('#statistics-rows input').first(),countBefore=await count.inputValue();
  await page.locator('#language').selectOption('ko');await page.locator('#language').selectOption('en');
  assert.equal(await count.inputValue(),countBefore);assert.deepEqual(await store.read(),planned);
  assert.equal(writes,plannedWrites,'translating statistics must not record or edit observations');
  const untranslated=await page.evaluate(()=>{
    const texts=[],walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const node=walker.currentNode,parent=node.parentElement;
      if(!parent||parent.closest('script,style,[translate="no"]')||!parent.checkVisibility())continue;
      if(/[가-힣]/.test(node.data)&&!node.data.includes('긔'))texts.push(node.data.trim());
    }
    return texts;
  });
  assert.deepEqual(untranslated,[],'English interface has no untranslated visible prose');
  await page.locator('#statistics-back').click();
  // The dialog retains unsaved names and dots while its labels and errors change.
  await page.locator('#new-block').click();await page.locator('#block-name').fill('점 찍기');
  for(let y=0;y<3;y++)await page.locator(`.dot-cell[data-x="0"][data-y="${y}"]`).click();
  await page.locator('#save-block').click();assert.match(await page.locator('#editor-error').textContent(),/rotation|reflection/);
  const editorState=await page.locator('.dot-cell.filled').count();
  await page.evaluate(async()=>{(await import('/i18n.js')).setLanguage('ko');});
  assert.match(await page.locator('#editor-error').textContent(),/회전·반전/);
  await page.evaluate(async()=>{(await import('/i18n.js')).setLanguage('en');});
  assert.equal(await page.locator('#block-name').inputValue(),'점 찍기');
  assert.equal(await page.locator('.dot-cell.filled').count(),editorState);
  assert.match(await page.locator('.dot-cell').first().getAttribute('aria-label'),/Row 1/);
  await page.locator('#close-editor').click();
  if(await page.evaluate(()=>!!window.documentPictureInPicture)){
    const popup=context.waitForEvent('page',{timeout:4000}).catch(()=>null);await page.locator('#pip').click();const pip=await popup;
    if(pip){
      await pip.locator('.pip-board').waitFor();assert.equal(await pip.locator('html').getAttribute('lang'),'en');
      assert.match(await pip.title(),/Moa Helper/);
      await page.locator('#language').selectOption('ko');assert.match(await pip.title(),/모아모아/);
      await page.locator('#language').selectOption('en');assert.match(await pip.title(),/Moa Helper/);await pip.close();
    }
  }
  // Local preferences also update an already open tab through the storage event.
  const second=await context.newPage();await second.goto(base);await second.getByText('Saved to file',{exact:true}).waitFor();
  await page.locator('#language').selectOption('ko');await second.waitForFunction(()=>document.documentElement.lang==='ko');
  await page.locator('#language').selectOption('en');await second.waitForFunction(()=>document.documentElement.lang==='en');await second.close();
  await page.locator('#tab-capture').click();
  await page.evaluate(async()=>{
    const {ScreenCapture}=await import('/capture.js'),copy=ScreenCapture.prototype.copyFrame,read=ScreenCapture.prototype.readObservation;
    window.captureCalls={copy:0,read:0};
    ScreenCapture.prototype.copyFrame=function(...args){window.captureCalls.copy++;return copy.apply(this,args);};
    ScreenCapture.prototype.readObservation=function(...args){window.captureCalls.read++;return read.apply(this,args);};
  });
  await page.locator('#capture-sample').click();await page.waitForFunction(()=>!document.querySelector('#capture-read').disabled);
  await page.locator('#capture-read').click();await page.locator('#complete-plan').waitFor();await saved();
  assert.match(await page.locator('#capture-detection').textContent(),/Grid confidence/);
  const recognized=await store.read(),calls=await page.evaluate(()=>window.captureCalls),recognizedWrites=writes;
  await page.locator('#language').selectOption('ko');await page.locator('#language').selectOption('en');
  assert.deepEqual(await page.evaluate(()=>window.captureCalls),calls,'language changes never copy or recognize a frame');
  assert.deepEqual(await store.read(),recognized);assert.equal(writes,recognizedWrites);
  for(const width of [1440,768,375,320]){
    await page.setViewportSize({width,height:1080});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`English capture overflow at ${width}px`);
  }
  await page.setViewportSize({width:1440,height:1080});await page.locator('#capture-panel').screenshot({path:'test-results/i18n-capture.png'});
  // Translate only generated names; a player may name a block after an interface label.
  const custom=initialState();custom.blocks=[{id:'custom',name:'점 찍기',cells:[[0,0]]}];
  custom.slots=[{instanceId:'one',blockId:'capture-0',name:'감지 1',cells:[[0,0],[1,0]],unidentified:true},
    {instanceId:'two',blockId:'custom',name:'점 찍기',cells:[[0,0]]},
    {instanceId:'three',blockId:'capture-used-2',name:'사용 완료',cells:[[0,0]],used:true}];
  custom.statistics={entries:[{blockId:null,name:'미분류 (화면 인식)',normal:10,reroll:2}]};
  await store.write(custom);await page.reload();await saved();
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['Detected 1','점 찍기','Used']);
  assert.equal(await page.locator('.block-content strong').textContent(),'점 찍기');
  await page.locator('#open-statistics').click();
  await page.locator('.statistics-bar').filter({hasText:'Unclassified'}).click();
  assert.equal(await page.locator('#statistics-rows tr').count(),1);
  assert.equal(await page.locator('#statistics-rows th').textContent(),'Unclassified (recognition)');
  const unclassified=page.locator('#statistics-rows input[data-source="normal"]');
  await unclassified.fill('11');await unclassified.press('Enter');await saved();
  assert.match(await page.locator('#message').textContent(),/Unclassified/);
  assert.equal((await store.read()).statistics.entries[0].name,'미분류 (화면 인식)');
  // An actual reroll still accepts Enter in English mode and spends exactly one skill.
  const reroll=initialState();reroll.blocks=state.blocks;reroll.skills={dot:0,reroll:7};
  const unit=reroll.blocks.find(block=>block.cells.length===1);
  reroll.slots=Array.from({length:3},(_,i)=>({instanceId:`r${i}`,blockId:unit.id,name:unit.name,cells:unit.cells}));
  await store.write(reroll);await page.locator('#tab-manual').click();await page.reload();await saved();
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  assert.match(await page.locator('#reroll-title').textContent(),/reroll piece/);
  await page.locator('#reroll-name').fill('.');await page.locator('#reroll-name').press('Enter');
  await page.locator('#complete-plan').waitFor();await saved();
  assert.equal((await store.read()).skills.reroll,6);
  assert.deepEqual(errors,[]);
  console.log('PASS localization: persistent Korean/English, cross-tab updates, unchanged plans and statistics, editor validation, PiP, click-only recognition, keyboard commands, responsive layout; no server');
}finally{await browser?.close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
