import {initialState,validateState} from './state-schema.js';
import {contributionCounts} from './community.js';

export const SESSION_KEY='moa-hosted-session-v1';
export const CONFLICT='다른 탭에서 진행 상태가 변경되었습니다. 새로고침해 최신 상태를 불러오세요.';
export class BrowserSession {
  constructor(catalogue,{storage=globalThis.localStorage,randomUUID=()=>crypto.randomUUID()}={}){
    this.storage=storage;this.catalogue=catalogue;this.randomUUID=randomUUID;
  }
  load(){
    const raw=this.storage.getItem(SESSION_KEY);
    if(raw){
      const saved=JSON.parse(raw);
      if(saved.version!==1||!Number.isSafeInteger(saved.revision)||!Number.isSafeInteger(saved.contributionRevision)||!/^[-a-f0-9]{36}$/.test(saved.token))throw new Error('브라우저 저장 형식을 읽을 수 없습니다.');
      this.saved={...saved,state:validateState(saved.state)};
    }else{
      this.saved={version:1,revision:0,contributionRevision:0,token:this.randomUUID(),identity:{},counts:[],state:{...initialState(),blocks:structuredClone(this.catalogue)}};
      // Persist the identity before any observations; a storage failure must
      // never create a new contributor on every refresh.
      this.storage.setItem(SESSION_KEY,JSON.stringify(this.saved));
    }
    return structuredClone(this.saved.state);
  }
  save(state){
    const current=JSON.parse(this.storage.getItem(SESSION_KEY)||'null');
    if(!current||current.token!==this.saved.token||current.revision!==this.saved.revision)throw new Error(CONFLICT);
    const identity={...this.saved.identity},clean=validateState(state),counts=contributionCounts(clean,this.catalogue,identity);
    const changed=JSON.stringify(counts)!==JSON.stringify(this.saved.counts);
    const next={...this.saved,revision:this.saved.revision+1,contributionRevision:this.saved.contributionRevision+Number(changed),identity,counts,state:clean};
    this.storage.setItem(SESSION_KEY,JSON.stringify(next));this.saved=next;
    return changed;
  }
  submission(){return {token:this.saved.token,revision:this.saved.contributionRevision,counts:structuredClone(this.saved.counts)};}
}

export class CommunitySync {
  constructor(session,{fetcher=globalThis.fetch,onUpdate=()=>{},onStatus=()=>{}}={}){
    this.session=session;this.fetcher=fetcher;this.onUpdate=onUpdate;this.onStatus=onStatus;this.sent=-1;this.running=false;this.updatedAt='';
  }
  accept(data){const at=data.updatedAt||'';if(at<this.updatedAt)return;this.updatedAt=at;this.onUpdate(data);}
  async refresh(){
    try{const response=await this.fetcher('/api/statistics',{cache:'no-store'});if(!response.ok)throw new Error('read');this.accept(await response.json());this.onStatus('ready');}
    catch{this.onStatus('offline');}
  }
  async flush(){
    if(this.running)return;this.running=true;
    try{
      while(this.sent!==this.session.saved.contributionRevision){
        const body=this.session.submission();
        if(!body.revision){this.sent=0;break;}
        this.onStatus('syncing');
        const response=await this.fetcher('/api/statistics',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        if(!response.ok)throw new Error('write');
        this.accept(await response.json());this.sent=body.revision;this.onStatus('ready');
      }
    }catch{this.onStatus('offline');}finally{this.running=false;}
  }
}
