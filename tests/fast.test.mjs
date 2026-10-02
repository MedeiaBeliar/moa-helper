import test from 'node:test';
import assert from 'node:assert/strict';
import {solve} from '../public/solver.js';
import {solveFast} from '../public/fast.js';
import {initialState,validateState} from '../storage.mjs';
import {fixtures,inputFor} from './speed-fixtures.mjs';
import {assertPlan} from './speed-assertions.mjs';
test('fast mode emits legal complete plans and honors seven-skill reserve',()=>{
  for(const fixture of fixtures){
    const input=inputFor(fixture);input.options.timeLimit=200;
    let updates=0;const result=solveFast(input,{onProgress:r=>{assertPlan(input,r);updates++;}});
    assertPlan(input,result);assert.ok(updates);
    assert.equal(result.method,'fast');
    if(fixture.name==='seven-rerolls')assert.equal(result.reroll.reason,'capacity');
    else assert.equal(result.complete,true,fixture.name);
  }
});
test('fast rescue uses multiple dots to recover an otherwise impossible piece',()=>{
  const input={board:[6,6],cols:3,pieces:[{id:'p',cells:[[0,0],[1,0],[0,1],[1,1]]}],skills:{dot:2,reroll:0},catalogue:[],options:{rotate:false,reflect:false,timeLimit:500}};
  const result=solveFast(input);assertPlan(input,result);assert.equal(result.complete,true);assert.equal(result.skillsUsed.dot,2);
});
test('no legal move is reported as incomplete, never a invented placement',()=>{
  const input={board:[5,10,5,10],cols:4,pieces:[{id:0,cells:[[0,0],[1,0],[0,1],[1,1]]}],skills:{dot:0,reroll:0},options:{timeLimit:100}};
  const result=solveFast(input);assertPlan(input,result);assert.equal(result.complete,false);assert.equal(result.moves.length,0);
});
test('retired profiles migrate to the one-second solver without changing game data',()=>{
  for(const profile of ['original','fast','standard','unrecognized',undefined]){
    const state=initialState();state.options.solverProfile=profile;
    state.options.timeLimit=8000;state.options.strategyVersion=2;
    const restored=validateState(state);assert.equal(restored.options.solverProfile,'fast');
    assert.equal(restored.options.timeLimit,850);assert.equal(restored.options.strategyVersion,3);
    for(const key of ['board','blocks','slots','skills','statistics'])assert.deepEqual(restored[key],state[key]);
  }
});
test('public entry always uses the one-second solver despite old profile and engine settings',()=>{
  for(const solverProfile of ['original','standard','fast',undefined]){
    const input={board:[0,0],cols:3,pieces:[{id:'p',cells:[[0,0]]}],skills:{dot:0,reroll:0},
      options:{solverProfile,engine:'legacy',lookAhead:false,timeLimit:8000}};
    const result=solve(input);assertPlan(input,result);assert.equal(result.method,'fast');assert.equal(result.complete,true);
  }
  // Timing is measured separately in a serial process; parallel unit tests
  // intentionally do not assert a wall-clock performance threshold.
});
