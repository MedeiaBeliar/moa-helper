import {TARGET_SCORES,SCORE_CAP} from '../public/targets.js';

const targets=new Set(TARGET_SCORES);
const number=value=>Number.isFinite(value)?Math.round(value).toLocaleString('en-US'):'-';
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,'');
const widthOf=text=>Array.from(text).reduce((sum,char)=>{
  const code=char.codePointAt(0);
  return sum+((code>=0x1100&&code<=0x115f)||(code>=0x2e80&&code<=0xa4cf)||
    (code>=0xac00&&code<=0xd7a3)||(code>=0xf900&&code<=0xfaff)||
    (code>=0xfe10&&code<=0xfe6f)||(code>=0xff01&&code<=0xff60)||code>=0x1f300?2:1);
},0);

// A passed target is not a hit. The action ledger is the only hit authority.
export function targetProgress(score,hits=[]){
  const value=Number.isSafeInteger(score)&&score>=0?Math.min(SCORE_CAP,score):null;
  const byScore=new Map();
  for(const item of Array.isArray(hits)?hits:[]){
    const hit=typeof item==='number'?{score:item}:item;
    if(!hit||!targets.has(hit.score))continue;
    const prior=byScore.get(hit.score);
    const safe=hit.canStopBelowSkillCap===true?true:hit.canStopBelowSkillCap===false?false:null;
    byScore.set(hit.score,{score:hit.score,canStopBelowSkillCap:prior?.canStopBelowSkillCap===true||safe===true?true:
      prior?.canStopBelowSkillCap===null||safe===null?null:false});
  }
  const achieved=[...byScore.values()].sort((a,b)=>a.score-b.score);
  const nextTarget=value===null?null:TARGET_SCORES.find(target=>target>value)??null;
  const goalScore=value===null?null:nextTarget??SCORE_CAP;
  return {score:value,nextTarget,goalScore,remaining:goalScore===null?null:Math.max(0,goalScore-value),
    ratio:goalScore===null?0:Math.min(1,value/goalScore),achieved,
    capReached:value!==null&&value>=SCORE_CAP,
    allTargetsPassed:value!==null&&value>=TARGET_SCORES.at(-1)};
}

function wrapLine(text,width){
  const lines=[];let line='';
  for(const word of clean(text).split(/ +/)){
    if(!word)continue;
    if(widthOf(`${line}${line?' ':''}${word}`)<=width){line+=`${line?' ':''}${word}`;continue;}
    if(line){lines.push(line);line='';}
    for(const char of word){
      if(widthOf(line+char)>width){lines.push(line);line='';}
      line+=char;
    }
  }
  if(line||!lines.length)lines.push(line);
  return lines;
}
const gameName=(game,index)=>clean(game.gameId??`G${String(index+1).padStart(2,'0')}`);
function statusText(status){
  return ({running:'실행 중',queued:'대기 중',pending:'대기 중',dead:'사망 확인',
    'stopped-by-user':'사용자 중지 (사망 아님)',error:'오류 (사망 아님)',failed:'오류 (사망 아님)',
    'stopped-after-peer-error':'다른 게임 오류로 중지 (사망 아님)',
    'cap-reached':'50만점 달성',completed:'완료',paused:'일시 대기'})[status]??clean(status??'대기 중');
}

export function renderProgress(snapshot={}, {width=100}={}){
  width=Math.max(12,Math.floor(Number.isFinite(width)?width:100));
  const games=Array.isArray(snapshot.games)?snapshot.games:[],lines=[];
  const add=text=>lines.push(...wrapLine(text,width));
  add(`목표 점수 병렬 테스트 · ${clean(snapshot.runId)||'준비 중'}`);
  add(`동시 계산 상한 ${number(snapshot.limit)}개 · 총 ${number(snapshot.jobs??games.length)}게임 · ${statusText(snapshot.status??'running')}`);
  if(snapshot.maxSpeed)add('최고속도 · 동시 계산 2개 · 휴식·자동 감속 없음');
  const cpu=Number.isFinite(snapshot.cpuPercent)?`${Math.max(0,snapshot.cpuPercent).toFixed(1)}%`:'측정 중';
  const memory=Number.isFinite(snapshot.memoryFreeGiB)?`${snapshot.memoryFreeGiB.toFixed(1)}GiB`:'-';
  add(`전체 CPU ${cpu} · 여유 메모리 ${memory}${snapshot.priority?` · 우선순위 ${clean(snapshot.priority)}`:''}`);
  const progress=games.map(game=>targetProgress(game.score,game.hits));
  let closest=null;
  games.forEach((game,index)=>{
    if(!['running','queued','pending','paused'].includes(game.status)||progress[index].nextTarget===null)return;
    if(closest===null||progress[index].remaining<progress[closest].remaining)closest=index;
  });
  if(closest!==null)add(`목표에 가장 가까운 게임 ${gameName(games[closest],closest)} → ${number(progress[closest].nextTarget)}점 · ${number(progress[closest].remaining)}점 남음 (점수 차이 기준)`);
  add(snapshot.stopAtCap?'자동 목표 ON · 50만점 또는 사망에서 종료 · Ctrl+C 저장 후 중지':'목표·50만점 도달 후에도 사망까지 진행 · Ctrl+C 저장 후 중지');
  for(let index=0;index<games.length;index++){
    const game=games[index],item=progress[index];
    lines.push('');
    const mode=game.mode==='target'?'목표 ON':game.mode==='normal'?'목표 OFF':clean(game.mode||'');
    add(`${gameName(game,index)} ${mode} · 시드 ${clean(game.seed??'-')} · ${statusText(game.status)}`);
    add(`현재 ${number(item.score)}점 · ${number(game.completedBatches??0)}세트 · 추천 평균 ${number(game.timing?.averageMs)}ms`);
    if(item.goalScore===null)add('현재 점수 대기 중');
    else{
      const barWidth=Math.max(4,Math.min(36,width-12));
      const ratio=snapshot.stopAtCap?item.score/SCORE_CAP:item.ratio,filled=Math.floor(ratio*barWidth);
      add(`[${'#'.repeat(filled)}${'-'.repeat(barWidth-filled)}] ${(Math.floor(ratio*1000)/10).toFixed(1)}%`);
      if(snapshot.stopAtCap)add(`최종 목표 500,000점 · ${number(Math.max(0,SCORE_CAP-item.score))}점 남음`);
      if(item.capReached)add(game.status==='running'&&!snapshot.stopAtCap?'50만점 상한 도달 · 사망까지 계속 진행':'50만점 상한 도달');
      else add(`${item.nextTarget===null?'점수 상한':'다음 목표'} ${number(item.goalScore)}점 · ${number(item.remaining)}점 남음`);
    }
    add(item.achieved.length?`도달 기록 ${item.achieved.map(hit=>`[${number(hit.score)}${hit.canStopBelowSkillCap===false?'*':''}]`).join(' ')}`:'도달 기록 없음');
  }
  if(progress.some(item=>item.achieved.some(hit=>hit.canStopBelowSkillCap===false)))add('* 실제 점수 도달 시 보유 스킬 7개; 이후 7개 미만에서 같은 점수 확인 시 해제');
  add(snapshot.stopAtCap?'막대는 50만점까지의 비율입니다. 중간 목표의 정확한 도달 이력은 계속 남습니다.':'막대는 다음 점수까지의 비율입니다. 게임 종료 시점은 예측하지 않습니다.');
  return lines.join('\n');
}

// Only an interactive terminal receives cursor escapes. Redirected output gets
// sparse snapshots, while close always writes the final available state.
export function createProgressDisplay({stream=process.stdout,intervalMs=1000}={}){
  const tty=Boolean(stream.isTTY),delay=Math.max(tty?100:10000,Number(intervalMs)||1000);
  let latest=null,timer=null,closed=false,hidden=false,previousLines=0,lastText=null,lastRender=-Infinity,firstRender=null;
  const restore=()=>{if(hidden){hidden=false;stream.write('\x1b[?25h');}};
  function paint(force=false){
    if(!latest)return;
    const now=Date.now();if(!force&&now-lastRender<delay)return;
    // Keep a column free so terminals never wrap at their right margin.
    let text=renderProgress(latest,{width:Math.max(12,(stream.columns||100)-1)});
    // A cursor cannot move back into terminal scrollback. Page tall views so
    // frequent updates never accumulate duplicate fragments on short windows.
    const rows=Math.max(5,(stream.rows||60)-2),full=text.split('\n');
    if(tty&&!force&&full.length>rows){
      firstRender??=now;const size=rows-1,pages=Math.ceil(full.length/size),page=Math.floor((now-firstRender)/5000)%pages;
      text=[...full.slice(page*size,(page+1)*size),`[${page+1}/${pages}] 5s`].join('\n');
    }
    if(!force&&text===lastText)return;
    if(tty){
      if(!hidden){stream.write('\x1b[?25l');hidden=true;process.once('exit',restore);}
      if(previousLines)stream.write(`\x1b[${Math.min(previousLines,(stream.rows||60)-1)}A\r\x1b[0J`);
      stream.write(`${text}\n`);previousLines=text.split('\n').length;
    }else stream.write(`${lastText===null?'':'\n'}${text}\n`);
    lastText=text;lastRender=now;
  }
  return {
    update(snapshot){
      if(closed)return;latest=snapshot;paint();
      if(!timer){timer=setInterval(()=>paint(),delay);timer.unref?.();}
    },
    close(snapshot){
      if(closed)return;if(snapshot!==undefined)latest=snapshot;
      try{paint(true);}finally{closed=true;if(timer)clearInterval(timer);restore();process.removeListener('exit',restore);}
    },
  };
}
