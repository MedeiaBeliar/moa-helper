import {statisticsView,observedPercent} from './statistics.js';

const copy={
  ko:{title:'블록 출현 통계',shape:'모양',normal:'일반 출현',reroll:'바꾸기',unknown:'미분류',unit:'회',
    scopes:{all:'전체',1:'1단계',2:'2단계',3:'3단계',4:'4단계',5:'5단계',unknown:'단계 미상'}},
  en:{title:'Block draw statistics',shape:'Shape',normal:'Normal draws',reroll:'Rerolls',unknown:'Unidentified',unit:'',
    scopes:{all:'Overall',1:'Stage 1',2:'Stage 2',3:'Stage 3',4:'Stage 4',5:'Stage 5',unknown:'Unknown stage'}}
};
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const count=value=>value.toLocaleString('en-US');

function shapeText(cells){
  if(!cells?.length)return null;
  const minX=Math.min(...cells.map(cell=>cell[0])),minY=Math.min(...cells.map(cell=>cell[1]));
  const width=Math.max(...cells.map(cell=>cell[0]))-minX+1,height=Math.max(...cells.map(cell=>cell[1]))-minY+1;
  const occupied=new Set(cells.map(([x,y])=>`${x-minX},${y-minY}`));
  return Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>occupied.has(`${x},${y}`)?'■':'□').join('')).join('\n');
}

function shapeTable(shape){
  // Legacy HTML cell attributes work without CSS in simple post editors.
  // Empty cells still have dimensions; only occupied cells receive a fill.
  const rows=shape.split('\n').map(row=>`<tr>${Array.from(row,tile=>`<td width="12" height="12"${tile==='■'?' bgcolor="#333333"':''}></td>`).join('')}</tr>`).join('\n');
  return `<table border="0" cellpadding="0" cellspacing="1" align="center" role="presentation"><tbody>\n${rows}\n</tbody></table>`;
}

// Export only aggregates and library shapes. Active game state, block
// IDs and provisional recognized pieces never enter the community document.
export function createStatisticsExport(state,{scope='complete',source='both',sort='total',language='ko',createdAt=new Date()}={}){
  if(!['complete','all','unknown','1','2','3','4','5'].includes(String(scope)))throw new Error('Invalid export scope');
  if(!['both','normal','reroll'].includes(source))throw new Error('Invalid export source');
  const lang=language==='en'?'en':'ko',labels=copy[lang],at=new Date(createdAt);
  if(!Number.isFinite(at.getTime()))throw new Error('Invalid export date');
  const blocks=new Map(state.blocks.map(block=>[block.id,block]));
  const scopes=scope==='complete'?['all','1','2','3','4','5','unknown'].filter(stage=>stage!=='unknown'||statisticsView(state,{stage}).totals.total>0):[String(scope)];
  const views=scopes.map(stage=>statisticsView(state,{stage}));
  const ordered=statisticsView(state,{stage:scope==='complete'?'all':String(scope),sort}).rows;
  const tables=(source==='both'?['normal','reroll']:[source]).map(key=>({source:key,title:labels[key],
    stages:scopes.map(stage=>({scope:stage,title:labels.scopes[stage]})),
    rows:ordered.map(row=>({name:row.blockId===null?labels.unknown:row.name,shape:shapeText(blocks.get(row.blockId)?.cells),
      values:views.map(view=>{const value=view.rows.find(entry=>entry.blockId===row.blockId)[key];return {count:value,percent:observedPercent(value,view.totals[key])};})}))}));
  const cell=value=>`${value.percent} (${count(value.count)}${labels.unit})`;
  const html=[],text=[];
  for(const table of tables){
    const headers=[labels.shape,...table.stages.map(stage=>stage.title)];
    html.push('<table border="1" cellpadding="6" cellspacing="0">',`<caption>${table.title}</caption>`,
      `<thead><tr>${headers.map(header=>`<th scope="col">${escape(header)}</th>`).join('')}</tr></thead>`,'<tbody>');
    text.push(table.title,headers.join('\t'));
    for(const row of table.rows){
      html.push(`<tr><th scope="row">${escape(row.name)}${row.shape?shapeTable(row.shape):''}</th>${row.values.map(value=>`<td>${cell(value)}</td>`).join('')}</tr>`);
      text.push([`${row.name}${row.shape?` ${row.shape.replaceAll('\n',' / ')}`:''}`,...row.values.map(cell)].join('\t'));
    }
    html.push('</tbody>','</table>');text.push('');
  }
  const fragment=html.join('\n');
  return {html:fragment,text:text.join('\n').trimEnd(),tables,
    filename:`moa-statistics-${at.toISOString().slice(0,10)}-${scope}.html`,
    document:`<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${labels.title}</title></head><body>\n${fragment}\n</body></html>`};
}

export async function copyStatisticsExport(report,format,{clipboard=globalThis.navigator?.clipboard,Item=globalThis.ClipboardItem}={}){
  if(format==='source'){
    if(!clipboard?.writeText)throw new Error('Clipboard unavailable');
    await clipboard.writeText(report.html);return;
  }
  if(format!=='table'||!clipboard?.write||!Item)throw new Error('HTML clipboard unavailable');
  await clipboard.write([new Item({'text/html':new Blob([report.html],{type:'text/html'}),'text/plain':new Blob([report.text],{type:'text/plain'})})]);
}
