import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {solve,place,variants} from '../public/solver.js';
import {scenarioWeights,makeScenarios,preparePolicyCatalogue,mobilityReport} from '../public/policy.js';
import {initialState,validateState} from '../storage.mjs';
const catalogue=JSON.parse(await readFile(new URL('./fixtures/catalogue.json',import.meta.url),'utf8')).map((p,i)=>({...p,id:`b${i}`}));
function replay(input,result){
  let board=input.board,score=0,dots=0;const used=new Set();
  for(const move of result.moves){
    assert.deepEqual(move.boardBefore,board);
    if(move.kind==='dot'){dots++;assert.deepEqual(move.cells,[[0,0]]);}else{
      const piece=input.pieces.find(p=>p.id===move.pieceId);assert.ok(piece);assert.ok(!used.has(piece.id));used.add(piece.id);
      assert.ok(variants(piece.cells).some(v=>JSON.stringify(v.cells)===JSON.stringify(move.cells)));
    }
    const next=place(board,input.cols,move.cells,move.x,move.y);assert.ok(next);assert.deepEqual(next.board,move.boardAfter);
    assert.deepEqual(next.cleared,move.cleared);score+=(move.kind==='dot'?1:move.cells.length)+300*next.cleared.length**2;board=next.board;
  }
  assert.equal(result.score,score);assert.equal(result.skillsUsed.dot,dots);assert.ok(dots<=input.skills.dot);
  if(result.complete){assert.equal(used.size,input.pieces.length);assert.ok(input.skills.dot+input.skills.reroll-dots<7);}
}
test('one-second incumbents and final recommendations replay legally on the final catalogue',()=>{
  for(const board of [Array(16).fill(0),[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0]]){
    const input={board,cols:10,pieces:[11,19,11].map((index,id)=>({...catalogue[index],id})),catalogue,skills:{dot:0,reroll:0},options:{timeLimit:800,beamWidth:40}};
    let updates=0;const result=solve(input,{onProgress:r=>{replay(input,r);updates++;}});
    assert.ok(updates);assert.equal(result.complete,true);assert.equal(result.method,'fast');replay(input,result);
  }
});
test('one-second solver keeps mandatory skill reserve and real reroll boundary',()=>{
  for(const skills of [{dot:1,reroll:6},{dot:0,reroll:7}]){
    const input={board:Array(16).fill(0),cols:10,pieces:Array.from({length:3},(_,id)=>({id,cells:[[0,0]]})),catalogue,skills,options:{timeLimit:200,beamWidth:16}};
    const result=solve(input);replay(input,result);
    if(skills.dot){assert.equal(result.complete,true);assert.ok(result.skillsUsed.dot>=1);}
    else{assert.equal(result.complete,false);assert.equal(result.reroll.reason,'capacity');assert.equal(result.moves.length,0);}
  }
});
test('fast current-batch mode reserves enough time to recover a pruned third piece',()=>{
  const input={board:[772,287,778,260,640,256,0,0,0,0,0,0,0,0,0,0],cols:10,
    pieces:[11,19,11].map((index,id)=>({...catalogue[index],id})),catalogue,skills:{dot:0,reroll:0},options:{lookAhead:false,timeLimit:200,beamWidth:100}};
  const result=solve(input);assert.equal(result.complete,true);replay(input,result);
});
test('mobility detects unplaceable large shapes despite abundant free cells',()=>{
  const prepared=preparePolicyCatalogue(catalogue,10,16,{}),open=mobilityReport(Array(16).fill(0),10,prepared);
  const fragmented=mobilityReport(Array.from({length:16},(_,y)=>y%2?341:682),10,prepared);
  assert.equal(open.deadTypes,0);assert.ok(open.minFits>0);assert.ok(fragmented.deadTypes>0);assert.ok(open.value>fragmented.value);
});
test('draw scenarios use regularized normal observations, exclude rerolls and stay reproducible',()=>{
  const empty=scenarioWeights(catalogue,{entries:[]});assert.equal(empty.samples,0);assert.equal(new Set(empty.weights).size,1);
  const observed=scenarioWeights(catalogue,{entries:[{blockId:'b0',normal:100,reroll:0},{blockId:'b1',normal:0,reroll:1000},{blockId:null,normal:900,reroll:0}]});
  assert.equal(observed.samples,100);assert.ok(observed.weights[0]>observed.weights[1]);assert.equal(observed.weights[1],observed.weights[2]);
  assert.deepEqual(makeScenarios(catalogue,observed.weights,4,2,87),makeScenarios(catalogue,observed.weights,4,2,87));
});
test('old time settings migrate to the fixed one-second budget without changing game data',()=>{
  const old=initialState();delete old.options.strategyVersion;old.options.timeLimit=15000;old.skills={dot:2,reroll:4};
  const migrated=validateState(old);assert.equal(migrated.options.timeLimit,850);assert.equal(migrated.options.strategyVersion,3);
  for(const key of ['board','blocks','slots','skills','statistics'])assert.deepEqual(migrated[key],old[key]);
  const fast=validateState({...migrated,options:{...migrated.options,timeLimit:800}});assert.equal(fast.options.timeLimit,850);
});
