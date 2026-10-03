import test from 'node:test';
import assert from 'node:assert/strict';
import {t,setLanguage,getLanguage,onLanguageChange} from '../public/i18n.js';
import english from '../public/locales/en.js';

test('language changes preserve values, support reordered placeholders, and leave unknown errors intact',()=>{
  setLanguage('ko');assert.equal(t`조각 ${2}`,'조각 2');
  setLanguage('en');assert.equal(t`조각 ${2}`,'Piece 2');
  assert.equal(t`${3}번까지 놓으면 ${'100,000'}점 예상`,'Estimated 100,000 points after move 3');
  assert.equal(t`${'점 찍기 {0} <script>'} 선택`,'Select 점 찍기 {0} <script>');
  assert.equal(t('Some browser error'),'Some browser error');
  assert.equal(t('constructor'),'constructor');assert.equal(t('__proto__'),'__proto__');
  assert.equal(t`${1}칸`,'1 cell');assert.equal(t`${2}칸`,'2 cells');
  assert.equal(t`${301}점 · ${1}줄`,'301 points · 1 line');
  setLanguage('ko');assert.equal(t('Saved to file'),'파일에 저장됨');
});

test('language preferences reject invalid values and notify only on actual changes',()=>{
  setLanguage('ko');const calls=[];const unsubscribe=onLanguageChange(value=>calls.push(value));
  assert.equal(setLanguage('fr'),false);assert.equal(getLanguage(),'ko');
  setLanguage('en');setLanguage('en');setLanguage('ko');unsubscribe();setLanguage('en');
  assert.deepEqual(calls,['en','ko']);setLanguage('ko');
});

test('every translation keeps its source placeholders and contains nonempty text',()=>{
  const placeholders=text=>[...text.matchAll(/\{\d+\}/g)].map(m=>m[0]).sort();
  for(const [source,value]of Object.entries(english)){
    for(const text of typeof value==='string'?[value]:[value.one,value.other]){
      assert.ok(text.trim(),source);assert.deepEqual(placeholders(text),placeholders(source),source);
    }
  }
});
