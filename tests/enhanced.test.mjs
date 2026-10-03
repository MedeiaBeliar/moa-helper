import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {solve,place,variants} from '../public/solver.js';
import {createEvaluator,scenarioWeights,makeScenarios,preparePolicyCatalogue,mobilityReport,expectedPlacementValue,restartAssessment,policyBoardKey} from '../public/policy.js';
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
    assert.equal(result.complete,false);assert.equal(result.reroll.reason,'capacity');assert.equal(result.moves.length,0);
    assert.equal(result.skillsUsed.dot,0,'preserve scarce dots by spending a reroll at capacity');
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

test('survival evaluation preserves empty rows instead of spreading equal occupancy',()=>{
  const evaluate=createEvaluator(6),compact=[15,15,0,0],spread=[3,3,3,3];
  assert.ok(evaluate(compact)>evaluate(spread));
  assert.ok(evaluate([0,0,0,0])>evaluate(compact));
  assert.equal(evaluate(compact),evaluate(compact.slice().reverse()),'top and bottom have equal strategic value');
});

test('policy symmetry preserves probability-weighted evaluations and respects disabled transforms',()=>{
  const boards=[[3,8,6,2],[12,1,6,4],[2,6,8,3],[4,6,1,12]],evaluate=createEvaluator(4);
  const shapes=[{cells:[[0,0],[0,1],[1,1]]},{cells:[[0,0],[1,0],[2,0]]}],weights=[8,2];
  const prepared=preparePolicyCatalogue(shapes,4,4),key=policyBoardKey(boards[0],4);
  const original=mobilityReport(boards[0],4,prepared,weights);
  for(const board of boards){
    assert.equal(policyBoardKey(board,4),key);assert.equal(evaluate(board),evaluate(boards[0]));
    const report=mobilityReport(board,4,prepared,weights);
    assert.deepEqual(report.counts,original.counts);assert.ok(Math.abs(report.value-original.value)<1e-9);
    const future=expectedPlacementValue(board,4,prepared,weights,evaluate);
    assert.equal(future.value,expectedPlacementValue(boards[0],4,prepared,weights,evaluate).value);
  }
  assert.notEqual(policyBoardKey([1,0],3,{rotate:false,reflect:false}),policyBoardKey([4,0],3,{rotate:false,reflect:false}));
  assert.notEqual(policyBoardKey([1,0],3,{rotate:false}),policyBoardKey([0,1],3,{rotate:false}));
  assert.equal(policyBoardKey([1,0],3,{reflect:false}),policyBoardKey([0,4],3,{reflect:false}));
});

test('whole-board repair debt detects rare-hole dependence even when all shapes fit elsewhere',()=>{
  const shapes=[{id:'unit',cells:[[0,0]]},{id:'square',cells:[[0,0],[1,0],[0,1],[1,1]]}];
  const prepared=preparePolicyCatalogue(shapes,5,5),board=[31,27,31,0,0];
  const rare=mobilityReport(board,5,prepared,[1,99]),common=mobilityReport(board,5,prepared,[99,1]);
  assert.equal(rare.deadTypes,0);assert.equal(common.deadTypes,0);
  assert.ok(rare.repairDebt>common.repairDebt);
  const before=board.slice(),evaluate=createEvaluator(5);
  assert.ok(Number.isFinite(evaluate(board)));assert.deepEqual(board,before);
});

test('full-distribution expectation matches independent placement enumeration and weighted lower tail',()=>{
  const blocks=[{cells:[[0,0]]},{cells:[[0,0],[1,0],[0,1],[1,1]]},{cells:[[0,0],[1,0],[2,0]]}];
  const board=[5,3,0],before=board.slice(),weights=[2,3,5],evaluate=createEvaluator(3);
  const prepared=preparePolicyCatalogue(blocks,3,3,{rotate:false,reflect:false});
  const values=blocks.map(block=>{
    let best=-20000+evaluate(board);
    for(let y=0;y<3;y++)for(let x=0;x<3;x++){
      const moved=place(board,3,block.cells,x,y);if(moved)best=Math.max(best,block.cells.length+300*moved.cleared.length**2+evaluate(moved.board));
    }
    return best;
  });
  const mean=values.reduce((sum,value,i)=>sum+value*weights[i]/10,0);
  const ordered=values.map((value,i)=>({value,probability:weights[i]/10})).sort((a,b)=>a.value-b.value);
  let left=.25,tail=0;for(const item of ordered){const amount=Math.min(left,item.probability);tail+=amount*item.value;left-=amount;}
  const result=expectedPlacementValue(board,3,prepared,weights,evaluate);
  assert.ok(Math.abs(result.mean-mean)<1e-9);assert.ok(Math.abs(result.lowerQuartile-tail/.25)<1e-9);
  assert.ok(Math.abs(result.value-(.55*mean+.45*tail/.25))<1e-9);assert.deepEqual(board,before);
  assert.equal(expectedPlacementValue(board,3,prepared,weights,evaluate,performance.now()-1),null);
});

test('restart advice requires several structural symptoms and respects available recovery',()=>{
  const board=Array(16).fill(1015),before=board.slice(),report={deadTypes:8,blockedMass:.45,repairDebt:5,counts:Array(19).fill(0)};
  const advice=restartAssessment(board,10,report,0);
  assert.equal(advice.recommended,true);assert.equal(advice.level,'reset');assert.equal(advice.occupied,144);
  assert.equal(advice.basis,'after-plan');assert.equal(advice.blockedTypes,8);
  for(const skills of [2,5,7])assert.equal(restartAssessment(board,10,report,skills).recommended,false);
  assert.equal(restartAssessment(board,10,report,0,{pendingReroll:true}).recommended,false);
  assert.equal(restartAssessment(Array(16).fill(0),10,report,0).recommended,false);
  assert.equal(restartAssessment(board,10,{...report,blockedMass:.02},0).recommended,false);
  assert.equal(restartAssessment(board,10,{...report,repairDebt:0},0).recommended,false);
  assert.deepEqual(board,before);
  const trap={...report,minFits:0,repairDebt:10};
  assert.equal(restartAssessment(board,10,trap,5,{dotSkills:0}).recommended,true,'rerolls alone do not repair a board dominated by rare holes');
  assert.equal(restartAssessment(board,10,trap,5,{dotSkills:0,pendingReroll:true}).recommended,false,'wait for the actual reroll before judging the remaining hand');
  assert.equal(restartAssessment(board,10,trap,5,{dotSkills:2}).recommended,false);
  assert.equal(restartAssessment(board,10,trap,5,{dotSkills:0}).dotSkills,0);
  assert.equal(restartAssessment(board,10,{...trap,blockedMass:0},5,{dotSkills:0}).recommended,false,'earlier recoverable cavities are not reset recommendations');
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

test('stage probabilities shrink toward overall normal draws and exclude reroll, unknown and deleted identities',()=>{
  const blocks=[{id:'a'},{id:'b'}],statistics={entries:[
    {blockId:'a',normal:99,reroll:0,stages:{1:{normal:90,reroll:0},5:{normal:9,reroll:0}}},
    {blockId:'b',normal:99,reroll:900,stages:{1:{normal:9,reroll:0},5:{normal:90,reroll:900}}},
    {blockId:null,normal:10000,stages:{5:{normal:10000}}},
    {blockId:'deleted',normal:10000,stages:{5:{normal:10000}}}
  ]},before=structuredClone(statistics);
  const early=scenarioWeights(blocks,statistics,{stage:1}),late=scenarioWeights(blocks,statistics,{stage:5});
  assert.deepEqual(early.weights,[105,24]);assert.deepEqual(late.weights,[24,105]);
  assert.equal(late.samples,198);assert.equal(late.stageSamples,99);
  assert.equal(late.basis,'stage-with-overall-prior');
  for(const stage of [null,3,undefined]){
    const fallback=scenarioWeights(blocks,statistics,{stage});assert.deepEqual(fallback.weights,[100,100]);assert.equal(fallback.basis,'overall');
  }
  const reroll=scenarioWeights(blocks,statistics,{stage:5,source:'reroll'});
  assert.equal(reroll.samples,900);assert.ok(reroll.probabilities[1]>.98);
  assert.deepEqual(statistics,before);
});

test('weighted placement space protects the frequently drawn shape without declaring rare shapes impossible to draw',()=>{
  const blocks=[{id:'horizontal',cells:[[0,0],[1,0],[2,0]]},{id:'vertical',cells:[[0,0],[0,1],[0,2]]}];
  const prepared=preparePolicyCatalogue(blocks,4,4,{rotate:false,reflect:false});
  const horizontal=[15,0,15,0],vertical=[5,5,5,5];
  const h=mobilityReport(horizontal,4,prepared,[90,10]),v=mobilityReport(vertical,4,prepared,[90,10]);
  assert.equal(h.deadTypes,v.deadTypes);assert.ok(h.value>v.value);
  assert.equal(h.blockedMass,.1);assert.equal(v.blockedMass,.9);
  assert.ok(mobilityReport(vertical,4,prepared,[10,90]).value>mobilityReport(horizontal,4,prepared,[10,90]).value);
  const unseen=scenarioWeights(blocks,{entries:[{blockId:'horizontal',normal:5000,stages:{5:{normal:5000}}}]},{stage:5});
  assert.ok(unseen.probabilities[1]>0,'unseen shapes retain a nonzero prior');
});

test('recommendations respond to stage records even when there is no time for sampled lookahead',async()=>{
  const {solveFast}=await import('../public/fast.js');
  const blocks=[{id:'a',cells:[[0,0],[1,0],[2,0]]},{id:'b',cells:[[0,0],[0,1],[0,2]]},{id:'u',cells:[[0,0]]}];
  const statistics={entries:[{blockId:'a',normal:1000,stages:{1:{normal:1000},5:{normal:0}}},{blockId:'b',normal:1000,stages:{1:{normal:0},5:{normal:1000}}}]};
  const input={board:[13,6,7,1],cols:4,pieces:[{id:'p',cells:[[0,0]]}],catalogue:blocks,statistics,skills:{dot:0,reroll:0},options:{rotate:false,reflect:false,timeLimit:100}};
  const early=solveFast({...input,clearedLines:0}),late=solveFast({...input,clearedLines:151});
  assert.equal(early.complete,true);assert.equal(late.complete,true);
  assert.equal(early.strategy.tested,0);assert.equal(late.strategy.tested,0);
  assert.equal(early.strategy.stage,1);assert.equal(late.strategy.stage,5);
  assert.equal(late.strategy.observedSamples,2000);assert.equal(late.strategy.stageSamples,1000);
  const prepared=preparePolicyCatalogue(blocks,4,4,input.options),a=early.moves.at(-1).boardAfter,b=late.moves.at(-1).boardAfter;
  const evaluate=createEvaluator(4),value=(result,board,stage)=>{
    const weights=scenarioWeights(blocks,statistics,{stage}).weights;
    return result.score+expectedPlacementValue(board,4,prepared,weights,evaluate).value+mobilityReport(board,4,prepared,weights).value;
  };
  assert.ok(value(early,a,1)>value(late,b,1));assert.ok(value(late,b,5)>value(early,a,5));
});

test('next-hand evaluation changes stage on the exact cleared-line boundaries',async()=>{
  const {solveFast}=await import('../public/fast.js');
  for(const [lines,stage]of [[30,1],[60,2],[100,3],[150,4]]){
    const input={board:[3,0],cols:3,pieces:[{id:'p',cells:[[0,0]]}],catalogue:[{id:'a',cells:[[0,0]]}],statistics:{entries:[{blockId:'a',normal:100,stages:{[stage]:{normal:40},[stage+1]:{normal:60}}}]},clearedLines:lines,skills:{dot:0,reroll:0},options:{timeLimit:100}};
    const result=solveFast(input);assert.equal(result.complete,true);assert.equal(result.lines,1);
    assert.equal(result.strategy.stage,stage);assert.equal(result.strategy.nextStage,stage+1);assert.equal(result.strategy.nextStageSamples,60);
  }
});

test('a blocked next identity retains its probability mass in the full-distribution comparison',async()=>{
  const {solveFast}=await import('../public/fast.js');
  const blocks=[{id:'a',cells:[[0,0],[1,0],[2,0]]},{id:'b',cells:[[0,0],[0,1],[0,2]]},{id:'u',cells:[[0,0]]}];
  const input={board:[3,8,6,2],cols:4,pieces:[{id:'p',cells:[[0,0]]}],catalogue:blocks,clearedLines:151,skills:{dot:0,reroll:0},
    statistics:{entries:blocks.map((b,i)=>({blockId:b.id,normal:i===2?40:800,stages:{5:{normal:i===2?20:400}}}))},options:{rotate:false,reflect:false,timeLimit:850}};
  const result=solveFast(input);assert.equal(result.complete,true);
  assert.ok(result.strategy.enumeratedCandidates>=2);assert.equal(result.strategy.unknown,0);
  const blocked=[5,5,5,5],prepared=preparePolicyCatalogue(blocks,4,4,input.options),evaluate=createEvaluator(4);
  const bad=expectedPlacementValue(blocked,4,prepared,[999,1,1],evaluate),good=expectedPlacementValue(blocked,4,prepared,[1,1,999],evaluate);
  assert.ok(bad.value<good.value-10000,'blocked horizontal draws are losses, not omitted observations');
});
