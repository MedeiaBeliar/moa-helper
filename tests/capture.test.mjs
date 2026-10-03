import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';
import {stateFromCapture,rerollFromCapture,findBlock} from '../public/capture-state.js';
import {initialState,validateState} from '../storage.mjs';
import {recordNormalDraws,statisticsRows} from '../public/statistics.js';
import {applyPartialPlan,applyTargetPlan,completePlan} from '../public/plan.js';
import {solve} from '../public/solver.js';
import {readPiece,recognize,detectBoards,defaultSlots} from '../public/vision.js';

test('ability glows may interrupt every clear strip without hiding the board or becoming occupied cells',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/ability-board-pixels.json',import.meta.url)));
  const image={width:fixture.width,height:fixture.height,data:inflateSync(Buffer.from(fixture.rgbaDeflate,'base64'))};
  const boards=detectBoards(image);assert.equal(boards.length,1);
  const result=recognize(image,{board:boards[0],slots:defaultSlots(boards[0])});
  assert.equal(result.safe,true);assert.equal(result.uncertain,0);
  assert.deepEqual(result.board,fixture.board);assert.deepEqual(result.pieces.map(p=>p.cells.length),fixture.areas);
  assert.deepEqual(result.pieces.map(p=>p.cells),fixture.pieces);
  for(const [x,y]of [[8,0],[7,8],[8,14]])assert.equal(result.board[y]&(1<<x),0,'ability is not an occupied tile');
  for(const [x,y]of [[1,0],[3,0],[5,7]])assert.notEqual(result.board[y]&(1<<x),0,'blue tiles remain occupied');
});

test('captured random shapes, duplicate slots and used slots preserve manual inventory and library',()=>{
  const state=initialState();state.cols=3;state.rows=2;state.board=[0,0];state.skills={dot:2,reroll:3};
  state.blocks=[{id:'line',name:'ㅡ',cells:[[0,0],[1,0]]}];
  const observation={safe:true,board:[0,2],pieces:[{status:'ready',cells:[[0,0],[0,1]]},{status:'ready',cells:[[0,0],[0,1]]},{status:'used',cells:[]}]};
  let id=0;const before=structuredClone(state),next=stateFromCapture(state,observation,()=>String(id++));
  assert.deepEqual(next.board,[0,2]);assert.deepEqual(next.skills,state.skills);assert.deepEqual(next.blocks,state.blocks);assert.deepEqual(state,before);
  assert.deepEqual(next.slots.map(s=>s.name),['ㅡ','ㅡ','사용 완료']);assert.equal(next.slots[2].used,true);
  assert.notEqual(next.slots[0].instanceId,next.slots[1].instanceId);
  assert.equal(stateFromCapture(next,observation,()=>String(id++)).slots[0].instanceId,next.slots[0].instanceId);
  assert.equal(findBlock(state.blocks,[[0,0],[0,1]]).id,'line');
  assert.throws(()=>stateFromCapture(state,{...observation,safe:false},()=>String(id++)));
});
test('screen reroll verifies the performed prefix and other slots before charging',()=>{
  const state=initialState();state.cols=3;state.rows=2;state.board=[0,0];state.skills={dot:0,reroll:2};state.options.rotate=false;
  state.slots=[[[0,0],[1,0],[2,0],[3,0]],[[0,0]],[[0,0]]].map((cells,i)=>({instanceId:String(i),blockId:String(i),cells,name:String(i),used:false}));
  const result=solve({...state,pieces:state.slots.map(s=>({id:s.instanceId,cells:s.cells}))});
  const observation={safe:true,board:result.moves.at(-1).boardAfter,pieces:[{status:'ready',cells:[[0,0]]},{status:'used',cells:[]},{status:'used',cells:[]}]};
  const next=rerollFromCapture(state,result,observation);assert.equal(next.skills.reroll,1);assert.deepEqual(next.blocks,[]);assert.deepEqual(next.slots[0].cells,[[0,0]]);
  assert.throws(()=>rerollFromCapture(state,result,{...observation,board:[7,7]}));
  assert.throws(()=>rerollFromCapture(state,result,{...observation,pieces:[observation.pieces[0],{status:'ready',cells:[[0,0]]},observation.pieces[2]]}));
});
test('pixel recognition preserves gaps in disconnected random shapes and refuses unknown cards',()=>{
  const image={width:60,height:60,data:new Uint8ClampedArray(60*60*4).fill(255)};
  for(const [cx,cy]of [[0,0],[2,0],[2,2]])for(let y=10+cy*8;y<17+cy*8;y++)for(let x=10+cx*8;x<17+cx*8;x++){
    const i=(y*60+x)*4;image.data[i]=255;image.data[i+1]=175;image.data[i+2]=0;
  }
  const piece=readPiece(image,{x:0,y:0,w:60,h:60});assert.equal(piece.status,'ready');assert.deepEqual(piece.cells,[[0,0],[2,0],[2,2]]);
  const unknown=recognize(image,{board:{x:0,y:0,w:60,h:60},slots:Array(3).fill({x:70,y:0,w:20,h:20})},{cols:3,rows:3});
  assert.equal(unknown.safe,false);
  const single=readPiece(image,{x:8,y:8,w:11,h:11});assert.equal(single.status,'ready');assert.deepEqual(single.cells,[[0,0]]);
});

test('capture statistics wait for validated placements, including target prefixes, reload and rereads',()=>{
  const unit=[[0,0]],state={...initialState(),cols:4,rows:2,board:[0,0],currentScore:111110,
    blocks:[{id:'unit',name:'.',cells:unit}],slots:[null,null,null]};
  const observation={safe:true,board:[0,0],pieces:Array.from({length:3},()=>({status:'ready',cells:unit}))};
  let serial=0;const makeId=()=>String(serial++);
  const captured=validateState(stateFromCapture(state,observation,makeId)),before=structuredClone(captured);
  assert.ok(captured.slots.every(s=>s.capturePending&&!s.drawRecorded));
  assert.equal(statisticsRows(recordNormalDraws(captured)).totals.total,0);
  const moves=captured.slots.map((slot,i)=>({pieceId:slot.instanceId,kind:'piece',cells:unit,x:i,y:0,boardBefore:[(1<<i)-1,0]}));
  const result={complete:true,moves,target:{currentScore:111110,hit:111111,hitStep:1}};
  const prefix=applyTargetPlan(captured,result);
  assert.equal(statisticsRows(prefix).totals.normal,1,'checking the full continuation must not count unplaced pieces');
  assert.equal(prefix.slots[0].capturePending,false);assert.equal(prefix.slots[1].capturePending,true);
  const reread=stateFromCapture(validateState(prefix),{...observation,board:prefix.board,pieces:[{status:'used'},...observation.pieces.slice(1)]},makeId);
  assert.equal(statisticsRows(recordNormalDraws(reread)).totals.normal,1);
  const partial=applyPartialPlan(reread,{complete:false,moves:moves.slice(1,2)});
  assert.equal(statisticsRows(partial).totals.normal,2);
  const finished=completePlan(partial,{complete:true,moves:moves.slice(2)});
  assert.equal(statisticsRows(finished).totals.normal,3);assert.deepEqual(finished.slots,[null,null,null]);
  assert.throws(()=>completePlan(captured,{complete:true,moves:[moves[0],moves[0],moves[2]]}));
  assert.deepEqual(captured,before);
});

test('replacing a misrecognized shape before placement records only the corrected shape',()=>{
  const unit=[[0,0]],domino=[[0,0],[1,0]],state={...initialState(),cols:8,rows:2,board:[0,0],
    blocks:[{id:'unit',name:'.',cells:unit},{id:'domino',name:'ㅡ',cells:domino}]};
  let serial=0;const makeId=()=>String(serial++),observe=cells=>({safe:true,board:[0,0],pieces:Array.from({length:3},()=>({status:'ready',cells}))});
  const wrong=stateFromCapture(state,observe(domino),makeId),corrected=stateFromCapture(wrong,observe(unit),makeId);
  assert.equal(statisticsRows(recordNormalDraws(wrong)).totals.total,0);
  const moves=corrected.slots.map((slot,i)=>({pieceId:slot.instanceId,cells:unit,x:i,y:0,boardBefore:[(1<<i)-1,0]}));
  const done=completePlan(corrected,{complete:true,moves});
  assert.equal(statisticsRows(done).rows.find(r=>r.blockId==='domino').normal,0);
  assert.equal(statisticsRows(done).rows.find(r=>r.blockId==='unit').normal,3);
});


test('blue three- and five-cell bars use grid spacing, not the narrow colored interior',()=>{
  for(const scale of [.7,1,1.5,2])for(const length of [3,5])for(const vertical of [false,true]){
    const pitch=8*scale,width=100,height=100,image={width,height,data:new Uint8ClampedArray(width*height*4).fill(255)};
    const expected=Array.from({length},(_,i)=>vertical?[0,i]:[i,0]);
    for(const [cx,cy]of expected){
      const left=Math.round(10+cx*pitch),top=Math.round(10+cy*pitch),size=Math.max(2,Math.round(3*scale));
      for(let y=top;y<top+size;y++)for(let x=left;x<left+size;x++)image.data.set([35,145,255,255],(y*width+x)*4);
    }
    const actual=readPiece(image,{x:0,y:0,w:width,h:height},{pitch});
    assert.equal(actual.status,'ready',JSON.stringify({scale,length,vertical,actual}));
    assert.deepEqual(actual.cells,expected,JSON.stringify({scale,length,vertical}));
  }
});

test('reported blue miniature keeps all three consecutive cells at reduced resolution',()=>{
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/blue-bar-pixels.json',import.meta.url)));
  const image={width:fixture.width,height:fixture.height,data:Buffer.from(fixture.rgba,'base64')};
  const actual=readPiece(image,{x:0,y:0,w:image.width,h:image.height},{pitch:fixture.boardCellPitch*8/26});
  assert.equal(actual.status,'ready');assert.deepEqual(actual.cells,[[0,0],[1,0],[2,0]]);
});

test('board-scale pitch preserves genuine gaps even when colored tile interiors are small',()=>{
  const width=60,height=60,image={width,height,data:new Uint8ClampedArray(width*height*4).fill(255)},expected=[[0,0],[2,0],[2,2]];
  for(const [cx,cy]of expected)for(let y=10+cy*8;y<13+cy*8;y++)for(let x=10+cx*8;x<13+cx*8;x++)image.data.set([35,145,255,255],(y*width+x)*4);
  const actual=readPiece(image,{x:0,y:0,w:width,h:height},{pitch:8});
  assert.equal(actual.status,'ready');assert.deepEqual(actual.cells,expected);
});
