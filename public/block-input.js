// Modern Hangul in two-set (두벌식) keyboard order. Preserve shifted keys
// before splitting doubled consonants and multi-key vowels into block names.
const keys=Object.fromEntries(Array.from('qwertyuiopasdfghjklzxcvbnm').map((key,i)=>[key,Array.from('ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔㅁㄴㅇㄹㅎㅗㅓㅏㅣㅋㅌㅊㅍㅠㅜㅡ')[i]]));
const shifted={Q:'ㅃ',W:'ㅉ',E:'ㄸ',R:'ㄲ',T:'ㅆ',O:'ㅒ',P:'ㅖ'};
const combined={ㄲ:'ㄱㄱ',ㄸ:'ㄷㄷ',ㅃ:'ㅂㅂ',ㅆ:'ㅅㅅ',ㅉ:'ㅈㅈ',
  ㄳ:'ㄱㅅ',ㄵ:'ㄴㅈ',ㄶ:'ㄴㅎ',ㄺ:'ㄹㄱ',ㄻ:'ㄹㅁ',ㄼ:'ㄹㅂ',ㄽ:'ㄹㅅ',ㄾ:'ㄹㅌ',ㄿ:'ㄹㅍ',ㅀ:'ㄹㅎ',ㅄ:'ㅂㅅ',
  ㅘ:'ㅗㅏ',ㅙ:'ㅗㅐ',ㅚ:'ㅗㅣ',ㅝ:'ㅜㅓ',ㅞ:'ㅜㅔ',ㅟ:'ㅜㅣ',ㅢ:'ㅡㅣ'};
const jamo=new Map();
for(const [base,letters] of [[0x1100,'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'],
  [0x1161,'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'],
  [0x11a8,'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ']]){
  Array.from(letters).forEach((letter,i)=>jamo.set(String.fromCodePoint(base+i),letter));
}
export function normalizeBlockInput(value){
  return Array.from(value.normalize('NFD')).map(char=>{
    const letter=shifted[char]||keys[char.toLowerCase()]||jamo.get(char)||char;
    return combined[letter]||letter;
  }).join('').replace(/\s/g,'');
}
export function blocksNamed(blocks,value){
  const exact=value.trim().normalize('NFC'),literal=blocks.filter(block=>block.name.normalize('NFC')===exact);
  if(literal.length)return literal;
  const normalized=normalizeBlockInput(value);
  return normalized?blocks.filter(block=>normalizeBlockInput(block.name)===normalized):[];
}
export function blockNameIncludes(name,query){
  const needle=query.trim().normalize('NFC');
  return name.normalize('NFC').toLocaleLowerCase('ko').includes(needle.toLocaleLowerCase('ko'))
    ||normalizeBlockInput(name).includes(normalizeBlockInput(needle));
}
