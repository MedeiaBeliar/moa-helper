import test from 'node:test';
import assert from 'node:assert/strict';
import {createStatisticsExport,copyStatisticsExport} from '../public/statistics-export.js';

const createdAt=new Date('2026-10-03T12:00:00Z');
function fixture(){
  return {blocks:[{id:'private-a',name:'ㄴ',cells:[[3,4],[3,5],[4,5]]},{id:'private-b',name:'ㅡ',cells:[[0,0],[1,0],[2,0]]}],
    statistics:{entries:[
      {blockId:'private-a',name:'old name',normal:4,reroll:2,stages:{1:{normal:1,reroll:1},2:{normal:2,reroll:0}}},
      {blockId:'private-b',name:'ㅡ',normal:6,reroll:1,stages:{1:{normal:3,reroll:1},5:{normal:3,reroll:0}}},
      {blockId:'private-deleted',name:'ㅁ',normal:5,reroll:1,stages:{3:{normal:5,reroll:1}}},
      {blockId:null,name:'미분류 (화면 인식)',normal:5,reroll:0,stages:{1:{normal:1,reroll:0}}}
    ]},board:[13,14],currentScore:123456,slots:[{name:'unconfirmed-piece',capturePending:true}],skills:{dot:2,reroll:3}};
}

test('community export uses separate observed denominators and never doubles stage totals',()=>{
  const state=fixture(),before=structuredClone(state),report=createStatisticsExport(state,{createdAt});
  assert.deepEqual(report.tables.map(table=>table.source),['normal','reroll']);
  assert.deepEqual(report.tables[0].stages.map(stage=>stage.scope),['all','1','2','3','4','5','unknown']);
  const normal=report.tables[0].rows.find(row=>row.name==='ㄴ'),reroll=report.tables[1].rows.find(row=>row.name==='ㄴ');
  assert.deepEqual(normal.values[0],{count:4,percent:'20.0%'});
  assert.deepEqual(normal.values[1],{count:1,percent:'20.0%'});
  assert.deepEqual(normal.values[2],{count:2,percent:'100.0%'});
  assert.deepEqual(normal.values[6],{count:1,percent:'20.0%'});
  assert.deepEqual(reroll.values[0],{count:2,percent:'50.0%'});
  assert.deepEqual(reroll.values[6],{count:1,percent:'100.0%'});
  assert.equal(report.tables[0].rows.length,4,'deleted and unidentified draws remain included');
  assert.match(report.html,/<td>20\.0% \(4회\)<\/td>/);
  assert.doesNotMatch(report.html,/private-|unconfirmed-piece|123456|old name/);
  assert.deepEqual(state,before,'export never records pending draws or mutates the save');
});

test('export contains only data tables and named HTML block grids, without CSS or commentary',()=>{
  const report=createStatisticsExport(fixture(),{createdAt,source:'normal'});
  assert.ok(report.html.startsWith('<table '));
  assert.doesNotMatch(report.html,/<(?:p|h[1-6]|pre|style|script|img|svg|canvas|tfoot)\b|\s(?:style|class|id)=|공식|관측 기록|모아모아 도우미|2026/);
  const grid=/<th scope="row">ㄴ(<table[\s\S]*?<\/table>)<\/th>/.exec(report.html)?.[1];
  assert.ok(grid,'the saved name and an HTML shape share a row header');
  const rows=[...grid.matchAll(/<tr>(.*?)<\/tr>/g)].map(match=>[...match[1].matchAll(/<td([^>]*)><\/td>/g)].map(cell=>cell[1].includes('bgcolor')));
  assert.deepEqual(rows,[[true,false],[true,true]],'trim offsets and preserve empty cells');
  assert.equal((grid.match(/bgcolor=/g)||[]).length,3);
  assert.equal((grid.match(/width="12" height="12"/g)||[]).length,4);
  assert.match(report.document,/^<!doctype html>/);assert.ok(report.document.includes(report.html));
  assert.equal(report.filename,'moa-statistics-2026-10-03-complete.html');
});

test('current scope, source, sorting and language choices are reflected in the export',()=>{
  const state=fixture(),report=createStatisticsExport(state,{scope:'1',source:'reroll',sort:'name',language:'en',createdAt});
  assert.equal(report.tables.length,1);assert.deepEqual(report.tables[0].stages,[{scope:'1',title:'Stage 1'}]);
  assert.deepEqual(report.tables[0].rows.map(row=>row.name),['ㄴ','ㅁ','Unidentified','ㅡ']);
  assert.match(report.html,/<caption>Rerolls<\/caption>/);assert.match(report.html,/<td>50\.0% \(1\)<\/td>/);
  assert.doesNotMatch(report.html,/stage records|<p>|미분류|일반 출현|회/);
  assert.match(report.document,/<html lang="en">/);
  assert.throws(()=>createStatisticsExport(state,{scope:'bad'}));assert.throws(()=>createStatisticsExport(state,{source:'bad'}));
});

test('empty scopes and unknown stages remain distinct from zero-probability observations',()=>{
  const state={blocks:[{id:'a',name:'ㄱ',cells:[[0,0]]}],statistics:{entries:[]}};
  const empty=createStatisticsExport(state,{source:'normal',createdAt});
  assert.equal(empty.tables[0].stages.length,6);assert.ok(empty.tables[0].rows[0].values.every(value=>value.percent==='—'));
  assert.doesNotMatch(empty.html,/NaN|Infinity|100\.0%|단계 미상/);
  state.statistics.entries=[{blockId:'a',name:'ㄱ',normal:10,reroll:0}];
  const unknown=createStatisticsExport(state,{scope:'unknown',source:'normal',createdAt});
  assert.deepEqual(unknown.tables[0].rows[0].values,[{count:10,percent:'100.0%'}]);
  const zero=createStatisticsExport(fixture(),{scope:'1',source:'normal',createdAt});
  assert.deepEqual(zero.tables[0].rows.find(row=>row.name==='ㅁ').values,[{count:0,percent:'0.0%'}]);
});

test('saved names cannot inject markup, resources, or attributes into the post',()=>{
  const state=fixture(),name='<img src=x onerror="alert(1)">&\' <script>bad</script>';
  state.blocks[0].name=name;
  const report=createStatisticsExport(state,{createdAt});
  assert.doesNotMatch(report.html,/<img|<script|<[^>]+\sonerror=/);
  assert.match(report.html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;&#39;/);
  assert.ok(report.tables[0].rows.some(row=>row.name===name));
});

test('source copy and rich table copy send distinct clipboard payloads and report failures',async()=>{
  const report=createStatisticsExport(fixture(),{createdAt,source:'normal'}),writes=[];
  const clipboard={writeText:async value=>writes.push(value),write:async value=>writes.push(value)};
  class Item {constructor(values){this.values=values;}}
  await copyStatisticsExport(report,'source',{clipboard,Item});assert.equal(writes[0],report.html);
  await copyStatisticsExport(report,'table',{clipboard,Item});
  assert.deepEqual(Object.keys(writes[1][0].values),['text/html','text/plain']);
  assert.equal(await writes[1][0].values['text/html'].text(),report.html);
  assert.equal(await writes[1][0].values['text/plain'].text(),report.text);
  await assert.rejects(copyStatisticsExport(report,'table',{clipboard:{},Item:null}));
  await assert.rejects(copyStatisticsExport(report,'source',{clipboard:{writeText:async()=>{throw new Error('denied');}}}),/denied/);
});
