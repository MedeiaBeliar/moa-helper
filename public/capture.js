import {t} from './i18n.js';
import {detectBoards,defaultSlots,recognize,validRect} from './vision.js';
import {overlayCells,isOrderIndependent} from './plan.js';

const $=id=>document.getElementById(id),CACHE='moa-capture-regions-v1';
export class ScreenCapture {
  constructor(callbacks){
    this.callbacks=callbacks;this.frame=document.createElement('canvas');this.video=$('capture-video');
    this.video.muted=true;this.video.playsInline=true;this.token=0;this.imageRequest=0;this.active=false;this.hasFrame=false;
    this.canvas=$('capture-canvas');this.sensitivity=1;this.calibration=null;
    document.querySelector('.capture-calibration').addEventListener('toggle',()=>this.draw());
    $('capture-start').onclick=()=>this.start();$('capture-stop').onclick=()=>this.stop();
    $('capture-sample').onclick=()=>this.sample();$('capture-read').onclick=()=>this.analyze();
    $('capture-locate').onclick=()=>{this.calibration=null;this.latest=null;this.resetPlan();this.draw();this.status(()=>(t('영역을 다시 찾도록 설정했습니다. 인식 버튼을 누르세요.')));};
    $('capture-board-choice').onchange=()=>this.selectBoard(+$('capture-board-choice').value);
    $('capture-sensitivity').oninput=()=>{this.sensitivity=+$('capture-sensitivity').value;this.latest=null;$('capture-sensitivity-value').textContent=this.sensitivity.toFixed(2);};
    document.querySelectorAll('[data-capture-region]').forEach(b=>b.onclick=()=>{
      if(!this.hasFrame)return;
      this.target=b.dataset.captureRegion;this.status(()=>(t`${b.textContent}의 왼쪽 위에서 오른쪽 아래까지 드래그하세요.`));this.draw();
      // Calibration controls may be below the preview in a scrollable capture pane.
      this.canvas.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    });
    this.canvas.onpointerdown=e=>{
      if(!this.target||e.button!==0)return;e.preventDefault();this.canvas.setPointerCapture(e.pointerId);
      this.drag={start:this.point(e),end:this.point(e)};this.draw();
    };
    this.canvas.onpointermove=e=>{if(this.drag){this.drag.end=this.point(e);this.draw();}};
    this.canvas.onpointerup=e=>{
      if(!this.drag)return;this.drag.end=this.point(e);const rect=this.dragRect();this.drag=null;
      if(validRect(rect,this.frame)){
        if(this.target==='board')this.calibration={board:rect,slots:defaultSlots(rect,this.callbacks.getState().cols)};
        else if(this.calibration)this.calibration.slots[+this.target]=rect;
        else {this.status(()=>(t('보드 영역부터 지정하세요.')),true);this.target=null;this.draw();return;}
        this.target=null;this.latest=null;this.resetPlan();this.saveCalibration();this.status(()=>(t('영역을 저장했습니다. 인식 버튼을 눌러 한 번 읽으세요.')));
      }else this.status(()=>(t('영역을 조금 더 크게 지정하세요.')),true);
      this.draw();
    };
    this.canvas.onpointercancel=()=>{this.drag=null;this.draw();};
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){this.target=null;this.drag=null;this.draw();}});
    document.addEventListener('paste',event=>{
      if(!this.active||document.body.classList.contains('statistics-mode')||document.querySelector('dialog[open]'))return;
      const data=event.clipboardData;
      const file=[...(data?.items||[])].filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).find(Boolean)
        ||[...(data?.files||[])].find(file=>file.type.startsWith('image/'));
      if(!file)return; // Text (including block names and URLs) pastes normally.
      event.preventDefault();this.pasteImage(file);
    });
    window.addEventListener('pagehide',()=>this.stop(false));
    this.controls();
  }
  status(text,error=false){this.notice={text,error};this.refreshStatus();}
  refreshStatus(){if(!this.notice)return;$('capture-status').textContent=t(typeof this.notice.text==='function'?this.notice.text():this.notice.text);$('capture-status').classList.toggle('error',this.notice.error);}
  renderDetection(){
    const observation=this.latest;
    if(!observation?.safe||observation.error){$('capture-detection').textContent='';return;}
    const description=observation.pieces.map((p,i)=>t`${i+1}번 ${p.status==='used'?t('사용 완료'):t`${p.cells.length}칸`}`).join(' · ');
    $('capture-detection').textContent=t`격자 점검 ${Math.round(observation.confidence*100)}/100 · ${description}`;
  }
  refreshLanguage(){
    this.controls();this.refreshStatus();this.renderDetection();
    for(const [i,option]of [...$('capture-board-choice').options].entries()){
      const board=this.boards?.[i];if(board)option.textContent=t`보드 ${i+1} · 화면 ${board.x>this.frame.width/2?t('오른쪽'):t('왼쪽')}`;
    }
    this.draw();
  }
  resetPlan(){if(!this.pendingReroll||!this.callbacks.getPlan().result?.reroll)this.callbacks.onReset();}
  controls(){
    $('capture-stop').disabled=!this.stream;$('capture-start').disabled=this.starting||false;
    $('capture-read').disabled=this.starting||(!this.stream&&!this.hasFrame);
    for(const id of ['capture-locate','capture-sensitivity'])$(id).disabled=!this.hasFrame;
    document.querySelectorAll('[data-capture-region]').forEach(b=>b.disabled=!this.hasFrame);
    $('capture-canvas').hidden=!this.hasFrame;this.video.hidden=!this.stream;$('capture-empty').hidden=!!this.stream||this.hasFrame;
    $('capture-source').textContent=this.stream?t('화면 공유 중'):this.hasFrame?t(this.imageSource||'정지 화면'):t('공유 대기');
  }
  async start(){
    if(!navigator.mediaDevices?.getDisplayMedia){this.status(()=>(t('화면 공유를 지원하는 Chrome 또는 Edge에서 localhost 주소로 열어 주세요.')),true);return;}
    this.stop(false);this.starting=true;this.controls();const token=++this.token;
    try{
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:30,max:30}},audio:false});
      if(token!==this.token||!this.active){stream.getTracks().forEach(t=>t.stop());return;}
      this.stream=stream;this.demo=false;this.imageSource=null;this.pendingReroll=!!this.callbacks.getPlan().result?.reroll;this.video.srcObject=stream;await this.video.play();
      if(token!==this.token)return;
      this.calibration=null;this.latest=null;this.hasFrame=false;this.accepted=false;this.resetPlan();this.controls();
      stream.getVideoTracks()[0].addEventListener('ended',()=>{if(this.stream===stream)this.stop();},{once:true});
      this.status(()=>(t('실시간 미리보기 중입니다. 인식 버튼을 누르면 그 순간의 화면만 한 번 읽습니다.')));
    }catch(error){
      if(token===this.token){this.stop(false);this.status(()=>(error.name==='NotAllowedError'?t('공유가 취소됐습니다. 화면 공유 시작을 눌러 다시 선택할 수 있습니다.'):t`화면을 공유하지 못했습니다: ${t(error.message)}`),true);}
    }finally{this.starting=false;this.controls();}
  }
  stop(notice=true){
    ++this.token;++this.imageRequest;
    this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.srcObject=null;this.starting=false;
    this.drag=null;this.target=null;this.controls();this.draw();if(notice)this.status(()=>(t('화면 공유를 종료했습니다. 마지막 인식 화면은 정지 상태로 남습니다.')));
  }
  setActive(active){this.active=active;if(!active){this.stop(false);this.accepted=false;}this.draw();}
  copyFrame(source){
    const width=source.videoWidth||source.naturalWidth||source.width,height=source.videoHeight||source.naturalHeight||source.height;
    if(!width||!height)return false;
    const scale=Math.min(1,2560/width,2160/height),w=Math.round(width*scale),h=Math.round(height*scale);
    if(this.frame.width!==w||this.frame.height!==h){this.frame.width=w;this.frame.height=h;this.calibration=null;this.accepted=false;this.resetPlan();}
    this.frame.getContext('2d',{willReadFrequently:true}).drawImage(source,0,0,w,h);this.hasFrame=true;this.controls();return true;
  }
  async sample(){
    await this.loadImage('/sample-game.png',{demo:true,label:t('예시 이미지'),error:t('예시 이미지를 열지 못했습니다.')});
  }
  async pasteImage(file){
    const url=URL.createObjectURL(file);
    try{await this.loadImage(url,{demo:false,label:t('클립보드 이미지'),error:t('붙여넣은 이미지를 읽지 못했습니다. 스크린샷을 다시 복사해 붙여넣어 주세요.')});}
    finally{URL.revokeObjectURL(url);}
  }
  async loadImage(url,{demo,label,error}){
    const request=++this.imageRequest,token=this.token,image=new Image();
    const current=()=>request===this.imageRequest&&token===this.token&&this.active;
    this.status(()=>(t`${t(label)}를 읽는 중…`));image.src=url;
    try{
      await image.decode();if(!current())return;
      const pendingReroll=!demo&&!!this.callbacks.getPlan().result?.reroll;
      // Decode first: an unreadable paste must not end a working video stream.
      this.stop(false);this.demo=demo;this.imageSource=label;this.pendingReroll=pendingReroll;
      this.calibration=null;this.accepted=false;this.latest=null;
      $('capture-detection').textContent='';$('capture-board-label').hidden=true;
      this.resetPlan();this.copyFrame(image);this.draw();this.status(()=>(t('이미지가 준비됐습니다. 인식 버튼을 눌러 한 번 읽으세요.')));
    }catch{if(current())this.status(()=>(error),true);}
  }
  locate(image){
    const state=this.callbacks.getState();this.boards=detectBoards(image,state.cols,state.rows);
    $('capture-board-choice').replaceChildren(...this.boards.map((b,i)=>{const o=document.createElement('option');o.value=i;o.textContent=t`보드 ${i+1} · 화면 ${b.x>image.width/2?t('오른쪽'):t('왼쪽')}`;return o;}));
    $('capture-board-label').hidden=this.boards.length<2;
    if(this.boards.length)this.calibration={board:this.boards[0],slots:defaultSlots(this.boards[0],state.cols)};
    else {
      try{const saved=JSON.parse(localStorage.getItem(CACHE));if(saved.width===image.width&&saved.height===image.height&&saved.cols===state.cols&&saved.rows===state.rows&&[saved.regions.board,...saved.regions.slots].every(r=>validRect(r,image)))this.calibration=saved.regions;}catch{}
    }
    if(this.calibration)this.saveCalibration();
  }
  selectBoard(index){
    const board=this.boards[index];if(!board)return;
    this.calibration={board,slots:defaultSlots(board,this.callbacks.getState().cols)};
    this.latest=null;this.resetPlan();this.saveCalibration();this.draw();this.status(()=>(t('영역을 저장했습니다. 인식 버튼을 눌러 한 번 읽으세요.')));
  }
  saveCalibration(){
    const {cols,rows}=this.callbacks.getState();this.geometry=`${cols},${rows}`;
    try{localStorage.setItem(CACHE,JSON.stringify({width:this.frame.width,height:this.frame.height,cols,rows,regions:this.calibration}));}catch{}
  }
  observation(){return this.pendingReroll&&this.observedRerollPlan===this.callbacks.getPlan().result?this.latest:null;}
  rerollApplied(){this.pendingReroll=false;this.latest=null;this.accepted=true;}
  readObservation(){
    const state=this.callbacks.getState(),image=this.frame.getContext('2d',{willReadFrequently:true}).getImageData(0,0,this.frame.width,this.frame.height);
    if(this.geometry&&this.geometry!==`${state.cols},${state.rows}`)this.calibration=null;
    if(!this.calibration)this.locate(image);
    if(!this.calibration)return null;
    return recognize(image,this.calibration,{cols:state.cols,rows:state.rows,sensitivity:this.sensitivity});
  }
  analyze(){
    if(!this.active||(!this.stream&&!this.hasFrame))return;
    if(this.target||this.drag){this.status(()=>(t('영역 드래그를 마친 뒤 인식을 눌러 주세요.')),true);return;}
    this.observedRerollPlan=this.callbacks.getPlan().result;this.pendingReroll=!!this.observedRerollPlan?.reroll;
    this.latest=null;this.accepted=false;this.resetPlan();$('capture-detection').textContent='';
    if(this.stream&&!this.copyFrame(this.video)){this.status(()=>(t('영상이 준비될 때까지 기다린 뒤 인식을 눌러 주세요.')),true);this.draw();return;}
    const observation=this.readObservation();this.latest=observation;
    if(!observation){this.status(()=>(t('보드를 찾지 못했습니다. 영역 조정에서 보드와 조각 3개의 영역을 지정하세요.')),true);this.draw();return;}
    if(observation.error||!observation.safe){
      this.status(()=>(observation.error||t`인식 확인 필요 · ${observation.uncertain||0}칸 불확실. 보드와 조각 영역을 조정하거나 아래 보드를 직접 수정하세요.`),true);this.draw();return;
    }
    this.renderDetection();
    if(this.pendingReroll&&this.callbacks.getPlan().result?.reroll){
      this.status(()=>(t('바꾸기 결과 이미지를 읽었습니다. 추천 순서의 「공유 화면의 새 조각 반영」을 눌러 실제 결과를 반영하세요.')));this.draw();return;
    }
    this.pendingReroll=false;
    if(!observation.pieces.some(p=>p.status==='ready')){this.status(()=>(t('세 조각 사용 완료 · 다음 세트가 나오면 인식 버튼을 누르세요.')));this.draw();return;}
    try{
      this.callbacks.onRead(observation,{demo:!!this.demo});this.accepted=true;
      this.status(()=>(t('인식 결과를 보드에 반영했습니다. 배치를 계산하고 있습니다.')));
    }catch(error){this.status(()=>(t(error.message)),true);}
    this.draw();
  }
  resume(){this.latest=null;this.pendingReroll=false;this.accepted=false;this.status(()=>(t('배치를 반영했습니다. 다음 조각이 나오면 인식 버튼을 누르세요.')));this.draw();}
  point(event){const rect=this.canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(this.canvas.width,(event.clientX-rect.left)*this.canvas.width/rect.width)),y:Math.max(0,Math.min(this.canvas.height,(event.clientY-rect.top)*this.canvas.height/rect.height))};}
  dragRect(){const {start,end}=this.drag;return {x:Math.round(Math.min(start.x,end.x)),y:Math.round(Math.min(start.y,end.y)),w:Math.round(Math.abs(end.x-start.x)),h:Math.round(Math.abs(end.y-start.y))};}
  draw(){
    if(!this.active||!this.hasFrame)return;
    const canvas=this.canvas,ctx=canvas.getContext('2d');
    if(canvas.width!==this.frame.width||canvas.height!==this.frame.height){canvas.width=this.frame.width;canvas.height=this.frame.height;}
    ctx.clearRect(0,0,canvas.width,canvas.height);if(!this.stream)ctx.drawImage(this.frame,0,0);
    const theme=getComputedStyle(document.documentElement),color=name=>theme.getPropertyValue(`--color-${name}`).trim();
    const fontSize=Math.max(11,Math.round(canvas.width/65));ctx.font=`bold ${fontSize}px sans-serif`;ctx.lineWidth=Math.max(1.5,canvas.width/600);
    if(this.calibration){
      const {board,slots}=this.calibration,{cols,rows}=this.callbacks.getState();
      const plan=this.callbacks.getPlan(),cw=board.w/cols,ch=board.h/rows,unordered=isOrderIndependent(plan.result,cols);
      if(this.accepted&&plan.result&&plan.preview!==-1){
        for(const [key,steps]of overlayCells(plan.result.moves,plan.preview)){
          const [x,y]=key.split(',').map(Number);
          steps.forEach((step,i)=>{
            const part=cw/steps.length,left=board.x+x*cw+i*part,top=board.y+y*ch;
            ctx.globalAlpha=.82;ctx.fillStyle=color(plan.stepColor(step-1));ctx.fillRect(left+1,top+1,part-1,ch-2);ctx.globalAlpha=1;
            if(!unordered){ctx.fillStyle=color('white');ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`bold ${Math.max(8,Math.min(ch*.55,part*.9))}px sans-serif`;ctx.fillText(String(step),left+part/2,top+ch/2);}
          });
        }
      }
      ctx.textAlign='left';ctx.textBaseline='bottom';ctx.font=`bold ${fontSize}px sans-serif`;
      if(this.target||this.drag||document.querySelector('.capture-calibration').open)[board,...slots].forEach((r,i)=>{
        ctx.strokeStyle=color(i?'skill':'accent');ctx.strokeRect(r.x,r.y,r.w,r.h);
        const label=i?t`조각 ${i}`:`${cols} × ${rows}`,w=ctx.measureText(label).width+8;
        ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(r.x,Math.max(0,r.y-fontSize-6),w,fontSize+6);
        ctx.fillStyle=color('white');ctx.fillText(label,r.x+4,Math.max(fontSize+4,r.y-2));
      });
    }
    canvas.classList.toggle('selecting',!!this.target);
    if(this.drag){const r=this.dragRect();ctx.strokeStyle=color('selection');ctx.lineWidth=3;ctx.strokeRect(r.x,r.y,r.w,r.h);}
  }
  planReady(){if(this.active&&this.accepted){const result=this.callbacks.getPlan().result;this.status(()=>(result?.target?.hit?t`${result.target.hitStep}번까지만 놓으면 목표 ${result.target.hit.toLocaleString()}점 · 목표 점수까지 반영을 누르세요.`:result?.reroll?.reason==='capacity'?t('스킬 7개 보유 중 · 먼저 다시 뽑기를 사용하고 실제 결과를 반영하세요.'):isOrderIndependent(result,this.callbacks.getState().cols)?t('추천을 색으로 표시했습니다. 순서 상관없이 놓고 완료를 누르세요.'):t('추천을 색과 번호로 표시했습니다. 순서대로 놓고 완료를 누르세요.')));this.draw();}}
}
