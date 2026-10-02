import {nextTarget} from './targets.js';

const $=id=>document.getElementById(id);
const ease='cubic-bezier(.16,1,.3,1)';
const visible=rect=>rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;

// Presentation only. Replay, motion and focus never mutate game or persisted data.
export class StudioUI {
  constructor(actions){
    this.actions=actions;this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.animations=new Set();this.lastSlots=[];
    this.reduced.addEventListener('change',()=>{if(this.reduced.matches)this.clearMotion();});
    const reserve=document.createElement('div');reserve.className='skill-reserve';reserve.setAttribute('aria-hidden','true');
    reserve.append(...Array.from({length:7},()=>document.createElement('i')));document.querySelector('.skills').append(reserve);this.reserve=reserve;
    this.resize=new ResizeObserver(()=>this.scheduleFit());this.resize.observe(document.querySelector('.board-stage'));
    $('focus-board').onclick=()=>this.focus();
    $('open-statistics').onclick=()=>this.archive();
    $('play-plan').onclick=()=>this.playing?this.stopPlayback():this.play();
    $('plan-scrubber').oninput=()=>{this.stopPlayback();actions.preview(+$('plan-scrubber').value-1);};
    $('open-command').onclick=()=>this.command();$('close-command').onclick=()=>$('command-dialog').close();
    $('command-dialog').addEventListener('click',event=>{if(event.target===$('command-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
    const commands=[['블록 이름 입력','/',()=>this.search()],['현재 공유 화면 인식','',()=>{if(!$('capture-read').disabled){actions.capture();$('capture-read').click();}}],['배치 추천 찾기','',()=>$('solve').click()],['보드 집중 모드','',()=>this.focus()],['출현 기록 보기','',()=>this.archive()],['마지막 동작 되돌리기','',()=>$('undo').click()]];
    for(const [label,key,run]of commands){const button=document.createElement('button');button.textContent=label;const hint=document.createElement('kbd');hint.textContent=key||'↵';button.append(hint);button.onclick=()=>{$('command-dialog').close();run();};$('command-actions').append(button);}
    document.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if($('command-dialog').open)$('command-dialog').close();else if(!document.querySelector('dialog[open]'))this.command();return;}
      if(document.querySelector('dialog[open]')||event.target.matches('input,select,textarea'))return;
      if(event.key==='/'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();this.search();}
      if(event.key==='Escape'){this.stopPlayback();if(document.body.classList.contains('focus-mode')){event.preventDefault();event.stopImmediatePropagation();this.focus();}}
    });
    document.addEventListener('pointerdown',event=>{if(event.target.closest('.board-cell,.move-button,#solve,#show-all,.mode-tabs,.action-dock,#capture-read,#undo'))this.stopPlayback();},true);
    $('board-grid').addEventListener('pointerover',event=>{const cell=event.target.closest('.board-cell');if(cell)$('board-coordinate').textContent=`${String(+cell.dataset.y+1).padStart(2,'0')} / ${String(+cell.dataset.x+1).padStart(2,'0')}`;});
    $('board-grid').addEventListener('pointerleave',()=>$('board-coordinate').textContent='— / —');
    document.addEventListener('visibilitychange',()=>{if(document.hidden){this.stopPlayback();this.clearMotion();}});
    window.addEventListener('pagehide',()=>{this.stopPlayback();this.clearMotion();this.resize.disconnect();cancelAnimationFrame(this.fitFrame);});
  }
  animate(node,frames,options={}){
    if(this.reduced.matches||document.hidden||!node)return null;
    const animation=node.animate(frames,{duration:440,easing:ease,...options});this.animations.add(animation);
    const done=()=>this.animations.delete(animation);animation.addEventListener('finish',done,{once:true});animation.addEventListener('cancel',done,{once:true});return animation;
  }
  clearMotion(){for(const animation of this.animations)animation.cancel();this.animations.clear();$('motion-layer').replaceChildren();}
  scheduleFit(){cancelAnimationFrame(this.fitFrame);this.fitFrame=requestAnimationFrame(()=>this.fit());}
  fit(){
    if(!this.snapshot||innerWidth<=600)return;
    const {state}=this.snapshot,stage=document.querySelector('.board-stage'),surface=document.querySelector('.board-surface'),style=getComputedStyle(surface);
    const width=stage.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),height=stage.clientHeight-64;
    const size=Math.max(6,Math.min(34,(width-(state.cols-1)*2)/state.cols,(height-(state.rows-1)*2)/state.rows));
    const value=`${Math.floor(size*10)/10}px`;if($('board-grid').style.getPropertyValue('--cell-size')!==value)$('board-grid').style.setProperty('--cell-size',value);
  }
  sync(snapshot){
    if(!snapshot.state)return;
    const {state,result,preview,busy,mode}=snapshot;
    if(result!==this.snapshot?.result)this.stopPlayback();
    document.body.classList.toggle('is-solving',busy);
    $('board-live-state').textContent=busy?'SEARCHING':result?'PLAN READY':mode.startsWith('icon-')?'MARK ABILITY':mode==='place'?'PLACE PIECE':'EDIT MODE';
    const filled=state.board.reduce((sum,row)=>sum+row.toString(2).replaceAll('0','').length,0);
    $('field-density').textContent=`${Math.round(filled/(state.rows*state.cols)*100)}%`;
    const next=nextTarget(state.currentScore);$('target-progress').style.setProperty('--progress',`${state.currentScore==null?0:next?Math.min(100,state.currentScore/next*100):100}%`);
    const selected=state.slots.filter(Boolean).length;
    $('dock-label').textContent=busy?'배치 공간을 비교하고 있습니다':result?.reroll?'실제 바꾸기 결과를 입력하세요':result?.moves.length?'게임에 놓은 뒤 반영하세요':selected===3?'세 조각 준비 완료':`${selected} / 3 조각 선택됨`;
    [...this.reserve.children].forEach((node,i)=>node.classList.toggle('held',i<state.skills.dot+state.skills.reroll));
    $('playback').hidden=busy||!result?.moves.length;
    if(result?.moves.length){$('plan-scrubber').max=result.moves.length;$('plan-scrubber').value=preview>=0?preview+1:0;$('playback-step').textContent=preview>=0?`${preview+1} / ${result.moves.length}`:'전체';}
    if(this.snapshot){
      state.slots.forEach((slot,i)=>{if(slot&&!slot.used&&slot.instanceId!==this.lastSlots[i])this.animate($('tray').children[i],[{transform:'translateY(10px) scale(.94)',opacity:.4},{transform:'none',opacity:1}],{delay:i*35});});
      const old=this.snapshot.state;
      if(state.currentScore!==old.currentScore&&state.currentScore!=null&&old.currentScore!=null){
        const gain=state.currentScore-old.currentScore;$('score-gain').textContent=`${gain>0?'+':''}${gain.toLocaleString()}`;
        const animation=this.animate($('score-gain'),[{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)',offset:.25},{opacity:0,transform:'translateY(-15px)'}],{duration:1150});
        if(animation)animation.onfinish=()=>{$('score-gain').textContent='';};else $('score-gain').textContent='';
      }
      if(result&&result!==this.snapshot.result){
        for(const chip of $('board-grid').querySelectorAll('.recommendation-chip')){const order=Number(chip.parentElement.dataset.steps.split(',')[0])||1;this.animate(chip,[{opacity:.05,transform:'scale(.3)'},{opacity:1,transform:'scale(1)'}],{duration:460,delay:Math.min(220,order*40+(+chip.parentElement.dataset.x+ +chip.parentElement.dataset.y)*3)});}
        [...$('moves').children].forEach((node,i)=>this.animate(node,[{opacity:0,transform:'translateX(14px)'},{opacity:1,transform:'none'}],{delay:i*55}));
      }
    }
    this.lastSlots=state.slots.map(s=>s?.instanceId);this.snapshot={...snapshot,state:{...state,board:state.board.slice()}};this.scheduleFit();
  }
  origin(canvas){
    if(!canvas||this.reduced.matches)return null;
    const rect=canvas.getBoundingClientRect();if(!visible(rect))return null;
    const copy=document.createElement('canvas');copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);return {copy,rect};
  }
  fly(origin,index){
    if(!origin)return;const target=$('tray').children[index]?.querySelector('.shape');if(!target)return;
    const end=target.getBoundingClientRect();if(!visible(end))return;
    const {copy,rect}=origin;copy.className='flying-piece';Object.assign(copy.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});$('motion-layer').append(copy);
    const x=end.x-rect.x,y=end.y-rect.y;
    const animation=this.animate(copy,[{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${x*.55}px,${y*.35-28}px) rotate(-8deg) scale(1.12)`,opacity:1,offset:.5},{transform:`translate(${x}px,${y}px) scale(${end.width/rect.width})`,opacity:0}],{duration:540});
    if(animation){animation.onfinish=()=>copy.remove();animation.oncancel=()=>copy.remove();}else copy.remove();
  }
  commit(result){
    this.stopPlayback();if(this.reduced.matches||!result?.moves?.length)return;
    const rows=new Set(result.moves.flatMap(move=>move.cleared));
    const cells=[...$('board-grid').children].filter(cell=>rows.has(+cell.dataset.y)&&(cell.classList.contains('filled')||cell.classList.contains('recommended')));
    for(const cell of cells.slice(0,120)){
      const rect=cell.getBoundingClientRect();if(!visible(rect))continue;
      const ghost=document.createElement('span');ghost.className='cell-fragment';Object.assign(ghost.style,{left:`${rect.x}px`,top:`${rect.y}px`,width:`${rect.width}px`,height:`${rect.height}px`});$('motion-layer').append(ghost);
      const x=+cell.dataset.x;const animation=this.animate(ghost,[{opacity:.85,transform:'scale(1)'},{opacity:1,transform:'scale(1.1)',offset:.25},{opacity:0,transform:`translateY(-${8+x%3*5}px) scale(.2)`}],{duration:520,delay:x*16});
      if(animation){animation.onfinish=()=>ghost.remove();animation.oncancel=()=>ghost.remove();}else ghost.remove();
    }
    this.animate(document.querySelector('.hand'),[{transform:'translateY(3px)'},{transform:'none'}],{duration:300});
  }
  play(){
    const result=this.snapshot?.result;if(!result?.moves.length)return;
    this.playing=true;$('play-plan').textContent='Ⅱ 정지';$('play-plan').setAttribute('aria-pressed','true');
    let index=0;const step=()=>{if(!this.playing||this.snapshot?.result!==result)return;if(index>=result.moves.length){this.actions.preview(-2);this.stopPlayback();return;}this.actions.preview(index++);this.playTimer=setTimeout(step,850);};step();
  }
  stopPlayback(){clearTimeout(this.playTimer);this.playing=false;$('play-plan').textContent='▶ 재생';$('play-plan').setAttribute('aria-pressed','false');}
  focus(){
    this.stopPlayback();const board=document.querySelector('.board-panel'),before=board.getBoundingClientRect();
    const focused=document.body.classList.toggle('focus-mode');$('focus-board').setAttribute('aria-pressed',String(focused));$('focus-board').title=focused?'전체 화면 보기':'보드 집중 모드';
    this.fit();const after=board.getBoundingClientRect();this.animate(board,[{transform:`translateX(${before.x-after.x}px) scaleX(${before.width/after.width})`,transformOrigin:'left top',opacity:.6},{transform:'none',opacity:1}],{duration:450});
  }
  search(){if(document.body.classList.contains('focus-mode'))this.focus();this.actions.manual();$('search-blocks').focus();$('search-blocks').select();}
  archive(){$('statistics-panel').open=true;document.querySelector('.draw-statistics').scrollIntoView({behavior:this.reduced.matches?'instant':'smooth',block:'start'});}
  command(){if(document.querySelector('dialog[open]'))return;$('command-dialog').showModal();$('command-actions').firstElementChild.focus();}
  statistics(rows,totals){
    const key=JSON.stringify([totals.total,rows.map(r=>[r.blockId,r.name,r.total])]);if(key===this.chartKey)return;this.chartKey=key;
    const chart=$('statistics-chart'),max=Math.max(1,...rows.map(r=>r.total));chart.replaceChildren();
    for(const row of rows){const button=document.createElement('button');button.className='statistics-bar';const percent=totals.total?(row.total/totals.total*100).toFixed(1):'0.0';button.title=`${row.name} · ${row.total.toLocaleString()}회 · ${percent}%`;button.setAttribute('aria-label',`${button.title} 검색`);button.style.setProperty('--bar-height',`${Math.max(2,row.total/max*85)}px`);const bar=document.createElement('i'),name=document.createElement('span'),value=document.createElement('small');name.textContent=row.name;value.textContent=totals.total?`${percent}%`:'—';button.append(value,bar,name);button.onclick=()=>{$('statistics-search').value=row.name;$('statistics-search').dispatchEvent(new Event('input'));};chart.append(button);}
  }
}
