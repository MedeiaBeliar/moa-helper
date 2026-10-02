import test from 'node:test';
import assert from 'node:assert/strict';
import {deduplicateLibrary,shapeKey} from '../public/library.js';
import {initialState} from '../storage.mjs';
import {variants} from '../public/solver.js';

test('shape identity covers translation, every rotation and reflection',()=>{
  const cells=[[0,0],[0,1],[1,1],[0,2]];
  for(const variant of variants(cells))assert.equal(shapeKey(variant.cells.map(([x,y])=>[x+3,y+4])),shapeKey(cells));
  assert.notEqual(shapeKey(cells),shapeKey([[0,0],[1,0],[2,0],[3,0]]));
});

test('merge keeps the most observed identity, all stage totals and pending slot metadata',()=>{
  const a={id:'a',name:'ㅏ',cells:[[0,0],[0,1],[1,1],[0,2]]};
  const b={id:'b',name:'ㅗ',cells:[[0,0],[1,0],[2,0],[1,1]]};
  const other={id:'other',name:'ㅡ',cells:[[0,0],[1,0],[2,0]]};
  const state={...initialState(),blocks:[a,b,other],statistics:{entries:[
    {blockId:'a',name:'ㅏ',normal:5,reroll:0,stages:{1:{normal:3,reroll:0}}},
    {blockId:'b',name:'ㅗ',normal:3,reroll:4,stages:{1:{normal:1,reroll:2},2:{normal:1,reroll:1}}},
    {blockId:null,name:'unknown',normal:9,reroll:1}
  ]},slots:[{instanceId:'pending',blockId:'a',name:'ㅏ',cells:a.cells,used:false,capturePending:true,drawStage:2,drawSource:'reroll',drawRecorded:false},null,null]};
  const before=structuredClone(state),{state:next,groups}=deduplicateLibrary(state);
  assert.deepEqual(state,before);assert.equal(groups.length,1);assert.equal(groups[0].keep.id,'b');
  assert.deepEqual(next.blocks,[b,other]);
  assert.deepEqual(next.statistics.entries[0],{blockId:'b',name:'ㅗ',normal:8,reroll:4,stages:{1:{normal:4,reroll:2},2:{normal:1,reroll:1}}});
  assert.deepEqual(next.statistics.entries[1],state.statistics.entries[2]);
  assert.deepEqual(next.slots[0],{...state.slots[0],blockId:'b',name:'ㅗ'});
  assert.equal(next.board,state.board);assert.equal(deduplicateLibrary(next).state,next);
});

test('tied or unobserved shapes keep the first identity without fabricating observations',()=>{
  const state={...initialState(),blocks:[{id:'a',name:'a',cells:[[0,0],[1,0]]},{id:'b',name:'b',cells:[[0,0],[0,1]]}]};
  const next=deduplicateLibrary(state).state;
  assert.equal(next.blocks[0].id,'a');assert.deepEqual(next.statistics.entries,[]);
});
