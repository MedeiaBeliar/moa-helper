import english from './locales/en.js';

export const LANGUAGE_KEY='moa-language-v1';
const listeners=new Set();
const sourceByEnglish=new Map(Object.entries(english).filter(([,value])=>typeof value==='string').map(([key,value])=>[value,key]));
let language='ko';
try{if(globalThis.localStorage?.getItem(LANGUAGE_KEY)==='en')language='en';}catch{}

export const getLanguage=()=>language;
export function setLanguage(value,{persist=true}={}){
  if(!['ko','en'].includes(value))return false;
  if(persist)try{globalThis.localStorage?.setItem(LANGUAGE_KEY,value);}catch{}
  if(language===value)return true;
  language=value;
  for(const listener of listeners)listener(value);
  return true;
}
export function onLanguageChange(listener){listeners.add(listener);return()=>listeners.delete(listener);}

// A tagged template keeps values (including player-defined names) out of keys.
// Translation only changes interface strings; it never rewrites saved state.
export function t(source,...values){
  const tagged=Array.isArray(source)&&Object.hasOwn(source,'raw');
  const key=tagged?source.map((part,i)=>part+(i<values.length?`{${i}}`:'')).join(''):String(source??'');
  const original=sourceByEnglish.get(key)??key;
  let text=language==='en'&&Object.hasOwn(english,original)?english[original]:original;
  if(typeof text==='object'){
    const count=Number(String(values[text.plural??0]).replaceAll(',',''));
    text=count===1?text.one:text.other;
  }
  return text.replace(/\{(\d+)\}/g,(match,index)=>index<values.length?String(values[index]):match);
}

// Bind only the original static document once, before dynamic UI is created.
// Text nodes preserve nested inputs, listeners, focus and selection.
export function bindStaticTranslations(doc){
  const bindings=[];
  const walker=doc.createTreeWalker(doc.documentElement,4);
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(node.parentElement?.closest('script,style,[translate="no"]'))continue;
    const key=node.data.trim();
    if(!Object.hasOwn(english,key))continue;
    const leading=node.data.match(/^\s*/)[0],trailing=node.data.match(/\s*$/)[0];
    bindings.push(()=>{if(node.isConnected)node.data=leading+t(key)+trailing;});
  }
  for(const node of doc.querySelectorAll('[aria-label],[title],[placeholder],meta[name="description"]')){
    if(node.closest('[translate="no"]'))continue;
    for(const attribute of ['aria-label','title','placeholder','content']){
      const key=node.getAttribute(attribute);
      if(key&&Object.hasOwn(english,key))bindings.push(()=>node.setAttribute(attribute,t(key)));
    }
  }
  const refresh=()=>{doc.documentElement.lang=language;for(const update of bindings)update();};
  refresh();return refresh;
}

if(typeof window!=='undefined')window.addEventListener('storage',event=>{
  if(event.key===LANGUAGE_KEY)setLanguage(event.newValue==='en'?'en':'ko',{persist:false});
});
