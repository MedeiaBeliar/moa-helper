import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {initialState,validateState,createStore} from '../storage.mjs';
import {completePlan,applyPartialPlan,applyTargetPlan,applyReroll,isOrderIndependent} from '../public/plan.js';
import {SCORE_CAP,TARGET_SCORES,isTargetScore,nextTarget,addScore,validateSkillIcons,collectSkillIcons,scoreMoves,targetPath,activeTargets,validateManualTargets} from '../public/targets.js';
import {resetGameState} from '../public/game-state.js';

const unit=[[0,0]];
test('custom targets persist independently, combine without duplicates and validate before saving',()=>{
  const clean=validateState({...initialState(),targetEnabled:false,manualTargets:[500000,321,100000,321],quickInput:true});
  assert.deepEqual(clean.manualTargets,[321,100000,500000]);assert.equal(clean.quickInput,true);
  assert.deepEqual(activeTargets(clean),clean.manualTargets);
  assert.deepEqual(activeTargets({...clean,targetEnabled:true}),[321,...TARGET_SCORES,500000]);
  assert.equal(nextTarget(100001,activeTargets(clean)),500000);
  assert.deepEqual(validateManualTargets(),[]);
  for(const manualTargets of [null,'123',[0],[-1],[1.1],['123'],[500001],Array(101).fill(123)])assert.throws(()=>validateState({...clean,manualTargets}));
  assert.throws(()=>validateState({...clean,quickInput:'yes'}));
  const legacy={...clean};delete legacy.manualTargets;delete legacy.quickInput;
  assert.deepEqual(validateState(legacy).manualTargets,[]);assert.equal(validateState(legacy).quickInput,false);
});

test('custom target confirmation replays the prefix and rejects a removed target',()=>{
  const {state,result}=fixture({currentScore:110759});state.targetEnabled=false;state.manualTargets=[111110,123456];result.target.hit=111110;
  const next=applyTargetPlan(state,result);assert.equal(next.currentScore,111110);assert.equal(next.slots.filter(s=>s.used).length,1);
  assert.throws(()=>applyTargetPlan({...state,manualTargets:[]},result),/목표 점수/);
});

test('game reset clears the entire run without altering the library, statistics or preferences',()=>{
  const state={...fixture().state,clearedLines:103,skills:{dot:3,reroll:2},skillSpawnRemaining:2,skillIconOrder:['0,0'],manualTargets:[111110],quickInput:true};
  state.statistics={entries:[{blockId:'unit',name:'·',normal:17,reroll:2}]};const before=structuredClone(state);
  const reset=resetGameState(state);assert.deepEqual(state,before);
  assert.deepEqual(reset.board,Array(state.rows).fill(0));assert.equal(reset.currentScore,0);assert.equal(reset.clearedLines,0);
  assert.deepEqual(reset.skills,{dot:0,reroll:0});assert.deepEqual(reset.slots,[null,null,null]);
  assert.deepEqual(reset.skillIcons,[]);assert.deepEqual(reset.skillIconOrder,[]);assert.equal(reset.skillSpawnRemaining,7);
  for(const key of ['blocks','statistics','options','cols','rows','manualTargets','targetEnabled','quickInput'])assert.deepEqual(reset[key],state[key]);
  validateState(reset);
});
function fixture({currentScore=110760,kind='dot'}={}){
  const state={...initialState(),cols:4,rows:3,board:[7,0,0],currentScore,
    skillIcons:[{x:0,y:0,kind},{x:2,y:2,kind:'reroll'}],
    blocks:[{id:'unit',name:'·',cells:unit},{id:'pair',name:'ㅡ',cells:[[0,0],[1,0]]}],
    slots:[0,1,2].map(i=>({instanceId:`p${i}`,blockId:'unit',name:'·',cells:unit,used:false}))};
  const moves=[
    {pieceId:'p0',cells:unit,x:3,y:0,boardBefore:[7,0,0],cleared:[0]},
    {pieceId:'p1',cells:unit,x:0,y:1,boardBefore:[0,0,0],cleared:[]},
    {pieceId:'p2',cells:unit,x:1,y:1,boardBefore:[0,1,0],cleared:[]}
  ];
  return {state,result:{complete:true,lines:1,moves,target:{currentScore,hit:111111,hitStep:1,status:'hit'}}};
}

test('the automatic goal list retains every target from 100000 and excludes all lower scores',()=>{
  assert.deepEqual(TARGET_SCORES,[100000,111111,120200,123456,150000,200000,211000,211211,222222,250000,300000,333333,350000,400000,444444,450000]);
  assert.ok(TARGET_SCORES.every(score=>score>=100000));
  for(const score of [0,69739,...Array.from({length:10},(_,i)=>69740+i),77777,88888,99999])assert.equal(isTargetScore(score),false);
  assert.equal(isTargetScore(100000),true);assert.equal(isTargetScore(100001),false);
  assert.equal(nextTarget(0),100000);assert.equal(nextTarget(99999),100000);assert.equal(nextTarget(100000),111111);assert.equal(nextTarget(450000),null);assert.equal(nextTarget(null),null);
});

test('score arithmetic preserves unknown scores, validates manual corrections, and caps at 500000',()=>{
  assert.equal(SCORE_CAP,500000);assert.equal(addScore(499999,351),500000);
  assert.equal(addScore(null,351),null);assert.equal(addScore(111111,0),111111);
  for(const invalid of [-1,500001,1.5,NaN])assert.throws(()=>addScore(invalid,1));
  for(const invalid of [-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>addScore(null,invalid));
});

test('ability markers validate kind, board bounds, uniqueness and the three-marker limit',()=>{
  const icons=[{x:0,y:0,kind:'dot',extra:'ignored'},{x:3,y:2,kind:'reroll'}];
  const clean=validateSkillIcons(icons,4,3);
  assert.deepEqual(clean,[{x:0,y:0,kind:'dot'},{x:3,y:2,kind:'reroll'}]);assert.notEqual(clean[0],icons[0]);
  assert.deepEqual(validateSkillIcons(undefined,4,3),[]);
  for(const invalid of [null,{},[...icons,{x:0,y:0,kind:'reroll'}],
    [{x:-1,y:0,kind:'dot'}],[{x:4,y:0,kind:'dot'}],[{x:0,y:3,kind:'dot'}],
    [{x:0.5,y:0,kind:'dot'}],[{x:0,y:0,kind:'unknown'}],
    Array.from({length:4},(_,x)=>({x,y:0,kind:'dot'}))])assert.throws(()=>validateSkillIcons(invalid,4,3));
});

test('legacy saves migrate to an unknown current score without guessing from previous placements',()=>{
  const legacy=initialState();delete legacy.currentScore;delete legacy.targetEnabled;delete legacy.skillIcons;
  legacy.board[0]=1;legacy.clearedLines=87;
  const clean=validateState(legacy);
  assert.equal(clean.currentScore,null);assert.equal(clean.targetEnabled,true);assert.deepEqual(clean.skillIcons,[]);
  assert.equal(clean.clearedLines,87);assert.equal(clean.board[0],1);
  for(const currentScore of [-1,500001,0.5,'111111'])assert.throws(()=>validateState({...legacy,currentScore}));
  assert.throws(()=>validateState({...legacy,targetEnabled:'false'}));
  assert.throws(()=>validateState({...legacy,skillIcons:[{x:20,y:0,kind:'dot'}]}));
});

test('a temporary save reloads score, disabled target mode and manually marked abilities',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'moa-target-state-'));
  try{
    const store=createStore(directory),state=fixture().state;
    state.skillIconOrder=['2,2'];state.skillSpawnRemaining=3;
    state.targetEnabled=false;const before=structuredClone(state);
    await store.write(state);const restored=await store.read();
    assert.equal(restored.currentScore,110760);assert.equal(restored.targetEnabled,false);
    assert.deepEqual(restored.skillIcons,state.skillIcons);assert.deepEqual(restored.board,state.board);
    assert.deepEqual(restored.skillIconOrder,['2,2']);assert.equal(restored.skillSpawnRemaining,3);
    assert.deepEqual(state,before);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('only markers in removed rows are acquired, and full-capacity acquisitions disappear',()=>{
  const icons=[{x:0,y:0,kind:'dot'},{x:1,y:0,kind:'reroll'},{x:2,y:2,kind:'dot'}];
  const collected=collectSkillIcons(icons,[0],6);
  assert.deepEqual(collected.acquired,[icons[0]]);assert.deepEqual(collected.icons,[icons[2]]);
  assert.equal(collected.held,7);assert.equal(collected.score,50);
  const full=collectSkillIcons(icons,[0],7);
  assert.deepEqual(full.acquired,[]);assert.deepEqual(full.icons,[icons[2]]);assert.equal(full.score,0);
  assert.deepEqual(icons.map(i=>i.y),[0,0,2]);
});

test('dot spending earns one placement point and precedes collection',()=>{
  const icons=[{x:1,y:0,kind:'reroll'}],moves=[{kind:'dot',cells:unit,cleared:[0]}];
  const scored=scoreMoves(100,moves,{skills:{dot:1,reroll:6},skillIcons:icons});
  assert.equal(scored.placementScore,1);assert.equal(scored.lineScore,300);assert.equal(scored.acquisitionScore,50);
  assert.equal(scored.after,451);assert.equal(scored.held,7);assert.deepEqual(scored.skillsAfter,{dot:0,reroll:7});
  assert.deepEqual(scored.icons,[]);assert.deepEqual(scored.moves[0].acquiredIcons,icons);
  assert.throws(()=>scoreMoves(0,moves,{skills:{dot:0,reroll:1}}));
});

test('known acquisition is counted once and caller supplied score fields cannot inflate the score',()=>{
  const icons=[{x:0,y:0,kind:'dot'}];
  const moves=[{cells:[[0,0],[0,1]],cleared:[0,1],score:99999,acquisitionScore:9999},
    {cells:unit,cleared:[0],score:99999}];
  const scored=scoreMoves(100,moves,{skillIcons:icons});
  assert.equal(scored.placementScore,3);assert.equal(scored.lineScore,1500);assert.equal(scored.acquisitionScore,50);
  assert.equal(scored.after,1653);assert.equal(scored.acquiredCount,1);assert.equal(scored.moves[1].acquisitionScore,0);
  assert.deepEqual(scored.skillsAfter,{dot:1,reroll:0});assert.equal(moves[0].score,99999);
  assert.equal(scoreMoves(null,moves,{skillIcons:icons}).after,null);
});

test('complete and partial plans recompute score from actual clears and keep marker acquisition atomic',()=>{
  const {state,result}=fixture(),before=structuredClone(state);
  result.moves[0]={...result.moves[0],score:123456,cleared:[],acquisitionScore:9999};
  const partial=applyPartialPlan(state,{...result,complete:false,target:undefined,moves:result.moves.slice(0,1)});
  assert.equal(partial.currentScore,111111);assert.equal(partial.clearedLines,1);assert.deepEqual(partial.skills,{dot:1,reroll:0});
  assert.deepEqual(partial.skillIcons,[state.skillIcons[1]]);assert.deepEqual(partial.slots.map(s=>s.used),[true,false,false]);
  const finished=completePlan(partial,{...result,moves:result.moves.slice(1)}),direct=completePlan(state,result);
  assert.equal(finished.currentScore,111113);assert.deepEqual(finished.slots,[null,null,null]);
  assert.deepEqual(finished,direct);assert.equal(direct.statistics.entries[0].normal,3);
  assert.deepEqual(state,before);
});

test('a reroll after a known clear spends the acquired reroll and records the actual replacement only once',()=>{
  const {state,result}=fixture({kind:'reroll'}),before=structuredClone(state);
  const next=applyReroll(state,{complete:false,moves:result.moves.slice(0,1),reroll:{pieceId:'p1'}},'pair');
  assert.equal(next.currentScore,111111);assert.deepEqual(next.skills,{dot:0,reroll:0});assert.equal(next.clearedLines,1);
  assert.deepEqual(next.skillIcons,[state.skillIcons[1]]);assert.equal(next.slots[0].used,true);
  assert.equal(next.slots[1].blockId,'pair');assert.equal(next.slots[1].used,false);assert.equal(next.slots[2].used,false);
  assert.equal(next.statistics.entries.find(e=>e.blockId==='unit').normal,3);
  assert.equal(next.statistics.entries.find(e=>e.blockId==='pair').reroll,1);assert.deepEqual(state,before);
});

test('a safe exact target applies only the prefix and retains the unused pieces and statistics',()=>{
  const {state,result}=fixture(),before=structuredClone(state),next=applyTargetPlan(state,result);
  assert.equal(next.currentScore,111111);assert.deepEqual(next.board,[0,0,0]);
  assert.deepEqual(next.slots.map(s=>s.used),[true,false,false]);assert.deepEqual(next.skills,{dot:1,reroll:0});
  assert.equal(next.statistics.entries[0].normal,3);assert.deepEqual(next.skillIcons,[state.skillIcons[1]]);
  const resumed=completePlan(next,{...result,moves:result.moves.slice(1)});
  assert.equal(resumed.currentScore,111113);assert.equal(resumed.statistics.entries[0].normal,3);assert.deepEqual(state,before);
});

test('an exact target reached by the last piece clears the tray normally',()=>{
  const {state,result}=fixture({currentScore:110758});result.target.hitStep=3;
  const next=applyTargetPlan(state,result);
  assert.equal(next.currentScore,111111);assert.deepEqual(next.slots,[null,null,null]);
});

test('target acceptance rejects stale scores, invented bonuses and invalid full continuations without mutating state',()=>{
  const {state,result}=fixture(),before=structuredClone(state);
  assert.throws(()=>applyTargetPlan({...state,currentScore:110759},result));
  assert.throws(()=>applyTargetPlan(state,{...result,target:{...result.target,hit:120200}}));
  assert.throws(()=>applyTargetPlan(state,{...result,target:{...result.target,hitStep:0}}));
  assert.throws(()=>applyTargetPlan(state,{...result,complete:false}));
  assert.throws(()=>applyTargetPlan(state,{...result,moves:result.moves.slice(0,1)}));
  const invalid=structuredClone(result);invalid.moves[2].x=0;
  assert.throws(()=>applyTargetPlan(state,invalid),'the accepted prefix must have a legal full-batch continuation');
  const noMarker={...state,skillIcons:[]};assert.throws(()=>applyTargetPlan(noMarker,result));
  assert.deepEqual(state,before);
});

test('a one-point dot reaches the target while bringing newly filled inventory below seven',()=>{
  const {state,result}=fixture({currentScore:110759,kind:'reroll'});state.skills={dot:1,reroll:5};
  const dot={kind:'dot',cells:unit,x:0,y:2,boardBefore:[0,0,0],cleared:[]};
  result.moves=[result.moves[0],dot,{...result.moves[1],boardBefore:[0,0,1]}, {...result.moves[2],boardBefore:[0,1,1]}];
  assert.throws(()=>applyTargetPlan(state,result));
  result.target.hitStep=2;
  const next=applyTargetPlan(state,result);
  assert.equal(next.currentScore,111111);assert.deepEqual(next.skills,{dot:0,reroll:6});
  assert.deepEqual(next.slots.map(s=>s.used),[true,false,false]);assert.deepEqual(next.board,[0,0,1]);
  const scored=scoreMoves(state.currentScore,result.moves,{skills:state.skills,skillIcons:state.skillIcons});
  assert.equal(targetPath(state.currentScore,scored.moves).hitStep,2);
  // Starting one point higher hits the goal with seven skills; spending the
  // dot then overshoots it and must not be reported as a valid goal stop.
  const higher={...state,currentScore:110760};
  const overshoot={...result,target:{...result.target,currentScore:110760}};
  assert.throws(()=>applyTargetPlan(higher,overshoot));
  const higherMoves=scoreMoves(higher.currentScore,result.moves,{skills:state.skills,skillIcons:state.skillIcons}).moves;
  assert.equal(higherMoves[1].scoreAfter,111112);
  assert.equal(targetPath(higher.currentScore,higherMoves).hit,null);
});

test('target paths do not re-hit an existing score or claim an exact score from unknown input',()=>{
  const dot={kind:'dot',cells:unit,cleared:[],heldSkills:5};
  assert.equal(targetPath(111111,[dot]).hit,null);assert.equal(targetPath(null,[dot]).hit,null);
  assert.equal(targetPath(111111,[dot]).after,111112);
  assert.equal(targetPath(111110,[dot]).hit,111111);
  assert.equal(targetPath(499999,[dot,dot]).after,500000);
  const independent={complete:true,lines:0,moves:[{cells:unit,x:0,y:0,cleared:[]}],target:{hit:100000}};
  assert.equal(isOrderIndependent(independent),false);
  assert.equal(isOrderIndependent({...independent,target:{hit:null}}),true);
});
