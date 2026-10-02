import {readFile} from 'node:fs/promises';
export const snapshot=JSON.parse(await readFile(new URL('./fixtures/observed-speed-comparison.json',import.meta.url),'utf8'));
export const catalogue=snapshot.catalogue;
export const statistics={entries:catalogue.map(b=>({blockId:b.id,name:b.name,normal:b.normal,reroll:b.reroll}))};
export const fixtures=[
  {name:'empty-large-shapes',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:0}},
  {name:'screen-seven-dots',board:[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0],batch:[11,19,11],skills:{dot:7,reroll:0}},
  {name:'fragmented-board',board:[127,481,486,480,448,462,399,398,393,480,0,0,0,0,0,0],batch:[12,18,20],skills:{dot:1,reroll:2}},
  {name:'previous-running-board',board:[0,0,896,0,0,0,512,0,0,6,4,39,1,3,1,27],batch:[8,14,20],skills:{dot:0,reroll:6}},
  {name:'seven-rerolls',board:Array(16).fill(0),batch:[12,18,20],skills:{dot:0,reroll:7}},
];
export const inputFor=fixture=>({...fixture,cols:10,pieces:fixture.batch.map((index,id)=>({...catalogue[index],id})),catalogue,statistics,options:{rotate:true,reflect:true,gravity:false,timeLimit:850}});
