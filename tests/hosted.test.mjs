import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID,createHash} from 'node:crypto';
import {BrowserSession,CommunitySync,SESSION_KEY,CONFLICT} from '../public/browser-session.js';
import {contributionCounts,communityForLibrary} from '../public/community.js';
import {initialState} from '../public/state-schema.js';
import {StatisticsStore,validateContribution} from '../hosted/statistics-store.mjs';
import {createHostedHandler} from '../hosted/server.mjs';
import {domains,renderApp,renderPage,sitemap} from '../hosted/pages.mjs';
import {addSkillIcon,removeSkillIcon} from '../public/abilities.js';
import {recordNormalDraws} from '../public/statistics.js';
import {resetGameState} from '../public/game-state.js';

const catalogue=JSON.parse(await readFile(new URL('../public/example-blocks.json',import.meta.url))).blocks;
const template=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
const host=domains[0],origin=`https://${host}`;
const memory=()=>{const map=new Map();return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value)};};
function counts(n,stage=1){return [{blockId:catalogue[0].id,stage,normal:n,reroll:0}];}
async function tempStore(run){const dir=await mkdtemp(path.join(os.tmpdir(),'moa-hosted-'));const filename=path.join(dir,'stats.sqlite'),store=new StatisticsStore(filename,catalogue);try{await run(store,filename);}finally{store.close();await rm(dir,{recursive:true,force:true});}}

test('new markers refresh age, expire the oldest and have an independent delete action',()=>{
  let state=initialState();for(let x=0;x<3;x++)state=addSkillIcon(state,{x,y:0,kind:'dot'}).state;
  const board=state.board.slice();state=addSkillIcon(state,{x:0,y:0,kind:'dot'}).state;
  assert.deepEqual(state.skillIconOrder,['1,0','2,0','0,0']);assert.equal(state.skillIcons.length,3);
  const next=addSkillIcon(state,{x:3,y:0,kind:'reroll'});assert.deepEqual(next.expired,{x:1,y:0,kind:'dot'});
  state=removeSkillIcon(next.state,0,0);assert.deepEqual(state.skillIconOrder,['2,0','3,0']);assert.deepEqual(state.board,board);assert.deepEqual(state.skills,{dot:0,reroll:0});
  state.skillIconOrder=[];state=addSkillIcon(state,{x:4,y:0,kind:'dot'}).state;
  assert.equal(state.skillIconOrder.length,3);assert.equal(addSkillIcon(state,{x:5,y:0,kind:'dot'}).expired.x,2);
  assert.match(template,/id="mode-icon-erase"/);assert.doesNotMatch(template,/id="icon-entry"|id="forget-icon-order"/);
});

test('browser sessions persist private progress and reject stale-tab overwrites without losing data',()=>{
  const storage=memory(),a=new BrowserSession(catalogue,{storage}),state=a.load(),token=a.submission().token;
  const b=new BrowserSession(catalogue,{storage});b.load();state.board[0]=15;state.currentScore=123456;
  assert.equal(a.save(state),false);assert.throws(()=>b.save({...state,currentScore:99}),{message:CONFLICT});
  assert.equal(b.load().currentScore,123456);assert.equal(b.submission().token,token);
  const next=b.load();next.statistics={entries:[{blockId:catalogue[0].id,name:'private name',normal:3,reroll:1,stages:{2:{normal:2,reroll:1}}}]};
  assert.equal(b.save(next),true);assert.equal(b.submission().revision,1);
  const body=JSON.stringify(b.submission());assert.doesNotMatch(body,/123456|private name|board|skills|slots|currentScore/);
  assert.deepEqual(b.submission().counts,[{blockId:catalogue[0].id,stage:0,normal:1,reroll:0},{blockId:catalogue[0].id,stage:2,normal:2,reroll:1}]);
  b.save(resetGameState(next));assert.equal(b.submission().revision,1,'game reset preserves observations');
  const denied=new BrowserSession(catalogue,{storage:{getItem:()=>null,setItem:()=>{throw new Error('quota');}}});assert.throws(()=>denied.load(),/quota/);
  const before=storage.getItem(SESSION_KEY);storage.setItem=()=>{throw new Error('full');};assert.throws(()=>b.save(next),/full/);assert.equal(storage.getItem(SESSION_KEY),before);
});

test('only confirmed observations contribute, with canonical shapes and independent stage buckets',()=>{
  let state={...initialState(),blocks:[{...catalogue[0],id:'personal',name:'secret'}],slots:[0,1,2].map(i=>({instanceId:String(i),blockId:'personal',name:'secret',cells:catalogue[0].cells,capturePending:true,drawStage:2}))};
  assert.deepEqual(contributionCounts(recordNormalDraws(state),catalogue),[]);
  state=recordNormalDraws(state,{confirmedIds:['0']});assert.deepEqual(contributionCounts(state,catalogue),counts(1,2));
  const byShape=communityForLibrary({entries:[{blockId:catalogue[0].id,normal:4,reroll:2,stages:{2:{normal:4,reroll:2}}}]},catalogue,state.blocks);
  assert.equal(byShape.entries[0].blockId,'personal');assert.equal(byShape.entries[0].normal,4);
  const identities={};contributionCounts(state,catalogue,identities);state.blocks=[];assert.deepEqual(contributionCounts(state,catalogue,identities),counts(1,2),'deleting a library item retains its observation identity');
});

test('shared counts deduplicate retries, reject stale revisions, support undo and survive reopening',()=>tempStore(async(store,filename)=>{
  const a=randomUUID(),b=randomUUID();
  store.submit({token:a,revision:1,counts:counts(3)});store.submit({token:b,revision:1,counts:counts(2,5)});
  store.submit({token:a,revision:1,counts:counts(3)});assert.equal(store.read().statistics.entries[0].normal,5);
  store.submit({token:a,revision:3,counts:counts(1)});store.submit({token:a,revision:2,counts:counts(90)});
  assert.equal(store.read().statistics.entries[0].normal,3);assert.equal(store.read().statistics.entries[0].stages[5].normal,2);
  assert.doesNotMatch(JSON.stringify(store.read()),new RegExp(`${a}|${b}|token|contributors|revision`));
  const reopened=new StatisticsStore(filename,catalogue);try{assert.deepEqual(reopened.read(),store.read());}finally{reopened.close();}
  const before=store.read();assert.throws(()=>store.submit({token:a,revision:4,counts:[...counts(2),...counts(2)]}));assert.deepEqual(store.read(),before);
  for(const bad of [{token:'bad',revision:1,counts:[]},{token:a,revision:4,counts:[{...counts(1)[0],stage:6}]},{token:a,revision:4,counts:counts(-1)},{token:a,revision:4,counts:counts(1000001)},{token:a,revision:4,counts:counts(1),board:[]}])assert.throws(()=>validateContribution(bad,catalogue));
}));

test('failed sync keeps pending data; retries use the same identity and revision',async()=>{
  const session=new BrowserSession(catalogue,{storage:memory()}),state=session.load();state.statistics={entries:[{blockId:catalogue[0].id,name:'x',normal:3,reroll:0}]};session.save(state);
  let online=false;const bodies=[],status=[];
  const sync=new CommunitySync(session,{fetcher:async(url,request)=>{bodies.push(request.body);if(!online)throw new Error('offline');return {ok:true,json:async()=>({statistics:{entries:[]}})};},onStatus:s=>status.push(s)});
  await sync.flush();assert.equal(sync.sent,-1);online=true;await sync.flush();assert.equal(bodies[0],bodies[1]);assert.equal(sync.sent,1);assert.ok(status.includes('offline'));await sync.flush();assert.equal(bodies.length,2);
  const updates=[];sync.onUpdate=data=>updates.push(data.updatedAt);sync.accept({updatedAt:'2026-10-03T10:00:01.000Z'});sync.accept({updatedAt:null});sync.accept({updatedAt:'2026-10-03T10:00:00.000Z'});assert.deepEqual(updates,['2026-10-03T10:00:01.000Z']);
});

async function request(handler,url,{method='GET',headers={},body=''}={}){
  const req=Readable.from(body?[Buffer.from(body)]:[]);Object.assign(req,{url,method,headers:{host,...headers},socket:{remoteAddress:'127.0.0.1'}});
  const response={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body?.toString()||'';}};
  await handler(req,response);return response;
}
test('hosted handler isolates state, validates origins and bodies, and serves crawlable pages without a listener',()=>tempStore(async store=>{
  const handler=createHostedHandler({store,catalogue,template});
  for(const method of ['GET','PUT'])assert.equal((await request(handler,'/api/state',{method,body:'{}'})).status,404);
  assert.equal((await request(handler,'/data/state.json')).status,404);
  assert.equal((await request(handler,'/',{headers:{host:'evil.invalid'}})).status,421);
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers:{origin:'https://evil.invalid','content-type':'application/json'}})).status,403);
  const headers={origin,'content-type':'application/json'},submission={token:randomUUID(),revision:1,counts:counts(2)};
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers,body:JSON.stringify(submission)})).status,200);
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers,body:'x'.repeat(32769)})).status,413);
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers,body:'{'})).status,400);
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers:{...headers,'content-type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await request(handler,'/api/statistics',{method:'PUT',headers:{...headers,'sec-fetch-site':'cross-site'},body:'{}'})).status,403);
  for(const url of ['/','/en/','/guide','/en/guide','/statistics','/en/statistics','/robots.txt','/sitemap.xml','/llms.txt']){
    const response=await request(handler,url);assert.equal(response.status,200,url);assert.ok(response.body.length>50,url);assert.doesNotMatch(response.body,/noindex/);
  }
  assert.equal((await request(handler,'/',{method:'HEAD'})).body,'');assert.equal((await request(handler,'/missing')).status,404);
  const binary=await request(handler,'/native-engine.wasm');assert.equal(binary.status,200);
  assert.match(binary.headers['Content-Type'],/^application\/wasm/);
  assert.match((await request(handler,'/')).headers['Content-Security-Policy'],/'wasm-unsafe-eval'/);
  assert.equal((await request(handler,'/%2e%2e%2fstorage.mjs')).status,404);
  const limited=createHostedHandler({store,catalogue,template,now:()=>100});let response;
  for(let i=0;i<121;i++)response=await request(limited,'/api/statistics',{method:'PUT',headers,body:JSON.stringify(submission)});
  assert.equal(response.status,429);
}));

test('each domain has its own canonical, bilingual URLs, consistent JSON-LD and public statistics HTML',()=>{
  for(const domain of domains)for(const language of ['ko','en']){
    const origin=`https://${domain}`,page=renderApp(template,{origin,language}),canonical=origin+(language==='en'?'/en/':'/');
    assert.ok(page.html.includes(`rel="canonical" href="${canonical}"`));assert.ok(page.html.includes('name="moa-storage" content="browser"'));
    assert.equal((page.html.match(/name="description"/g)||[]).length,1);
    const json=/<script type="application\/ld\+json">(.*?)<\/script>/.exec(page.html)[1];assert.doesNotThrow(()=>JSON.parse(json));assert.equal(page.hash,createHash('sha256').update(json).digest('base64'));
    assert.ok(sitemap(origin).includes(`${origin}/en/statistics`));
    const stats=renderPage({origin,language,page:'statistics',catalogue,statistics:{entries:[]}});assert.match(stats.html,/<table/);assert.match(stats.html,/bgcolor=/);assert.ok(stats.html.includes(catalogue[0].name));assert.doesNotMatch(stats.html,/example-0/);
  }
});
