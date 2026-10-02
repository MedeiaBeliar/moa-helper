import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { solve, variants, place, canPlace } from '../public/solver.js';
import { createStore, initialState, validateState } from '../storage.mjs';
import { createServer } from '../server.mjs';

test('rotations and reflections cover arbitrary asymmetric shapes without duplicates',()=>{
  const shapes=variants([[0,0],[0,1],[0,2],[1,2]]);
  assert.equal(shapes.length,8);assert.equal(new Set(shapes.map(s=>JSON.stringify(s.cells))).size,8);
  assert.equal(variants([[0,0],[1,0],[0,1],[1,1]]).length,1);
});
test('only horizontal full rows clear; other rows stay in place',()=>{
  assert.deepEqual(place([1,7,1,1],4,[[0,0]],3,1),{board:[1,0,1,1],cleared:[1]});
  assert.deepEqual(place([1,7,1,1],4,[[0,0]],3,1,true),{board:[0,1,1,1],cleared:[1]});
  assert.equal(place([1,0],4,[[0,0]],0,0),null);
  assert.equal(canPlace([0,0],4,[[0,0],[1,0]],3,0),false);
});

test('legacy falling-row setting is retired without changing board, catalogue or statistics',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-rules-'));
  try{
    const legacy=initialState();legacy.options.gravity=true;legacy.board=[0,0,0,0,127,511,390,463,448,128,0,0,0,0,0,0];
    legacy.blocks=[{id:'b',name:'ㅅ',cells:[[0,0]]}];legacy.statistics={entries:[{blockId:'b',name:'ㅅ',normal:45,reroll:2}]};
    await writeFile(path.join(dir,'state.json'),JSON.stringify(legacy));
    const migrated=await createStore(dir).read();assert.equal(migrated.options.gravity,false);
    for(const key of ['board','blocks','slots','skills','statistics'])assert.deepEqual(migrated[key],legacy[key]);
    await createStore(dir).write(legacy);
    assert.equal(JSON.parse(await readFile(path.join(dir,'state.json'),'utf8')).options.gravity,false);
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});
test('search uses a cleared row for the next piece in the three-piece batch',()=>{
  const board=[7,7,7];const pieces=[{id:'one',cells:[[0,0]]},{id:'two',cells:[[0,0],[1,0],[2,0],[3,0]]},{id:'three',cells:[[0,0],[1,0],[2,0],[3,0]]}];
  const result=solve({board,cols:4,pieces,options:{timeLimit:1000,beamWidth:100}});
  assert.equal(result.moves.length,3);assert.equal(result.lines,3);assert.equal(result.moves[0].pieceId,'one');
  let current=board;for(const move of result.moves){assert.deepEqual(move.boardBefore,current);const next=place(current,4,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(next.board,move.boardAfter);current=next.board;}
});
test('duplicate shapes are independent pieces, and full boards have no legal move',()=>{
  const result=solve({board:[0,0],cols:3,pieces:[0,1,2].map(id=>({id,cells:[[0,0]]})),options:{timeLimit:1000}});
  assert.equal(result.complete,true);assert.equal(new Set(result.moves.map(m=>m.pieceId)).size,3);assert.equal(result.lines,1);
  assert.equal(solve({board:[7,7],cols:3,pieces:[{id:0,cells:[[0,0]]}]}).moves.length,0);
});
test('rotation constraints are honored',()=>{
  const input={board:[6,6,6],cols:3,pieces:[{id:0,cells:[[0,0],[1,0],[2,0]]}]};
  assert.equal(solve({...input,options:{rotate:false,reflect:false}}).moves.length,0);
  assert.equal(solve(input).moves.length,1);
});
test('small-board result agrees with an independent exhaustive clear-count oracle',()=>{
  const board=[5,2,4];const pieces=[{id:0,cells:[[0,0]]},{id:1,cells:[[0,0],[1,0]]},{id:2,cells:[[0,0]]}];
  let optimum=-1;
  function enumerate(b,remaining,lines){if(!remaining.length){optimum=Math.max(optimum,lines);return;}for(const p of remaining)for(const v of variants(p.cells))for(let y=0;y<b.length;y++)for(let x=0;x<3;x++){const next=place(b,3,v.cells,x,y);if(next)enumerate(next.board,remaining.filter(q=>q.id!==p.id),lines+next.cleared.length);}}
  enumerate(board,pieces,0);const result=solve({board,cols:3,pieces,options:{beamWidth:600,timeLimit:5000}});
  assert.equal(result.complete,true);assert.equal(result.lines,optimum);
});
test('persistent store survives recreation, preserves duplicate slots, and rejects invalid writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-core-'));
  try {
    const store=createStore(dir),s=initialState();s.blocks=[{id:'b',name:'내 블록',cells:[[2,3],[2,4],[3,4]]}];s.board[0]=3;
    s.slots=[0,1,2].map(i=>({instanceId:`s${i}`,blockId:'b',name:'내 블록',cells:[[0,0],[0,1],[1,1]],used:i===0}));
    await store.write(s);const restored=await createStore(dir).read();assert.equal(restored.blocks[0].name,'내 블록');assert.deepEqual(restored.blocks[0].cells,[[0,0],[0,1],[1,1]]);assert.equal(restored.board[0],3);assert.equal(restored.slots[0].used,true);
    assert.throws(()=>store.write({...s,board:[-1]}));assert.equal((await store.read()).board[0],3);
    await Promise.all([store.write({...s,board:Array(16).fill(4)}),store.write({...s,board:Array(16).fill(8)})]);assert.equal((await store.read()).board[0],8);
    await writeFile(path.join(dir,'state.json'),'broken');await assert.rejects(createStore(dir).read());assert.equal(await readFile(path.join(dir,'state.json'),'utf8'),'broken');
  } finally {assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});
test('state validation rejects broken coordinates and oversized grids',()=>{
  const state=initialState();assert.throws(()=>validateState({...state,cols:32}));assert.throws(()=>validateState({...state,blocks:[{id:'x',name:'bad',cells:[[NaN,0]]}]}));assert.throws(()=>validateState({...state,blocks:[{id:'x',name:'bad',cells:[]}]}));
});
test('HTTP API persists state across a server restart and refuses cross-origin writes',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'moa-api-'));let server;
  async function start(){server=createServer({dataDir:dir});server.listen(0,'127.0.0.1');await once(server,'listening');return `http://127.0.0.1:${server.address().port}`;}
  async function close(){await new Promise(resolve=>server.close(resolve));}
  try {
    let url=await start();assert.equal((await fetch(url)).status,200);
    const s=initialState();s.blocks=[{id:'p',name:'지속 저장',cells:[[0,0]]}];s.board[3]=16;
    const put=()=>fetch(`${url}/api/state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(s)});
    assert.equal((await put()).status,200);
    assert.equal((await fetch(`${url}/api/state`,{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(s)})).status,403);
    assert.equal((await fetch(`${url}/api/state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:'{bad'})).status,400);
    await close();url=await start();const restored=await(await fetch(`${url}/api/state`)).json();assert.equal(restored.blocks[0].name,'지속 저장');assert.equal(restored.board[3],16);
    assert.equal((await fetch(`${url}/server.mjs`)).status,404);
  }finally{if(server?.listening)await close();assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));await rm(dir,{recursive:true,force:true});}
});
