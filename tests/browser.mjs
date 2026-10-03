import { createRequire } from 'node:module';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createStore, initialState } from '../storage.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH||'playwright');
const dir=await mkdtemp(path.join(os.tmpdir(),'moa-browser-'));
// Serve fixtures through browser interception only. No HTTP server or listening port.
const store=createStore(dir),base='http://localhost:3210';
const publicDir=fileURLToPath(new URL('../public/',import.meta.url));
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined});
  const page=await browser.newPage({viewport:{width:1440,height:1080}}),errors=[];
  await page.context().route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==base)return route.abort();
    if(url.pathname==='/api/state'){
      try{
        const body=route.request().method()==='PUT'?await store.write(route.request().postDataJSON()):await store.read();
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      }catch(error){return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:error.message})});}
    }
    const file=path.join(publicDir,url.pathname==='/'?'index.html':url.pathname.slice(1));
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
    try{return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404,body:'Not found'});}
  });
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('.board-cell').count(),160);
  await page.locator('#new-block').click();await page.locator('#block-name').fill('테스트 ㄴ');
  for(const[x,y]of [[0,0],[0,1],[1,1]])await page.locator(`.dot-cell[data-x="${x}"][data-y="${y}"]`).click();
  assert.equal(await page.locator('#dot-count').textContent(),'3칸');await page.locator('#save-block').click();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.equal(await page.locator('.block-card').count(),1);
  for(let i=0;i<3;i++)await page.getByRole('button',{name:'테스트 ㄴ 선택',exact:true}).click();
  assert.equal(await page.locator('.tray-slot.occupied').count(),3);
  await page.locator('.board-cell[data-x="5"][data-y="5"]').click();assert.equal(await page.locator('.board-cell.filled').count(),1);
  await page.locator('#undo').click();assert.equal(await page.locator('.board-cell.filled').count(),0);
  await page.getByRole('button',{name:'직접 배치',exact:true}).first().click();await page.keyboard.press('r');await page.locator('.board-cell[data-x="0"][data-y="0"]').click();
  assert.equal(await page.locator('.board-cell.filled').count(),3);assert.equal(await page.locator('.tray-slot.used').count(),1);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  assert.equal(await page.getByRole('button',{name:'테스트 ㄴ 선택',exact:true}).isDisabled(),true);
  await page.locator('#undo').click();assert.equal(await page.locator('.tray-slot.used').count(),0);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.locator('#solve').click();await page.locator('.move-button').first().waitFor({timeout:15000});assert.equal(await page.locator('.move-button').count(),3);
  await page.locator('#solve').click();await page.locator('.move-button').first().waitFor({timeout:15000});
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  assert.equal(await page.locator('#statistics-rows tr').first().locator('td strong').first().innerText(),'100.0%');
  assert.equal(await page.locator('#statistics-rows tr').first().locator('input[data-source="normal"]').inputValue(),'3');
  assert.match(await page.locator('#board-caption').textContent(),/전체 추천/);
  assert.match(await page.locator('#board-caption').textContent(),/순서 상관없음/);
  assert.equal(await page.locator('.move-number').count(),0);assert.equal(await page.locator('.move-swatch').count(),3);
  assert.ok((await page.locator('.recommendation-chip').allTextContents()).every(text=>text===''));
  for(const step of [1,2,3])assert.ok(await page.locator(`.board-cell .recommendation-chip.step-${step}`).count()>0);
  const stepColors=await page.locator('.recommendation-chip').evaluateAll(nodes=>nodes.map(n=>getComputedStyle(n).backgroundColor));
  assert.equal(new Set(stepColors).size,3);
  await page.locator('.move-button').nth(1).click();assert.match(await page.locator('#board-caption').textContent(),/위치 미리보기 · 순서 상관없음/);
  assert.ok((await page.locator('.recommendation-chip').allTextContents()).every(text=>text===''));
  await page.locator('#show-all').click();assert.match(await page.locator('#board-caption').textContent(),/전체 추천/);
  await page.locator('#complete-plan').click();assert.equal(await page.locator('.tray-slot.occupied').count(),0);assert.equal(await page.locator('.board-cell.filled').count(),9);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.deepEqual((await store.read()).slots,[null,null,null]);
  await page.locator('#undo').click();assert.equal(await page.locator('.tray-slot.occupied').count(),3);assert.equal(await page.locator('.board-cell.filled').count(),0);
  await page.getByRole('button',{name:'직접 배치',exact:true}).first().click();await page.locator('.board-cell[data-x="0"][data-y="0"]').click();
  await page.locator('#solve').click();await page.locator('.board-cell[data-x="9"][data-y="15"]').click();
  await page.waitForFunction(()=>!document.querySelector('#solve').textContent.includes('탐색하고'));assert.equal(await page.locator('.move-button').count(),0);
  // A failed disk/API save must remain recoverable and must not claim success.
  await page.route('**/api/state',route=>route.request().method()==='PUT'?route.abort():route.continue());
  await page.locator('.board-cell[data-x="8"][data-y="15"]').click();await page.locator('#retry-save').waitFor();
  assert.match(await page.locator('#save-status').textContent(),/저장 실패/);
  assert.ok(await page.evaluate(()=>localStorage.getItem('moa-manual-unsaved-v1')));
  await page.unroute('**/api/state');await page.locator('#retry-save').click();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const before=await store.read();assert.equal(before.slots[0].used||before.slots[1].used||before.slots[2].used,true);
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.equal(await page.locator('.tray-slot.used').count(),1);
  assert.equal(await page.locator('.board-cell[data-x="8"][data-y="15"]').getAttribute('aria-pressed'),'true');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-blocks').click();const download=await downloadPromise;const backup=JSON.parse(await readFile(await download.path(),'utf8'));assert.equal(backup.blocks[0].name,'테스트 ㄴ');
  await page.locator('#import-blocks').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"blocks":[{"name":"bad","cells":[]}]}')});await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('올바르지'));assert.equal(await page.locator('.block-card').count(),1);
  // One completion also finishes a partly used batch and starts a fresh tray.
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor({state:'visible',timeout:15000});await page.locator('#complete-plan').click();assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  await page.locator('#new-block').click();await page.locator('#block-name').fill('가로 다섯');for(let x=0;x<5;x++)await page.locator(`.dot-cell[data-x="${x}"][data-y="0"]`).click();await page.locator('#save-block').click();
  await page.getByRole('button',{name:'테스트 ㄴ 선택',exact:true}).click();await page.getByRole('button',{name:'가로 다섯 선택',exact:true}).click();await page.getByRole('button',{name:'테스트 ㄴ 선택',exact:true}).click();await page.locator('#solve').click();await page.locator('.move-button').first().waitFor({timeout:15000});
  await mkdir('test-results',{recursive:true});
  await page.screenshot({path:'test-results/desktop.png',fullPage:true});
  for(const width of [320,375,414,768]){
    await page.setViewportSize({width,height:1000});
    const overflow=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,items:[...document.querySelectorAll('main button,header button,section,aside,input,select')].filter(n=>n.getBoundingClientRect().width&&n.getBoundingClientRect().right>innerWidth+1).map(n=>n.id||n.className)}));
    assert.ok(overflow.scroll<=overflow.client,JSON.stringify({width,overflow}));assert.deepEqual(overflow.items,[],`overflow at ${width}`);
  }
  await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'test-results/mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1080});
  if(await page.evaluate(()=>!!window.documentPictureInPicture)){
    const popupPromise=page.context().waitForEvent('page',{timeout:4000}).catch(()=>null);await page.locator('#pip').click();const pip=await popupPromise;
    if(pip){
      await pip.setViewportSize({width:370,height:700});await pip.locator('.pip-board').waitFor();await pip.waitForFunction(()=>getComputedStyle(document.querySelector('.pip-main')).padding==='16px');
      const unordered=(await page.locator('#board-caption').textContent()).includes('순서 상관없음');
      assert.equal((await pip.locator('.pip-legend').textContent()).includes('1.'),!unordered);
      await pip.evaluate(()=>{window.orderLabels=[];const fill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(this.canvas.className==='pip-board'&&/^\d+$/.test(text))window.orderLabels.push(text);return fill.call(this,text,...args);};});
      await page.locator('#show-all').click();assert.equal(await pip.evaluate(()=>window.orderLabels.length>0),!unordered);
      await pip.screenshot({path:'test-results/pip.png'});await pip.close();console.log('PASS document Picture-in-Picture');
    }
    else console.log('PiP unavailable in this headless browser; fallback notice checked.');
  }
  // Search-enter selects an entire batch, preserving duplicates as independent pieces.
  for(const[name,cells]of [['ㅅ',[[0,0]]],['ㅡ',[[0,0],[1,0]]],['ㄹ',[[0,0],[1,0],[1,1],[2,1]]],['ㅍ',[[0,0],[1,0],[0,1],[1,1]]],...['ㄱ','ㅇ','ㅣ'].map((name,i)=>[name,Array.from({length:[3,4,6][i]},(_,y)=>[0,y])])]){
    await page.locator('#new-block').click();await page.locator('#block-name').fill(name);
    for(const[x,y]of cells)await page.locator(`.dot-cell[data-x="${x}"][data-y="${y}"]`).click();
    await page.locator('#save-block').click();
  }
  const oldBoard=(await store.read()).board;
  await page.locator('#search-blocks').fill('ㅅㅅㅡ');await page.locator('#search-blocks').press('Enter');
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  assert.equal(await page.locator('#search-blocks').inputValue(),'');assert.equal(await page.locator('.move-button').count(),0);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();const quick=await store.read();
  assert.equal(new Set(quick.slots.map(slot=>slot.instanceId)).size,3);assert.deepEqual(quick.board,oldBoard);
  for(const [input,expected] of [['ttm',['ㅅ','ㅅ','ㅡ']],['ㄿㄱ',['ㄹ','ㅍ','ㄱ']],['fvr',['ㄹ','ㅍ','ㄱ']],['ㄳㅇ',['ㄱ','ㅅ','ㅇ']],['rtd',['ㄱ','ㅅ','ㅇ']],['긔',['ㄱ','ㅡ','ㅣ']],['rml',['ㄱ','ㅡ','ㅣ']]]){
    await page.locator('#search-blocks').fill(input);await page.locator('#search-blocks').press('Enter');
    assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),expected,input);
  }
  await page.locator('#search-blocks').fill('f');assert.ok((await page.locator('.block-content strong').allTextContents()).includes('ㄹ'));
  await page.locator('#search-blocks').fill('ttm');await page.locator('#search-blocks').press('Enter');
  await page.locator('#search-blocks').fill('ㅅㅎㅡ');await page.locator('#search-blocks').press('Enter');
  assert.match(await page.locator('#message').textContent(),/“ㅎ” 블록이 없습니다/);
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  await page.locator('#search-blocks').fill('ㅅㅡ');await page.locator('#search-blocks').press('Enter');assert.match(await page.locator('#message').textContent(),/이름 3개/);
  await page.locator('#search-blocks').fill('ㅡ ㅅ ㅅ');await page.locator('#search-blocks').press('Enter');
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅡ','ㅅ','ㅅ']);
  await page.locator('#undo').click();assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  // An IME Enter must wait for the final composition, then select exactly once.
  await page.locator('#search-blocks').focus();await page.locator('#search-blocks').dispatchEvent('compositionstart');await page.locator('#search-blocks').fill('ㅡㅡㅅ');
  await page.locator('#search-blocks').dispatchEvent('keydown',{key:'Enter',isComposing:true});
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  await page.locator('#search-blocks').dispatchEvent('compositionend');
  await page.waitForFunction(()=>document.querySelector('.tray-slot strong').textContent==='ㅡ');
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅡ','ㅡ','ㅅ']);
  await page.locator('#undo').click();assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  await page.getByRole('button',{name:'직접 배치',exact:true}).first().click();await page.locator('.board-cell[data-x="0"][data-y="14"]').click();
  await page.locator('#search-blocks').fill('ㅡㅡㅡ');await page.locator('#search-blocks').press('Enter');assert.match(await page.locator('#message').textContent(),/사용 중인 세트/);
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.deepEqual(await page.locator('.tray-slot strong').allTextContents(),['ㅅ','ㅅ','ㅡ']);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  // Skill fixtures still use this test's isolated disk store, never the user's save.
  async function seedSkills(board,cols,shapes,skills){
    const next=initialState();Object.assign(next,{board,cols,rows:board.length,skills});
    next.options.rotate=false;next.options.reflect=false;
    next.blocks=shapes.map((cells,i)=>({id:`skill-b${i}`,name:['ㅣ','ㅅ','ㅡ'][i],cells}));
    next.slots=next.blocks.map((block,i)=>({...block,blockId:block.id,instanceId:`skill-s${i}`,used:false}));
    await page.getByText('파일에 저장됨',{exact:true}).waitFor();await store.write(next);
    await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  }
  await seedSkills([0,0],3,[[[0,0],[0,1]],[[0,0]],[[0,0]]],{dot:0,reroll:0});
  await page.locator('#skill-dot').fill('2');await page.locator('#skill-dot').press('Tab');
  assert.equal(await page.locator('#skill-total').textContent(),'2 / 7개');
  await page.locator('#skill-reroll').fill('6');await page.locator('#skill-reroll').press('Tab');
  assert.match(await page.locator('#message').textContent(),/합쳐서 최대 7개/);assert.equal(await page.locator('#skill-reroll').inputValue(),'0');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#skill-dot').inputValue(),'2');
  await page.locator('#solve').click();await page.waitForFunction(()=>!document.querySelector('#solve').disabled);
  assert.match(await page.locator('#recommend-summary').textContent(),/1,206점/);
  assert.match(await page.locator('#recommend-summary').textContent(),/배치 6점 \+ 줄 제거 1,200점/);
  assert.equal(await page.locator('.move-button[data-kind="dot"]').count(),2);
  assert.ok((await page.locator('.move-button[data-kind="dot"]').allTextContents()).every(text=>text.includes('배치 +1점')));
  assert.equal(await page.locator('.move-button').count(),5);assert.equal(await page.locator('#skill-dot').inputValue(),'2');
  assert.equal(await page.locator('.move-number').count(),5);
  assert.ok((await page.locator('.recommendation-chip').allTextContents()).every(text=>/^\d+$/.test(text)));
  const comboColors=await page.locator('.recommendation-chip').evaluateAll(nodes=>[...new Set(nodes.map(n=>getComputedStyle(n).backgroundColor))]);assert.equal(comboColors.length,4);
  await page.locator('#complete-plan').click();assert.equal(await page.locator('#skill-dot').inputValue(),'0');
  assert.equal(await page.locator('#current-score').inputValue(),'1206');
  assert.equal(await page.locator('#skill-spawn-remaining').inputValue(),'4','only three pieces count; two dot skills do not');
  assert.equal(await page.locator('.tray-slot.occupied').count(),0);assert.equal(await page.locator('.board-cell.filled').count(),0);
  await page.locator('#undo').click();assert.equal(await page.locator('#skill-dot').inputValue(),'2');assert.equal(await page.locator('.tray-slot.occupied').count(),3);
  assert.equal(await page.locator('#current-score').inputValue(),'0');
  assert.equal(await page.locator('#skill-spawn-remaining').inputValue(),'7');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const line=Array.from({length:8},(_,x)=>[x,0]);
  await seedSkills([1,1],8,[line,line,line],{dot:7,reroll:0});
  await page.locator('#solve').click();await page.waitForFunction(()=>!document.querySelector('#solve').disabled);
  assert.equal(await page.locator('.move-button[data-kind="dot"]').count(),7);assert.equal(await page.locator('.move-button').count(),10);
  assert.ok(await page.locator('.recommendation-chip.step-10').count());
  await page.screenshot({path:'test-results/skills-desktop.png',fullPage:true});
  await page.locator('#complete-plan').click();assert.equal(await page.locator('#skill-dot').inputValue(),'0');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#skill-dot').inputValue(),'0');assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  // Seven is a real inventory value, but every completed recommendation must
  // leave a space. A forced reroll waits for the actual named result.
  await seedSkills([0,0],10,Array(3).fill([[0,0]]),{dot:1,reroll:6});
  await page.locator('#solve').click();await page.waitForFunction(()=>!document.querySelector('#solve').disabled);
  assert.match(await page.locator('#recommend-summary').textContent(),/최소 1개를 사용해 6개 이하/);
  assert.equal(await page.locator('.move-button[data-kind="dot"]').count(),1);
  assert.equal(await page.locator('.move-number').count(),4);
  assert.equal(await page.locator('#skill-total').textContent(),'7 / 7개');
  await page.locator('#complete-plan').click();assert.equal(await page.locator('#skill-total').textContent(),'6 / 7개');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#skill-total').textContent(),'6 / 7개');
  await seedSkills([0,0],10,Array(3).fill([[0,0]]),{dot:0,reroll:7});
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  assert.match(await page.locator('#message').textContent(),/7개 미만/);
  assert.match(await page.locator('#recommend-summary').textContent(),/먼저 다시 뽑기/);
  assert.equal(await page.locator('.move-button').count(),0);assert.equal(await page.locator('#complete-plan').isDisabled(),true);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'7');
  await page.locator('#reroll-name').fill('l');await page.locator('#reroll-name').press('Enter');
  await page.waitForFunction(()=>!document.querySelector('#solve').disabled&&!document.querySelector('#complete-plan').disabled);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'6');assert.equal(await page.locator('#reroll-panel').isVisible(),false);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 1회 · 합계 4회');
  await page.locator('#complete-plan').click();assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  assert.equal(await page.locator('#skill-total').textContent(),'6 / 7개');
  const big=Array.from({length:4},(_,x)=>[x,0]);
  await seedSkills([0,0],3,[big,[[0,0]],[[0,0]]],{dot:0,reroll:2});
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  assert.match(await page.locator('#reroll-title').textContent(),/1번 조각/);
  assert.equal(await page.locator('#apply-reroll').isDisabled(),true);assert.equal(await page.locator('#complete-plan').isDisabled(),true);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'2');
  assert.equal(await page.locator('.move-number').count(),await page.locator('.move-button').count());
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await page.locator('#reroll-name').fill('없는이름');await page.locator('#reroll-name').press('Enter');
  assert.match(await page.locator('#message').textContent(),/블록이 없습니다/);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'2');
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  // Same piece can come out again; only the committed reroll is charged.
  await page.locator('#reroll-result').selectOption('skill-b0');await page.locator('#apply-reroll').click();
  await page.locator('#reroll-panel').waitFor();assert.equal(await page.locator('#skill-reroll').inputValue(),'1');
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 1회 · 합계 4회');
  assert.equal(await page.locator('.tray-slot.used').count(),2);assert.equal(await page.locator('.move-button').count(),0);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.locator('#undo').click();
  assert.equal(await page.locator('#skill-reroll').inputValue(),'2');assert.equal(await page.locator('.tray-slot.used').count(),0);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  // Enter used to commit Hangul composition also applies exactly one reroll.
  await page.locator('#reroll-name').focus();
  await page.locator('#reroll-name').evaluate(input=>{
    input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='ㅣ';
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
    input.dispatchEvent(new CompositionEvent('compositionend',{data:'ㅣ',bubbles:true}));
    input.dispatchEvent(new InputEvent('input',{data:'ㅣ',bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelector('#skill-reroll').value==='1');await page.locator('#reroll-panel').waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 1회 · 합계 4회');
  assert.equal(await page.locator('#reroll-name').inputValue(),'');
  for(const width of [320,375,414,768]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`skill UI overflow ${width}`);
  }
  await page.setViewportSize({width:375,height:1000});await page.screenshot({path:'test-results/skills-mobile.png',fullPage:true});
  await page.locator('#reroll-name').fill(' t ');await page.locator('#reroll-name').press('Enter');
  await page.locator('#complete-plan').waitFor();await page.waitForFunction(()=>!document.querySelector('#complete-plan').disabled);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'0');assert.equal(await page.locator('#reroll-panel').isVisible(),false);
  await page.locator('#complete-plan').click();assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.equal((await store.read()).skills.reroll,0);
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 2회 · 합계 5회');
  assert.equal(await page.locator('#statistics-rows tr[data-block-id="skill-b0"] td[data-source="reroll"] strong').innerText(),'50.0%');
  // Manual cumulative totals, source sorting, filtering denominators and reload.
  const editStats=async(id,normal,reroll)=>{
    await page.locator('#open-statistics').click();
    const row=page.locator(`#statistics-rows tr[data-block-id="${id}"]`);
    await row.locator('input[data-source="normal"]').fill(String(normal));
    await row.locator('input[data-source="normal"]').press('Tab');
    assert.equal(await row.locator('input[data-source="reroll"]').evaluate(input=>input===document.activeElement),true);
    await row.locator('input[data-source="reroll"]').fill(String(reroll));await row.locator('input[data-source="reroll"]').press('Enter');
  };
  await editStats('skill-b0',10,2);await editStats('skill-b1',2,20);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 22회 · 합계 35회');
  assert.equal(await page.locator('#statistics-rows tr').first().getAttribute('data-block-id'),'skill-b1');
  await page.locator('#statistics-sort').selectOption('normal');
  assert.equal(await page.locator('#statistics-rows tr').first().getAttribute('data-block-id'),'skill-b0');
  await page.locator('#statistics-sort').selectOption('reroll');
  assert.equal(await page.locator('#statistics-rows tr').first().getAttribute('data-block-id'),'skill-b1');
  await page.locator('#statistics-search').fill('ㅣ');assert.equal(await page.locator('#statistics-rows tr').count(),1);
  assert.equal(await page.locator('#statistics-rows td strong').first().innerText(),'76.9%');
  assert.equal(await page.locator('#statistics-rows input[data-source="normal"]').inputValue(),'10');
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 22회 · 합계 35회');
  for(const bad of ['-1','1.5','']){
    const input=page.locator('#statistics-rows input[data-source="normal"]');await input.fill(bad);await input.press('Enter');
    assert.match(await page.locator('#message').textContent(),/0 이상의 정수/);
    await page.waitForFunction(()=>document.querySelector('#statistics-rows input[data-source="normal"]').value==='10');
    assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 22회 · 합계 35회');
  }
  await page.locator('#statistics-search').fill('없는이름');assert.equal(await page.locator('#statistics-no-match').isVisible(),true);
  await page.locator('#statistics-search').fill('');
  await page.locator('#statistics-undo').click();assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 3회 · 합계 16회');
  await editStats('skill-b1',2,20);
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 22회 · 합계 35회');
  for(const width of [320,375,768]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('#statistics-rows input')].every(input=>input.getBoundingClientRect().right<=innerWidth)),true);
  }
  await page.setViewportSize({width:1440,height:1080});await page.locator('#statistics-panel').screenshot({path:'test-results/statistics-manual.png'});
  // Reset covers hidden rows too, persists, and leaves game progress untouched.
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();const beforeReset=await store.read();
  await page.locator('#statistics-search').fill('ㅣ');await page.locator('#statistics-reset').click();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();const afterReset=await store.read();
  assert.deepEqual(afterReset.statistics,{entries:[]});
  for(const key of ['blocks','board','slots','skills','options'])assert.deepEqual(afterReset[key],beforeReset[key]);
  await page.locator('#statistics-undo').click();assert.equal(await page.locator('#statistics-total').textContent(),'일반 13회 · 바꾸기 22회 · 합계 35회');
  await page.locator('#statistics-reset').click();await page.getByText('파일에 저장됨',{exact:true}).waitFor();await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  await page.locator('#tab-manual').click();
  // Ambiguous names leave the pending reroll and its counters untouched.
  await seedSkills([0,0],3,[big,[[0,0]],[[0,0]]],{dot:0,reroll:2});
  const ambiguous=await store.read();ambiguous.blocks[2].name='ㅅ';await store.write(ambiguous);
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  await page.locator('#reroll-name').fill('t');await page.locator('#reroll-name').press('Enter');
  assert.match(await page.locator('#message').textContent(),/여러 개/);
  assert.equal(await page.locator('#skill-reroll').inputValue(),'2');
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  await page.setViewportSize({width:1440,height:1080});
  await page.locator('#open-statistics').click();await page.locator('#statistics-panel').screenshot({path:'test-results/statistics.png'});
  await page.locator('#statistics-reset').click();const heldMoves=await page.locator('#moves').textContent();await page.locator('#statistics-back').click();
  await page.locator('#solve').click();await page.locator('#reroll-panel').waitFor();
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 0회 · 바꾸기 0회 · 합계 0회');
  assert.equal(await page.locator('#moves').textContent(),heldMoves);
  // An old, still-running server and an unsaved browser draft may both contain
  // gravity:true. Correct the option without pretending to reconstruct the board.
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const legacy=initialState();Object.assign(legacy,{cols:4,rows:4,board:[1,7,4,0]});legacy.options.gravity=true;legacy.options.lookAhead=false;
  legacy.blocks=[{id:'dot',name:'.',cells:[[0,0]]}];legacy.slots=[0,1,2].map(i=>({instanceId:`g${i}`,blockId:'dot',name:'.',cells:[[0,0]],used:false}));
  await page.route('**/api/state',route=>route.request().method()==='GET'?route.fulfill({contentType:'application/json',body:JSON.stringify(legacy)}):route.fallback());
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.match(await page.locator('#message').textContent(),/설정을 바로잡았습니다/);assert.equal(await page.locator('#gravity').count(),0);
  assert.equal((await store.read()).options.gravity,false);assert.deepEqual((await store.read()).board,legacy.board);
  await page.unroute('**/api/state');
  await page.evaluate(s=>localStorage.setItem('moa-manual-unsaved-v1',JSON.stringify(s)),legacy);
  await page.reload();await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.equal((await store.read()).options.gravity,false);
  await page.getByRole('button',{name:'직접 배치',exact:true}).first().click();await page.locator('.board-cell[data-x="3"][data-y="1"]').click();
  await page.getByText('파일에 저장됨',{exact:true}).waitFor();assert.deepEqual((await store.read()).board,[1,0,4,0]);
  await page.locator('#solve').click();await page.waitForFunction(()=>!document.querySelector('#complete-plan').hidden&&!document.querySelector('#complete-plan').disabled);
  await page.locator('#complete-plan').click();
  assert.equal(await page.locator('.board-cell[data-x="0"][data-y="0"]').getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.board-cell[data-x="2"][data-y="2"]').getAttribute('aria-pressed'),'true');
  // A stalled worker must release the UI using its last replayable plan at the
  // hard wall-clock limit; progress messages alone must not end the search.
  await seedSkills([0,0],3,[big,[[0,0]],[[0,0]]],{dot:0,reroll:0});
  await page.locator('#solve').click();
  await page.getByRole('button',{name:'표시된 일부 배치 반영',exact:true}).waitFor();
  assert.match(await page.locator('#recommend-summary').textContent(),/사망 판정이 아닙니다/);
  await page.locator('#complete-plan').click();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  const partiallyApplied=await store.read();
  assert.equal(partiallyApplied.slots.filter(slot=>slot.used).length,2);
  assert.equal(partiallyApplied.slots.filter(slot=>!slot.used).length,1);
  assert.equal(await page.locator('#statistics-total').textContent(),'일반 3회 · 바꾸기 0회 · 합계 3회');
  assert.match(await page.locator('#message').textContent(),/남은 조각은 유지/);
  await seedSkills([0,0],10,Array(3).fill([[0,0]]),{dot:0,reroll:0});
  await page.evaluate(()=>{
    window.originalWorker=window.Worker;window.workerTerminated=false;
    window.Worker=class {
      postMessage({id,input}){
        let board=input.board.slice();const moves=input.pieces.map((p,i)=>{const before=board;board=board.slice();board[0]|=1<<i;return {kind:'piece',pieceId:p.id,cells:[[0,0]],x:i,y:0,rotation:0,reflected:false,width:1,height:1,cleared:[],score:1,placementScore:1,lineScore:0,boardBefore:before,boardAfter:board};});
        const result={moves,lines:0,score:3,placementScore:3,lineScore:0,depth:3,complete:true,remaining:0,skillsUsed:{dot:0,reroll:0},reroll:null,duration:5,nodes:3,pruned:false};
        setTimeout(()=>this.onmessage({data:{id,progress:true,result}}),5);
      }
      terminate(){window.workerTerminated=true;}
    };
  });
  const deadlineStart=Date.now();await page.locator('#solve').click();
  await page.getByText('생존 배치 확보 · 더 좋은 수 비교 중',{exact:true}).waitFor();
  assert.equal(await page.locator('#solve').isDisabled(),true);
  await page.waitForFunction(()=>!document.querySelector('#solve').disabled,{},{timeout:2000});
  assert.ok(Date.now()-deadlineStart<1500);assert.equal(await page.evaluate(()=>window.workerTerminated),true);
  assert.equal(await page.locator('#complete-plan').isDisabled(),false);
  assert.match(await page.locator('#search-meta').textContent(),/시간 한도 도달/);
  await page.locator('#complete-plan').click();assert.equal(await page.locator('.tray-slot.occupied').count(),0);
  await page.evaluate(()=>{window.Worker=window.originalWorker;});
  // Clearing rows is still order-free when every permutation has the same
  // final board and combo score at disjoint coordinates.
  await seedSkills([7,7,7],4,Array(3).fill([[0,0]]),{dot:0,reroll:0});
  await page.locator('#solve').click();await page.locator('#complete-plan').waitFor();
  assert.equal(await page.locator('.move-number').count(),0);
  assert.equal(await page.locator('.move-swatch').count(),3);
  assert.ok((await page.locator('.recommendation-chip').allTextContents()).every(text=>text===''));
  assert.match(await page.locator('#recommend-summary').textContent(),/903점 · 3줄/);
  assert.match(await page.locator('#recommend-summary').textContent(),/어느 순서로 놓아도 제거되는 줄과 최종 점수가 같습니다/);
  await page.locator('.move-button').nth(1).click();
  assert.equal(await page.locator('.board-cell.filled').count(),9,'unordered preview keeps the original board');
  assert.equal(await page.locator('.board-cell.clear-row').count(),0,'a selected piece does not promise its ordered clear');
  await page.locator('#show-all').click();
  if(await page.evaluate(()=>!!window.documentPictureInPicture)){
    const popup=page.context().waitForEvent('page');await page.locator('#pip').click();const pip=await popup;
    assert.match(await pip.locator('body').textContent(),/순서 상관없음/);
    assert.ok((await pip.locator('.pip-legend span').allTextContents()).every(text=>!/^\d+\./.test(text)));
    await pip.close();
  }
  await page.locator('#complete-plan').click();await page.getByText('파일에 저장됨',{exact:true}).waitFor();
  assert.deepEqual((await store.read()).board,[0,0,0]);assert.equal((await store.read()).currentScore,903);
  assert.deepEqual(errors,[]);
  console.log('PASS hard deadline: unfinished worker terminates at 0.95s and exposes its valid saved plan');
  console.log('PASS skills: total cap, proactive combo score, seven dots, colors, completion/undo, save/reload, actual reroll input, repeated draws and continuation');
  console.log('PASS skill reserve: spend at least one at seven, persist six, force actual reroll before placement, then complete without an extra reroll');
  console.log('PASS statistics and reroll Enter: duplicates, recompute, undo, restart, separate percentages, missing/ambiguous names and Korean IME');
  console.log('PASS inline statistics: Enter/Tab edit, validation, stable focus, undo, persistence, high-first sorting, filtered percentages and reset of all rows');
  console.log('PASS fixed line rule: migrate old API/draft gravity setting, keep existing board, no falling rows after placement/completion');
  console.log('PASS order display: independent row clears hide numbers with colors retained; score-sensitive combos/skills/rerolls keep order; preview and PiP agree');
  console.log('PASS browser without server: three-name Enter, duplicate shapes, missing names, spaces, IME commit, undo, save/reload, all colored steps, completion, responsive 320/375/414/768');
}finally{
  await browser?.close();
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});
}
