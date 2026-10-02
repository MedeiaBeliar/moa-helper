// Pixel-only recognition. Never reads the game process or sends frames to a server.
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
function rgb(image,x,y) {
  const i = (clamp(Math.round(y),0,image.height-1)*image.width+clamp(Math.round(x),0,image.width-1))*4;
  return [image.data[i],image.data[i+1],image.data[i+2]];
}
function hsv(r,g,b) {
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d=max-min;
  let h = !d ? 0 : max===r ? 60*((g-b)/d % 6) : max===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
  return [h<0?h+360:h,max?d/max:0,max/255];
}
const cyan = (r,g,b) => g>100 && b>110 && r<g*.83 && g>b*.69 && g<b*1.22;
const boardCyan = (r,g,b) => cyan(r,g,b) && r>40 && r<130 && g>130 && g<222 && b<239 && r/g<.7;
export function validRect(rect,image) {
  return rect && rect.w>=8 && rect.h>=8 && rect.x>=0 && rect.y>=0 && rect.x+rect.w<=image.width+1 && rect.y+rect.h<=image.height+1;
}
function runs(values,predicate) {
  const out=[]; let start=-1;
  for(let i=0;i<=values.length;i++) {
    if(i<values.length && predicate(values[i])) { if(start<0) start=i; }
    else if(start>=0) { out.push([start,i]); start=-1; }
  }
  return out;
}
export function detectBoards(image, cols=10, rows=16, debug=false) {
  const stride = Math.max(1,Math.floor(image.width/1100));
  const tracks=[];
  for(let y=0;y<image.height;y+=stride*2) {
    const values=[];
    for(let x=0;x<image.width;x+=stride) values.push(boardCyan(...rgb(image,x,y))?1:0);
    // bridge thin grid outlines, without merging separated panels
    for(let i=1;i<values.length-1;i++) if(!values[i]&&values[i-1]&&values[i+1]) values[i]=1;
    const spans=runs(values,v=>v).filter(([a,b])=>(b-a)*stride>90);
    for(const [a,b] of spans) {
      const x=a*stride,w=(b-a)*stride;
      const track=tracks.find(t=>y-t.last<=stride*4 && Math.abs(t.x-x)<stride*8 && Math.abs(t.w-w)<stride*18);
      if(track) { track.last=y; track.h=y-track.y+stride*2; track.samples++; }
      else tracks.push({x,y,w,h:stride*2,last:y,samples:1});
    }
  }
  const raw=tracks.filter(t=>t.h>t.w*.65 && t.w>90).sort((a,b)=>b.w*b.h-a.w*a.h);
  const result=[];
  if(debug) return tracks.sort((a,b)=>b.h-a.h).slice(0,12);
  for(const t of raw) {
    // Infer square-cell grid using repeated vertical edges in the clear lower area.
    const edge=[];
    for(let x=Math.floor(t.x);x<t.x+t.w;x++) {
      let sum=0;
      for(let y=t.y+5;y<t.y+t.h-5;y+=3) {
        const a=rgb(image,x,y),b=rgb(image,x+1,y);
        sum+=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
      }
      edge.push(sum/Math.max(1,t.h/3));
    }
    let fit={score:-Infinity,pitch:t.w/cols,phase:0};
    for(let pitch=t.w/(cols+.6);pitch<=t.w/(cols-.3);pitch+=.1) for(let phase=0;phase<pitch;phase+=.5) {
      let score=0,n=0;
      for(let k=0;k<cols;k++) {const at=Math.round(phase+k*pitch);if(at<edge.length) {score+=edge[at];n++;}}
      score=score/Math.max(n,1) - Math.abs(pitch*cols-t.w)*.07;
      if(n>=cols-1 && score>fit.score) fit={score,pitch,phase};
    }
    const pitch=fit.pitch;
    let x=t.x+fit.phase+1;
    if(x-t.x>pitch*.5) x-=pitch;
    // Border scanning locates bottom from its long cyan run; snap to last grid edge.
    let bottom=t.y+t.h;
    const bottomStart=bottom;
    let strongest=-1;
    for(let yy=Math.round(bottomStart-pitch*.35);yy<=bottomStart+pitch*.18;yy++) {
      let e=0;
      for(let xx=x+3;xx<x+pitch*cols-3;xx+=3) {
        const a=rgb(image,xx,yy),b=rgb(image,xx,yy+1);
        e+=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
      }
      if(e>strongest) {strongest=e;bottom=yy+1;}
    }
    // Align all internal horizontal boundaries; a decorative outer frame is not a cell.
    const guess=bottomStart-pitch*rows;
    let bestY=guess,bestYScore=-Infinity;
    for(let start=Math.floor(guess-pitch*.55);start<=guess+pitch*.35;start++) {
      let score=0;
      for(let k=2;k<rows;k++) {
        const yy=Math.round(start+k*pitch);
        for(let xx=x+pitch*.3;xx<x+pitch*cols-3;xx+=pitch*.4) {
          const a=rgb(image,xx,yy),b=rgb(image,xx,yy+1);
          score+=Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);
        }
      }
      if(score>bestYScore) {bestYScore=score;bestY=start+1;}
    }
    const rect={x:Math.round(x),y:Math.round(bestY),w:Math.round(pitch*cols),h:Math.round(pitch*rows)};
    if(!validRect(rect,image) || fit.score<3) continue;
    if(result.some(r=>Math.abs(r.x-rect.x)<pitch && Math.abs(r.y-rect.y)<pitch)) continue;
    result.push(rect);
  }
  return result.sort((a,b)=>b.x-a.x);
}
export function defaultSlots(board,cols=10) {
  const c=board.w/cols;
  return [0,1,2].map(i=>({x:Math.round(board.x+board.w+c*.53),y:Math.round(board.y+c*(1.02+i*2.88)),w:Math.round(c*1.76),h:Math.round(c*2.3)}));
}
export function readBoard(image,rect,cols=10,rows=16,sensitivity=1) {
  if(!validRect(rect,image)) return {error:'보드 영역이 화면 밖에 있습니다.'};
  const board=[], confidences=[], colors=[];
  const cw=rect.w/cols,ch=rect.h/rows;
  for(let y=0;y<rows;y++) {
    let row=0;
    for(let x=0;x<cols;x++) {
      const samples=[];
      for(const dx of [.3,.5,.7]) for(const dy of [.35,.55,.72]) samples.push(rgb(image,rect.x+(x+dx)*cw,rect.y+(y+dy)*ch));
      const mean=[0,1,2].map(k=>samples.reduce((s,p)=>s+p[k],0)/samples.length);
      const [h,s,v]=hsv(...mean);
      const blueExcess=mean[2]-mean[1];
      const isColored = (h<167 || h>223) && s>.22 && v>.35;
      const isBlue = h>=195 && h<=240 && blueExcess>39/sensitivity && mean[2]>237/sensitivity && mean[1]>182/sensitivity;
      const highlight = samples.some(p=>p[0]>140 && p[1]>215 && p[2]>235) && blueExcess>28/sensitivity;
      const occupied=isColored||isBlue||highlight;
      if(occupied) row|=1<<x;
      const emptyLike=cyan(...mean);
      confidences.push(occupied ? (isColored || isBlue ? .94 : .8) : emptyLike ? .96 : .45);
      colors.push(mean.map(Math.round));
    }
    board.push(row);
  }
  const confidence=confidences.reduce((a,b)=>a+b,0)/confidences.length;
  return {board,confidence,colors,uncertain:confidences.filter(v=>v<.6).length};
}
export function readPiece(image,rect) {
  if(!validRect(rect,image)) return {cells:[],status:'unknown',confidence:0,reason:'조각 영역을 다시 지정하세요.'};
  const w=Math.floor(rect.w),h=Math.floor(rect.h), mask=new Uint8Array(w*h);
  let white=0,teal=0;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const p=rgb(image,rect.x+x,rect.y+y),[hue,s,v]=hsv(...p);
    if(Math.min(...p)>215) white++;
    if(cyan(...p)) teal++;
    // The miniature tiles are saturated; the slot itself is white or cyan (used).
    if(s>.36 && v>.82 && (hue<165||hue>205)) mask[y*w+x]=1;
  }
  if(teal/(w*h)>.65 && white/(w*h)<.15) return {cells:[],status:'used',confidence:.96};
  const seen=new Uint8Array(w*h), components=[];
  for(let at=0;at<mask.length;at++) {
    if(!mask[at]||seen[at]) continue;
    const queue=[at];seen[at]=1;let minX=w,maxX=0,minY=h,maxY=0;
    for(let j=0;j<queue.length;j++) {
      const n=queue[j],x=n%w,y=Math.floor(n/w);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(const [xx,yy] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        const k=yy*w+xx;if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[k]&&!seen[k]){seen[k]=1;queue.push(k);}
      }
    }
    if(queue.length>=3) components.push({x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,area:queue.length});
  }
  if(!components.length) return {cells:[],status:white/(w*h)>.6?'empty':'unknown',confidence:white/(w*h)>.6?.85:0};
  const tiles=components.filter(c=>c.w>=3&&c.h>=3&&c.w/c.h>.65&&c.w/c.h<1.5&&c.w<w*.95&&c.h<h*.95);
  if(!tiles.length) return {cells:[],status:'unknown',confidence:0,reason:'블록 경계가 흐립니다. 조각 영역을 조정하거나 직접 수정하세요.'};
  const sizes=tiles.map(c=>(c.w+c.h)/2).sort((a,b)=>a-b),size=sizes[Math.floor(sizes.length/2)];
  const actual=tiles.filter(c=>Math.abs(c.w-size)<size*.45&&Math.abs(c.h-size)<size*.45);
  const minX=Math.min(...actual.map(c=>c.x)),minY=Math.min(...actual.map(c=>c.y));
  let pitch=size+1;
  const gaps=[];
  for(const a of actual) for(const b of actual) {
    if(Math.abs(a.y-b.y)<size*.4&&b.x>a.x+size*.7) gaps.push(b.x-a.x);
    if(Math.abs(a.x-b.x)<size*.4&&b.y>a.y+size*.7) gaps.push(b.y-a.y);
  }
  // A random shape can have gaps with no adjacent tiles. Do not compress a
  // two-cell gap into one cell just because it is the shortest observed gap.
  if(gaps.length) {
    const estimates=gaps.map(gap=>gap/Math.max(1,Math.round(gap/(size+1)))).sort((a,b)=>a-b);
    pitch=estimates[Math.floor(estimates.length/2)];
  }
  const cells=actual.map(c=>[Math.round((c.x-minX)/pitch),Math.round((c.y-minY)/pitch)]);
  const unique=[...new Map(cells.map(c=>[c.join(','),c])).values()];
  const residual=actual.reduce((s,c,i)=>s+Math.abs(c.x-minX-cells[i][0]*pitch)+Math.abs(c.y-minY-cells[i][1]*pitch),0)/actual.length;
  const covered=actual.reduce((s,c)=>s+c.area,0)/components.reduce((s,c)=>s+c.area,0);
  const confidence=Math.max(0,Math.min(.99,1-residual/Math.max(size,1)-Math.max(0,.85-covered)));
  if(unique.some(c=>c[0]>9||c[1]>9)||confidence<.65) return {cells:unique,status:'unknown',confidence,reason:'조각 격자를 확인하세요.'};
  return {cells:unique,status:'ready',confidence,pitch};
}
export function recognize(image,calibration,settings={}) {
  const {cols=10,rows=16,sensitivity=1}=settings;
  const result=readBoard(image,calibration.board,cols,rows,sensitivity);
  if(result.error) return result;
  const pieces=calibration.slots.map((rect,id)=>({id,...readPiece(image,rect)}));
  return {...result,pieces,signature:JSON.stringify([result.board,pieces.map(p=>[p.status,p.cells])]),safe:result.confidence>.85&&result.uncertain===0&&pieces.every(p=>p.status==='ready'||p.status==='used')};
}
