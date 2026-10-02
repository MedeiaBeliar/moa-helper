export const SCORE_CAP=500000;
export const TARGET_SCORES=Object.freeze([...new Set([
  100000,111111,120200,123456,
  150000,200000,222222,250000,300000,333333,350000,400000,444444,450000,211000,211211
])].sort((a,b)=>a-b));
const targetSet=new Set(TARGET_SCORES);
export const isTargetScore=score=>targetSet.has(score);
export const nextTarget=score=>Number.isInteger(score)?TARGET_SCORES.find(value=>value>score)??null:null;
export function addScore(score,delta){
  if(!Number.isSafeInteger(delta)||delta<0)throw new Error('추가 점수가 올바르지 않습니다.');
  if(score==null)return null;
  if(!Number.isInteger(score)||score<0||score>SCORE_CAP)throw new Error('현재 점수는 0~500,000 사이로 입력하세요.');
  return Math.min(SCORE_CAP,score+delta);
}
export function validateSkillIcons(icons,cols,rows){
  if(icons===undefined)return [];
  if(!Array.isArray(icons)||icons.length>3)throw new Error('능력 위치는 최대 3개까지 표시할 수 있습니다.');
  const seen=new Set();
  return icons.map(icon=>{
    if(!icon||!Number.isInteger(icon.x)||!Number.isInteger(icon.y)||icon.x<0||icon.x>=cols||icon.y<0||icon.y>=rows||!['dot','reroll'].includes(icon.kind))throw new Error('능력 위치와 종류를 확인하세요.');
    const key=`${icon.x},${icon.y}`;if(seen.has(key))throw new Error('같은 칸에 능력을 중복 표시할 수 없습니다.');seen.add(key);
    return {x:icon.x,y:icon.y,kind:icon.kind};
  });
}
// Collection happens after skill spending and clearing. At capacity, icons on
// cleared rows disappear without granting another skill or acquisition points.
export function collectSkillIcons(icons,cleared,heldAfterSpend){
  const kept=[],acquired=[];let held=heldAfterSpend;
  for(const icon of icons||[]){
    if(!cleared.includes(icon.y)){kept.push(icon);continue;}
    if(held<7){acquired.push(icon);held++;}
  }
  return {icons:kept,acquired,held,score:acquired.length*50};
}
// Recompute from actual move geometry, never trust a caller's score fields.
// Only existing, manually marked icons are known. No future spawns are assumed.
export function scoreMoves(currentScore,moves,{skillIcons=[],skills={dot:0,reroll:0}}={}){
  let after=currentScore??null,icons=skillIcons.slice(),held=(skills.dot||0)+(skills.reroll||0);
  let placementScore=0,lineScore=0,acquisitionScore=0,acquiredCount=0;
  const skillsAfter={dot:skills.dot||0,reroll:skills.reroll||0};
  const scored=moves.map(move=>{
    const dot=move.kind==='dot';if(dot){held--;skillsAfter.dot--;}
    if(held<0||skillsAfter.dot<0)throw new Error('점 찍기 스킬이 부족합니다.');
    const placed=dot?1:move.cells.length,line=300*move.cleared.length**2;
    const collected=collectSkillIcons(icons,move.cleared,held);icons=collected.icons;held=collected.held;
    for(const icon of collected.acquired)if(icon.kind==='dot'||icon.kind==='reroll')skillsAfter[icon.kind]++;
    acquiredCount+=collected.acquired.length;placementScore+=placed;lineScore+=line;acquisitionScore+=collected.score;
    const score=placed+line+collected.score;after=addScore(after,score);
    return {...move,placementScore:placed,lineScore:line,acquisitionScore:collected.score,score,
      acquiredIcons:collected.acquired,heldSkills:held,scoreAfter:after};
  });
  return {moves:scored,after,icons,acquiredCount,held,skillsAfter,placementScore,lineScore,acquisitionScore,score:placementScore+lineScore+acquisitionScore};
}
export function targetPath(currentScore,moves){
  let after=currentScore??null,hit=null,hitStep=null;
  for(let index=0;index<moves.length;index++){
    const move=moves[index];after=addScore(after,move.score??((move.kind==='dot'?1:move.cells.length)+300*move.cleared.length**2+(move.acquisitionScore||0)));
    // Only a new exact score with available skill capacity is a stopping point.
    if(hit===null&&after!==currentScore&&isTargetScore(after)&&(move.heldSkills??0)<7){hit=after;hitStep=index+1;}
  }
  const next=nextTarget(after);
  return {hit,hitStep,after,next,distance:next===null||after===null?null:next-after};
}
