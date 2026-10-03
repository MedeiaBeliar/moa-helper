import {createHash} from 'node:crypto';
import english from '../public/locales/en.js';
import {createStatisticsExport} from '../public/statistics-export.js';

export const domains=['moa.chocolily.dev','moa.moria-luluka.com','moa.morialuluka.com','moa.xn--o39a013c.tv'];
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const descriptions={
  ko:'메이플스토리 한글 모아모아 도우미. 세 조각 배치 추천, 화면 인식, 능력 위치 관리와 단계별 공용 블록 출현 통계를 제공합니다. 진행 상태는 브라우저에 저장됩니다.',
  en:'Moa Helper for MapleStory Hangul Moa Moa: three-piece placement recommendations, screen recognition, ability markers and shared draw statistics by stage. Progress stays in your browser.'
};
const names={ko:'모아모아 도우미',en:'Moa Helper — Hangul Moa Moa'};
const pageNames={guide:{ko:'사용 안내',en:'How to use Moa Helper'},statistics:{ko:'단계별 블록 출현 통계',en:'Block draw statistics by stage'}};
function metadata(origin,language,path){
  const route=path.replace(/^\/en\//,'/'),suffix=route==='/'?'':route.slice(1),canonical=origin+path;
  const title=suffix?`${pageNames[suffix][language]} | ${names[language]}`:names[language];
  const structured={ '@context':'https://schema.org','@graph':[
    {'@type':'WebSite','@id':`${origin}/#website`,url:`${origin}/`,name:'모아모아 도우미',alternateName:['Moa Helper','한글 모아모아 도우미'],inLanguage:['ko','en']},
    {'@type':'WebApplication',name:names[language],url:canonical,description:descriptions[language],applicationCategory:'GameApplication',operatingSystem:'Web browser',isAccessibleForFree:true,inLanguage:language,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'}}
  ]};
  const json=JSON.stringify(structured).replaceAll('<','\\u003c');
  const head=`<meta name="description" content="${escape(descriptions[language])}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="ko" href="${origin}/${suffix}">
<link rel="alternate" hreflang="en" href="${origin}/en/${suffix}">
<link rel="alternate" hreflang="x-default" href="${origin}/${suffix}">
<meta property="og:type" content="website"><meta property="og:site_name" content="모아모아 도우미">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(descriptions[language])}">
<meta property="og:url" content="${canonical}"><meta property="og:locale" content="${language==='ko'?'ko_KR':'en_US'}">
<meta property="og:image" content="${origin}/social-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${escape(title)}"><meta name="twitter:description" content="${escape(descriptions[language])}"><meta name="twitter:image" content="${origin}/social-card.png">
<script type="application/ld+json">${json}</script>`;
  return {head,title,hash:createHash('sha256').update(json).digest('base64')};
}

function links(language){const prefix=language==='en'?'/en/':'/';return `<nav class="public-links" aria-label="${language==='en'?'Site links':'사이트 안내'}"><a href="${prefix}">${language==='en'?'Play':'플레이'}</a><a href="${prefix}guide">${language==='en'?'Guide':'사용 안내'}</a><a href="${prefix}statistics">${language==='en'?'Public statistics':'공용 통계'}</a><a href="${language==='en'?'/guide':'/en/guide'}" lang="${language==='en'?'ko':'en'}">${language==='en'?'한국어':'English'}</a><a href="https://github.com/Moria-Luluka/moa-helper">GitHub</a></nav>`;}
function overview(language){return language==='en'?`<h2>Hangul Moa Moa placement helper</h2><p>Choose the three blocks in your game, enter the board, then find a placement recommendation. Rotation, reflection, line clears and available abilities are included. You perform the moves in MapleStory yourself.</p><p>Screen sharing and pasted screenshots can read the board and pieces. Images are processed in your browser. Check the result before confirming a placement.</p>`:`<h2>메이플스토리 한글 모아모아 배치 도우미</h2><p>게임에 나온 세 조각과 현재 보드를 입력하면 회전·반전, 가로줄 제거와 보유 능력을 고려해 배치를 추천합니다. 실제 게임 조작은 직접 진행합니다.</p><p>화면공유 또는 붙여넣은 이미지에서 보드와 조각을 읽을 수 있습니다. 이미지 처리는 브라우저에서 이루어지며, 인식 결과를 확인한 뒤 배치를 완료하세요.</p>`;}
function privacy(language){return language==='en'?`<h2>Storage and shared statistics</h2><p>Your board, score, block library, abilities and settings stay in this browser. Saves are separate for each domain, browser and device. Clearing site data removes that progress.</p><p>Confirmed draw counts are sent to the shared statistics service with a random browser token. Only canonical block IDs, stages, normal/reroll counts and a revision number are sent. The service stores a hash of the token to deduplicate retries and handle undo. Screenshots, boards, scores and custom block names are not uploaded. Normal hosting infrastructure may process network addresses for delivery and abuse prevention.</p><p>The public tables combine observations from all four Moa Helper domains. They start separately from the local application's statistics. Unconfirmed screen recognition and demo pieces are excluded. Observed frequencies are not official game probabilities.</p>`:`<h2>저장과 공용 통계</h2><p>보드·점수·조각 보관함·능력·설정은 이 브라우저에 저장합니다. 도메인·브라우저·기기가 다르면 저장도 별개이며, 사이트 데이터를 지우면 진행 상태가 삭제됩니다.</p><p>확정된 출현 횟수는 임의의 브라우저 식별 토큰과 함께 공용 통계로 전송합니다. 전송 항목은 정해진 블록 ID, 단계, 일반·바꾸기 횟수와 갱신 번호입니다. 서버는 토큰의 해시를 저장해 재전송 중복을 막고 되돌리기를 반영합니다. 스크린샷·보드·점수·직접 지은 블록 이름은 전송하지 않습니다. 접속 처리와 과도한 요청 방지를 위해 호스팅 인프라에서 네트워크 주소를 처리할 수 있습니다.</p><p>네 도메인의 관측 기록을 함께 합산하며 로컬 프로그램 통계와 별도로 시작합니다. 미확정 인식과 예시 조각은 제외합니다. 표시한 비율은 관측값이며 공식 확률이 아닙니다.</p>`;}
function disclaimer(language){return language==='en'?`<p>For MapleStory's Hangul Moa Moa event, October 1, 2026 at 10:00 to October 14, 2026 at 23:59 (KST). MapleStory and related trademarks belong to Nexon and their respective owners. This is an unofficial personal and educational project, not produced or endorsed by Nexon. Recommendations use a bounded search; survival or a particular score is not guaranteed.</p>`:`<p>2026년 10월 1일 오전 10시부터 10월 14일 오후 11시 59분까지(KST) 진행되는 메이플스토리 한글 모아모아 이벤트의 개인·학습용 비공식 도우미입니다. 메이플스토리 및 관련 상표는 넥슨과 각 권리자에게 있으며, 이 프로젝트는 넥슨이 제작하거나 승인하지 않았습니다. 제한 시간 내 탐색을 사용하므로 생존과 특정 점수를 보장하지 않습니다.</p>`;}

export function renderApp(template,{origin,language}){
  let html=template;
  if(language==='en'){
    html=html.split(/(<[^>]+>)/g).map(part=>part.startsWith('<')?part.replace(/(aria-label|title|placeholder|content)="([^"]*)"/g,(all,key,value)=>typeof english[value]==='string'?`${key}="${escape(english[value])}"`:all):typeof english[part.trim()]==='string'?part.replace(part.trim(),()=>escape(english[part.trim()])):part).join('');
  }
  const meta=metadata(origin,language,language==='en'?'/en/':'/');
  html=html.replace(/<html lang="[^"]+">/,`<html lang="${language}">`).replace(/<meta[^>]+name="description"\s*\/?>/,'').replace(/<title>[^<]*<\/title>/,`<title>${meta.title}</title>`);
  html=html.replace('</head>',`${meta.head}<meta name="moa-storage" content="browser"></head>`);
  html=html.replace('</body>',`<section class="public-about">${links(language)}${overview(language)}<p>${language==='en'?'Your progress stays in this browser. Confirmed draw counts contribute to shared statistics.':'진행 상태는 브라우저에 저장하고 확정된 출현 기록만 공용 통계에 합산합니다.'}</p></section></body>`);
  return {html,hash:meta.hash};
}

export function renderPage({origin,language,page,catalogue,statistics}){
  const prefix=language==='en'?'/en/':'/',meta=metadata(origin,language,prefix+page);
  const title=pageNames[page][language];let body;
  if(page==='statistics')body=`<p>${language==='en'?'Confirmed normal draws and rerolls from visitors, grouped by cleared-line stage.':'방문자가 확정한 일반 조각과 바꾸기 결과를 누적 제거 줄 수에 따른 단계별로 합산합니다.'}</p>${createStatisticsExport({blocks:catalogue,statistics},{language}).html}`;
  else body=overview(language)+(language==='en'?`<h2>Play</h2><ol><li>Select or type three block names. English keyboard positions and combined Hangul letters are accepted.</li><li>Enter occupied cells manually, share a game window, or paste a screenshot. Check recognized cells and pieces.</li><li>Enter your score, cleared lines and ability inventory. Press Enter to search. Quick input starts after three block names.</li><li>Follow the colored placements. Step numbers appear when their order matters. Confirm the moves to update the board.</li></ol><h2>Abilities and shortcuts</h2><ul><li>1: add a Dot marker at the cell under the pointer.</li><li>2: add a Reroll marker.</li><li>Backtick (&#96;): delete a marker. The toolbar has the same actions.</li><li>Every addition is the newest ability; a fourth marker removes the oldest. Adding at an occupied marker replaces it and renews its order.</li><li>R / F: rotate or reflect a manually placed piece. Enter: find recommendations.</li></ul><h2>Rules used by the helper</h2><p>Use all three pieces before drawing the next set. Only full horizontal rows clear; other cells stay in place. Placing a piece scores its cell count, a Dot scores 1, and acquiring an ability scores 50. Clearing n rows at once scores 300 × n². Stages correspond to 0–30, 31–60, 61–100, 101–150 and 151+ cleared rows.</p>`:`<h2>사용 순서</h2><ol><li>게임의 세 조각을 선택하거나 이름으로 입력합니다. 영문 키보드 위치와 합쳐진 한글도 인식합니다.</li><li>보드를 직접 입력하거나 게임 창을 공유하고, 스크린샷을 붙여넣어 인식합니다. 인식한 칸과 조각을 확인하세요.</li><li>점수·제거 줄 수·보유 능력을 입력하고 Enter로 추천합니다. 빠른 입력은 세 이름 입력 후 자동 추천합니다.</li><li>색으로 구분한 위치에 배치합니다. 순서가 중요할 때만 번호를 표시합니다. 완료를 누르면 보드와 조각을 갱신합니다.</li></ol><h2>능력과 단축키</h2><ul><li>1: 커서 아래 칸에 점 찍기 능력 위치 추가.</li><li>2: 바꾸기 능력 위치 추가.</li><li>백틱 (&#96;): 해당 능력 위치 삭제. 보드 도구에도 같은 버튼이 있습니다.</li><li>추가할 때마다 새 능력으로 기록하며, 4개째에는 가장 오래된 표시가 사라집니다. 같은 칸에 추가해도 종류와 순서를 갱신합니다.</li><li>R / F: 직접 배치 중인 조각 회전·반전. Enter: 배치 추천.</li></ul><h2>계산에 사용하는 규칙</h2><p>세 조각을 모두 써야 다음 세 조각이 나옵니다. 가로 한 줄만 제거되며 다른 칸은 내려오지 않습니다. 조각 칸 수만큼 배치 점수, 점 찍기 1점, 능력 획득 50점을 얻습니다. n줄 동시 제거는 300 × n²점입니다. 단계는 누적 제거 0~30, 31~60, 61~100, 101~150, 151줄 이상으로 구분합니다.</p>`)+privacy(language)+disclaimer(language);
  return {hash:meta.hash,html:`<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(meta.title)}</title>${meta.head}<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/manual.css"></head><body class="public-page"><main>${links(language)}<h1>${escape(title)}</h1>${body}</main></body></html>`};
}

export function sitemap(origin){return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/en/','/guide','/en/guide','/statistics','/en/statistics'].map(route=>`<url><loc>${origin}${route}</loc></url>`).join('')}</urlset>`;}
export function robots(origin){return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;}
export function llms(origin){return `# Moa Helper\n\nMoa Helper is an unofficial, free browser assistant for MapleStory's Hangul Moa Moa event. It provides three-piece placement recommendations, manual or screen input, ability markers and observed draw statistics.\n\n- [Application](${origin}/): Korean interface; English is available at /en/.\n- [Guide](${origin}/en/guide): Controls, game rules, storage and data collection.\n- [Statistics](${origin}/en/statistics): Server-rendered shape tables with observed frequencies for each stage.\n- [Source](https://github.com/Moria-Luluka/moa-helper): MIT-licensed source.\n\nBoards, scores and screenshots stay in the browser. Only confirmed draw counts contribute to the shared statistics. Observed frequencies are not official probabilities. The bounded solver does not guarantee survival or a score. MapleStory trademarks belong to Nexon and the respective owners.\n`;}
