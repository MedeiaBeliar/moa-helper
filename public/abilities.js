import {validateSkillIcons} from './targets.js';

export const iconKey=icon=>`${icon.x},${icon.y}`;
export function validateSpawnRemaining(value){
  if(value==null)return null;
  if(!Number.isInteger(value)||value<1||value>7)throw new Error('다음 능력 등장까지 남은 배치는 1~7회로 입력하거나 비워 두세요.');
  return value;
}
export function advanceSpawnRemaining(value,placements){
  const remaining=validateSpawnRemaining(value);
  if(!Number.isSafeInteger(placements)||placements<0)throw new Error('배치 횟수가 올바르지 않습니다.');
  return remaining===null?null:((remaining-1-placements)%7+7)%7+1;
}
export function validateIconOrder(order,icons){
  if(order===undefined)return [];
  const keys=new Set(icons.map(iconKey));
  if(!Array.isArray(order)||order.some(key=>typeof key!=='string'||!keys.has(key))||new Set(order).size!==order.length)
    throw new Error('능력 등장 순서 기록이 올바르지 않습니다.');
  return order.slice();
}
export function remainingIconOrder(state,icons=state.skillIcons||[]){
  const keys=new Set(icons.map(iconKey));
  return (state.skillIconOrder||[]).filter(key=>keys.has(key));
}
// Old markers have no implied age. Only explicitly observed new appearances
// enter the ordered list; correcting their type retains the original age.
export function editSkillIcon(state,icon,{newlyAppeared=false}={}){
  const [clean]=validateSkillIcons([icon],state.cols,state.rows),key=iconKey(clean);
  const icons=(state.skillIcons||[]).slice();let order=remainingIconOrder(state),expired=null;
  const at=icons.findIndex(item=>iconKey(item)===key);
  if(at>=0){
    if(icons[at].kind===clean.kind){icons.splice(at,1);order=order.filter(item=>item!==key);}
    else icons[at]=clean;
  }else{
    if(icons.length===3){
      if(!newlyAppeared||order.length!==icons.length)throw new Error('등장 순서를 확정할 수 없습니다. 게임에서 사라진 능력을 직접 지운 뒤 새 위치를 추가하세요.');
      const oldest=order.shift(),index=icons.findIndex(item=>iconKey(item)===oldest);
      [expired]=icons.splice(index,1);
    }
    icons.push(clean);if(newlyAppeared)order.push(key);
  }
  return {state:{...state,skillIcons:icons,skillIconOrder:order},expired};
}
