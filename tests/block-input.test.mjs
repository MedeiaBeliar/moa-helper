import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBlockInput,blocksNamed,blockNameIncludes} from '../public/block-input.js';
import {initialState} from '../storage.mjs';
import {statisticsView} from '../public/statistics.js';

test('English two-set keys and composed Hangul resolve to the requested three block names',()=>{
  for(const [inputs,expected] of [
    [['ㅅㅅㅡ','ttm',' t t m '],'ㅅㅅㅡ'],
    [['ㄿㄱ','fvr','ㄹㅍㄱ',' ㄿ ㄱ '],'ㄹㅍㄱ'],
    [['ㄳㅇ','rtd','ㄱㅅㅇ'],'ㄱㅅㅇ'],
    [['긔','rml','ㄱㅡㅣ','긔'.normalize('NFD')],'ㄱㅡㅣ'],
    [['간','rks','ㄱㅏㄴ'],'ㄱㅏㄴ'],
    [['과','rhk','ㄱㅗㅏ'],'ㄱㅗㅏ'],
    [['.ㄱㅅ','.rt','. rㅅ'],'.ㄱㅅ']
  ])for(const input of inputs){assert.equal(normalizeBlockInput(input),expected,input);assert.equal(Array.from(normalizeBlockInput(input)).length,3);}
});
test('compound finals, compound vowels and doubled consonants split without inventing or losing keys',()=>{
  assert.equal(normalizeBlockInput('ㄳㄵㄶㄺㄻㄼㄽㄾㄿㅀㅄ'),'ㄱㅅㄴㅈㄴㅎㄹㄱㄹㅁㄹㅂㄹㅅㄹㅌㄹㅍㄹㅎㅂㅅ');
  assert.equal(normalizeBlockInput('ㅘㅙㅚㅝㅞㅟㅢ'),'ㅗㅏㅗㅐㅗㅣㅜㅓㅜㅔㅜㅣㅡㅣ');
  assert.equal(normalizeBlockInput('ㄲㄸㅃㅆㅉ'),'ㄱㄱㄷㄷㅂㅂㅅㅅㅈㅈ');
  assert.equal(normalizeBlockInput('QWERTOP'),'ㅂㅂㅈㅈㄷㄷㄱㄱㅅㅅㅒㅖ');
  assert.equal(normalizeBlockInput('ASDFGHJKL'),'ㅁㄴㅇㄹㅎㅗㅓㅏㅣ');
  assert.equal(normalizeBlockInput('ㅑㅕㅛㅠㅐㅔㅒㅖ'),'ㅑㅕㅛㅠㅐㅔㅒㅖ');
  assert.equal(normalizeBlockInput('값'),'ㄱㅏㅂㅅ');assert.equal(normalizeBlockInput('123?'),'123?');
});
test('name lookup supports keyboard aliases while retaining literal names and ambiguous-name safeguards',()=>{
  const blocks=[{id:'a',name:'ㅅ'},{id:'b',name:'ㅣ'},{id:'c',name:'가로 다섯'}],before=structuredClone(blocks);
  assert.deepEqual(blocksNamed(blocks,' t '),[blocks[0]]);assert.deepEqual(blocksNamed(blocks,'l'),[blocks[1]]);
  assert.deepEqual(blocksNamed(blocks,'가로 다섯'),[blocks[2]]);assert.deepEqual(blocksNamed(blocks,'?'),[]);
  const duplicate={id:'d',name:'ㅅ'};assert.equal(blocksNamed([...blocks,duplicate],'t').length,2);
  assert.deepEqual(blocksNamed([...blocks,{id:'e',name:'t'}],'t'),[{id:'e',name:'t'}]);
  assert.equal(blockNameIncludes('ㄹ','f'),true);assert.equal(blockNameIncludes('ㄹ','ㄿ'),false);
  assert.deepEqual(blocks,before);
});
test('statistics search accepts English keys without changing the observation denominator',()=>{
  const state={...initialState(),blocks:[{id:'a',name:'ㄱ',cells:[[0,0]]},{id:'b',name:'ㅅ',cells:[[0,0]]}],statistics:{entries:[{blockId:'a',name:'ㄱ',normal:6,reroll:0},{blockId:'b',name:'ㅅ',normal:4,reroll:0}]}};
  const {rows,totals}=statisticsView(state,{query:'r'});
  assert.equal(rows.length,1);assert.equal(rows[0].name,'ㄱ');assert.equal(totals.total,10);
});
