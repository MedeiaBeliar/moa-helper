import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,validateState} from '../storage.mjs';
import {advanceSpawnRemaining,editSkillIcon,remainingIconOrder} from '../public/abilities.js';
import {completePlan,applyPartialPlan,applyReroll,applyTargetPlan} from '../public/plan.js';
import {stateFromCapture} from '../public/capture-state.js';

test('legacy abilities and spawn countdown stay unknown instead of guessing their ages or progress',()=>{
  const legacy=initialState();delete legacy.skillIconOrder;delete legacy.skillSpawnRemaining;
  legacy.skillIcons=[{x:0,y:0,kind:'dot'},{x:1,y:0,kind:'reroll'}];
  const migrated=validateState(legacy);assert.deepEqual(migrated.skillIconOrder,[]);assert.equal(migrated.skillSpawnRemaining,null);
  for(const value of [0,8,-1,1.5,'3',NaN])assert.throws(()=>validateState({...legacy,skillSpawnRemaining:value}));
  for(const order of [null,['0,0','0,0'],['2,0'],[1]])assert.throws(()=>validateState({...legacy,skillIconOrder:order}));
  assert.equal(advanceSpawnRemaining(null,3),null);
  assert.deepEqual([0,1,2,7,8,14].map(n=>advanceSpawnRemaining(1,n)),[1,7,6,1,7,1]);
});

test('unknown markers require manual removal, while later observed new markers gradually establish order',()=>{
  let state=initialState();
  for(let x=0;x<3;x++)state=editSkillIcon(state,{x,y:0,kind:'dot'}).state;
  const before=structuredClone(state);
  assert.throws(()=>editSkillIcon(state,{x:3,y:0,kind:'dot'},{newlyAppeared:true}),/직접/);
  assert.deepEqual(state,before);
  for(let x=0;x<3;x++){
    state=editSkillIcon(state,{x,y:0,kind:'dot'}).state;
    state=editSkillIcon(state,{x:x+3,y:0,kind:'dot'},{newlyAppeared:true}).state;
  }
  assert.deepEqual(state.skillIconOrder,['3,0','4,0','5,0']);
  state=editSkillIcon(state,{x:3,y:0,kind:'reroll'}).state;
  const added=editSkillIcon(state,{x:6,y:0,kind:'dot'},{newlyAppeared:true});
  assert.deepEqual(added.expired,{x:3,y:0,kind:'reroll'});
  assert.deepEqual(added.state.skillIconOrder,['4,0','5,0','6,0']);
  assert.equal(added.state.currentScore,0);assert.deepEqual(added.state.skills,{dot:0,reroll:0});
  assert.deepEqual(remainingIconOrder(added.state,added.state.skillIcons.slice(1)),['5,0','6,0']);
});

function planFixture(){
  const unit=[[0,0]],state={...initialState(),cols:4,rows:2,board:[0,0],skillSpawnRemaining:2,skills:{dot:1,reroll:1},
    blocks:[{id:'unit',name:'·',cells:unit}],slots:[0,1,2].map(i=>({instanceId:`p${i}`,blockId:'unit',name:'·',cells:unit,used:false}))};
  const moves=[{kind:'dot',cells:unit,x:0,y:1,boardBefore:[0,0]},
    ...[0,1,2].map(i=>({kind:'piece',pieceId:`p${i}`,cells:unit,x:i,y:0,boardBefore:[(1<<i)-1,1]}))];
  return {state,result:{complete:true,moves}};
}
test('confirmed piece placements alone advance the countdown across partial, complete and reroll plans',()=>{
  const {state,result}=planFixture(),before=structuredClone(state);
  const first=applyPartialPlan(state,{complete:false,moves:result.moves.slice(0,2)});
  assert.equal(first.skillSpawnRemaining,1);assert.equal(first.currentScore,2);
  const all=completePlan(state,result),remaining=completePlan(first,{...result,moves:result.moves.slice(2)});
  assert.equal(all.skillSpawnRemaining,6);assert.deepEqual(remaining,all);assert.deepEqual(state,before);
  const rerolled=applyReroll(state,{complete:false,moves:result.moves.slice(0,2),reroll:{pieceId:'p1'}},'unit');
  assert.equal(rerolled.skillSpawnRemaining,1);
  const rerollOnly=applyReroll(state,{complete:false,moves:[],reroll:{pieceId:'p1'}},'unit');assert.equal(rerollOnly.skillSpawnRemaining,2);
});
test('exact target prefixes and screen rereads do not consume unperformed placements',()=>{
  const {state,result}=planFixture();state.currentScore=111110;
  result.target={currentScore:111110,hit:111111,hitStep:1};
  const atDot=applyTargetPlan(state,result);assert.equal(atDot.skillSpawnRemaining,2);
  state.currentScore=111109;result.target={currentScore:111109,hit:111111,hitStep:2};
  assert.equal(applyTargetPlan(state,result).skillSpawnRemaining,1);
  const observation={safe:true,board:state.board,pieces:state.slots.map(s=>({status:'ready',cells:s.cells}))};
  assert.equal(stateFromCapture(state,observation,()=>String(Math.random())).skillSpawnRemaining,2);
});
