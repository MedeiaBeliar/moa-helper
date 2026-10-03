import {t,getLanguage,onLanguageChange} from './i18n.js';
import {createStatisticsExport,copyStatisticsExport} from './statistics-export.js';

// The native dialog supplies keyboard focus containment and Escape dismissal.
export function setupStatisticsShare({getState,getStage,getSort}){
  const $=id=>document.getElementById(id),dialog=$('statistics-export-dialog');
  let snapshot,stage,sort,createdAt,report,copying=false,session=0;
  const actions=['statistics-copy-table','statistics-copy-html','statistics-download-html'];
  function feedback(message='',error=false){
    $('statistics-export-status').textContent=message;
    $('statistics-export-status').classList.toggle('error',error);
  }
  function refresh(){
    if(!snapshot)return;
    report=createStatisticsExport(snapshot,{scope:$('statistics-export-scope').value==='complete'?'complete':stage,
      source:$('statistics-export-source-kind').value,sort,language:$('statistics-export-language').value,createdAt});
    $('statistics-export-preview').srcdoc=report.document;
    $('statistics-export-source').value=report.html;
    feedback();
  }
  $('statistics-export').onclick=()=>{
    const state=getState();if(!state)return;
    snapshot=structuredClone({blocks:state.blocks,statistics:state.statistics});stage=getStage();sort=getSort();createdAt=new Date();session++;
    $('statistics-export-language').value=getLanguage();
    $('statistics-export-current').textContent=t`현재 범위 · ${$('statistics-stage').selectedOptions[0].textContent}`;
    $('statistics-export-code').open=false;refresh();dialog.showModal();$('statistics-export-scope').focus();
  };
  $('statistics-export-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{
    session++;snapshot=null;report=null;$('statistics-export-preview').removeAttribute('srcdoc');
    $('statistics-export-source').value='';$('statistics-export').focus({preventScroll:true});
  });
  for(const id of ['statistics-export-scope','statistics-export-source-kind','statistics-export-language'])$(id).onchange=refresh;
  async function copy(format){
    if(!report||copying)return;
    copying=true;const current=session;
    for(const id of actions)$(id).disabled=true;
    feedback(t('복사 중…'));
    try{
      await copyStatisticsExport(report,format);
      if(current===session)feedback(format==='source'?t('HTML 소스를 복사했습니다. 글 에디터의 HTML 입력 모드에 붙여 넣으세요.'):t('표를 복사했습니다. 글 에디터에 붙여 넣으세요. 표가 유지되지 않으면 HTML 소스 복사를 사용하세요.'));
    }catch{
      if(current===session){
        $('statistics-export-code').open=true;$('statistics-export-source').focus();$('statistics-export-source').select();
        feedback(t('자동 복사를 사용할 수 없습니다. 선택된 HTML 소스를 Ctrl+C 또는 ⌘C로 복사해 주세요.'),true);
      }
    }finally{
      copying=false;for(const id of actions)$(id).disabled=false;
    }
  }
  $('statistics-copy-table').onclick=()=>copy('table');
  $('statistics-copy-html').onclick=()=>copy('source');
  $('statistics-download-html').onclick=()=>{
    if(!report)return;
    const url=URL.createObjectURL(new Blob([report.document],{type:'text/html;charset=utf-8'})),link=document.createElement('a');
    link.href=url;link.download=report.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    feedback(t('HTML 파일을 내려받았습니다. 글을 올리기 전에 미리보기와 내용을 확인하세요.'));
  };
  onLanguageChange(()=>{if(dialog.open){$('statistics-export-current').textContent=t`현재 범위 · ${$('statistics-stage').selectedOptions[0].textContent}`;refresh();}});
}
