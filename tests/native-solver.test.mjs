import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {solve,place} from '../public/solver.js';
import {nativeInput,nativeStatistics,adaptNativePlan,supportsNative} from '../public/native-solver.js';
import {NATIVE_SETTINGS,nativeEngineStatus,runNativeEngine} from '../public/native-engine.js';
import {initialState} from '../public/state-schema.js';
import {completePlan,applyTargetPlan} from '../public/plan.js';
import {shapeKey} from '../public/library.js';
import {scoreMoves} from '../public/targets.js';

const unit=[[0,0]];
function input(extra={}){
  return {board:Array(16).fill(0),cols:10,pieces:[0,1,2].map(id=>({id,cells:unit})),
    catalogue:[{id:'unit',name:'.',cells:unit}],skills:{dot:0,reroll:0},skillIcons:[],currentScore:0,clearedLines:0,
    options:{rotate:true,reflect:true,gravity:false},...extra};
}
function stateFor(source){return {...initialState(),...source,blocks:source.catalogue,
  slots:source.pieces.map(p=>({instanceId:p.id,blockId:'unit',cells:p.cells,name:'.',used:false}))};}
function pathFor(source,actions){let board=source.board;return {path:actions.map(action=>{
  const next=place(board,10,action.cells,0,0);assert.ok(next);board=next.board;
  return {...action,rows:board,clear:next.cleared};
})};}

test('supplied native binary is unchanged and cannot call any host APIs',async()=>{
  const bytes=await readFile(new URL('../public/native-engine.wasm',import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'c774b91f06593d8c0e20a774b0fcfafd69f56219d7f50a738e275c531d4d7704');
  assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(bytes)),[]);
  assert.equal(nativeEngineStatus().ready,true);
  assert.deepEqual(NATIVE_SETTINGS,{beam:640,probe:32,scenarios:8,finalists:24,open_square:20,
    fragment:8,final_diversity:1,ensemble:true,future_mobility:100,observed_draws:true,affordable_holes:true});
});

test('normal observations map to canonical shapes by stage, without counting rerolls or private names',()=>{
  const source=input({statistics:{entries:[{blockId:'unit',name:'private',normal:45,reroll:900,stages:{1:{normal:10,reroll:100},5:{normal:35,reroll:800}}},{blockId:'deleted',normal:1000,reroll:0}]}});
  const before=structuredClone(source),key=shapeKey(unit),stats=nativeStatistics(source);
  assert.equal(stats.drawStats[1][key],10);assert.equal(stats.drawStats[2][key],45);assert.equal(stats.drawStats[5][key],35);
  assert.equal(stats.observedSamples,45);assert.equal(stats.stageSamples,10);
  assert.doesNotMatch(JSON.stringify(stats),/private|deleted|900|1000/);
  const unknown=nativeStatistics({...source,clearedLines:null});assert.equal(unknown.stage,null);assert.equal(unknown.drawStats[1][key],45);
  assert.deepEqual(source,before);
});

test('only supported dimensions and transformations use the imported engine',()=>{
  assert.equal(supportsNative(input()),true);
  assert.equal(supportsNative(input({cols:9})),false);
  assert.equal(supportsNative(input({options:{rotate:false}})),false);
  assert.equal(supportsNative(input({options:{reflect:false}})),false);
  assert.equal(supportsNative(input({pieces:[{id:0,cells:Array.from({length:6},(_,x)=>[x,0])}]})),false);
  const request=nativeInput(input({skillSpawnRemaining:1,skillIcons:[{x:0,y:0,kind:'dot'}]}));
  assert.equal(request.countdown,255,'unobserved spawns cannot truncate the three-piece recommendation');
  assert.deepEqual(request.icons,[{x:0,y:0,type:'dot'}]);
  assert.deepEqual(request.nativeConfig,NATIVE_SETTINGS);
});

test('native recommendations preserve scoring, original input and completion behavior',()=>{
  const source=input({board:[1022,...Array(15).fill(0)]}),before=structuredClone(source);
  const raw=runNativeEngine(nativeInput(source)),candidate=adaptNativePlan(source,raw);
  assert.equal(raw.engineRevision,'native25');assert.equal(raw.settings.beam,640);
  assert.equal(candidate.depth,3);assert.equal(candidate.score,303);assert.equal(candidate.lines,1);
  const result={...candidate,complete:true,reroll:null};
  const next=completePlan(stateFor(source),result);
  assert.equal(next.currentScore,303);assert.equal(next.clearedLines,1);assert.deepEqual(next.slots,[null,null,null]);
  assert.deepEqual(source,before);
});

test('known acquired dots can be spent later in the same plan and committed once',()=>{
  const source=input({board:[511,...Array(15).fill(0)],skillIcons:[{x:9,y:0,kind:'dot'}]});
  const raw=pathFor(source,[{kind:'piece',slot:0,cells:[[9,0]]},{kind:'dot',cells:[[0,1]]},
    {kind:'piece',slot:1,cells:[[1,1]]},{kind:'piece',slot:2,cells:[[2,1]]}]);
  const candidate=adaptNativePlan(source,raw);assert.equal(candidate.score,354);
  const next=completePlan(stateFor(source),{...candidate,complete:true,reroll:null});
  assert.equal(next.currentScore,354);assert.deepEqual(next.skills,{dot:0,reroll:0});assert.deepEqual(next.skillIcons,[]);
  assert.equal(next.board[1],7);assert.equal(next.skillSpawnRemaining,4,'dots do not advance icon countdown');
});

test('native output cannot invent cells, use pieces twice or overdraw skills',()=>{
  const source=input(),raw=pathFor(source,[{kind:'piece',slot:0,cells:[[0,0]]}]);
  const tampered=structuredClone(raw);tampered.path[0].rows[0]=999;assert.throws(()=>adaptNativePlan(source,tampered));
  const duplicate=pathFor(source,[{kind:'piece',slot:0,cells:[[0,0]]},{kind:'piece',slot:0,cells:[[1,0]]}]);
  assert.throws(()=>adaptNativePlan(source,duplicate));
  assert.throws(()=>adaptNativePlan(source,pathFor(source,[{kind:'dot',cells:[[0,0]]}])));
  assert.throws(()=>adaptNativePlan(source,{...raw,reroll:{slot:0}}));
  assert.throws(()=>adaptNativePlan(source,pathFor(source,[{kind:'piece',slot:0,cells:[[0,0],[1,0]]}])));
});

test('public solver uses native search and keeps manual target stopping points',()=>{
  const source=input({currentScore:99999,targetEnabled:false,manualTargets:[100000]});
  const progress=[],result=solve(source,{onProgress:plan=>progress.push(plan)});
  assert.equal(result.method,'native');assert.equal(result.complete,true);assert.ok(progress.length>=2);
  assert.equal(result.target.hit,100000);
  const next=applyTargetPlan(stateFor(source),result);assert.equal(next.currentScore,100000);
  assert.equal(next.slots.filter(p=>p.used).length,1);
  assert.equal(result.score,scoreMoves(source.currentScore,result.moves,{skills:source.skills}).score);
});

test('full reroll inventory requires a real replacement instead of a false complete plan',()=>{
  const source=input({skills:{dot:0,reroll:7}}),result=solve(source);
  assert.equal(result.complete,false);assert.equal(result.reroll.reason,'capacity');assert.equal(result.moves.length,0);
  assert.equal(result.skillsUsed.reroll,1);assert.equal(result.method,'native');
});
