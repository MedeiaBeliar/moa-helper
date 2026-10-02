// A standalone console menu. It never starts the local web server.
import {createInterface} from 'node:readline/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {recommendedParallelism} from './target-resource-budget.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
let child=null,closing=false;
process.chdir(root);
process.on('SIGINT',()=>{
  if(child){console.log('\n종료 요청을 받았습니다. 현재 동작을 마치고 결과를 저장합니다.');return;}
  closing=true;process.exitCode=0;process.stdin.destroy();
});
async function ask(prompt){
  const input=createInterface({input:process.stdin,output:process.stdout});
  try{return (await input.question(prompt)).trim();}finally{input.close();}
}
async function run(args){
  console.log('\nCtrl+C: 검증 종료 / 장기 비교는 체크포인트 저장 후 중지\n');
  return new Promise(resolve=>{
    child=spawn(process.execPath,args,{cwd:root,stdio:'inherit'});
    child.once('error',error=>{console.error(error.message);child=null;resolve(1);});
    child.once('exit',(code,signal)=>{child=null;console.log(`\n실행 종료 (${signal||code}).\n`);resolve(code??1);});
  });
}
try{
  while(!closing){
    console.log('모아모아 목표 점수 테스트\n');
    console.log('1. 짧은 기능 검증 (웹서버 없이 Node 단위 테스트)');
    console.log(`2. 저부하 병렬 테스트 · 목표 ON/OFF 6게임 (최대 ${recommendedParallelism()}개 동시 계산)`);
    console.log('   게임별 목표 진행 막대 · 남은 점수 · 도달 이력 / 사망까지 계속');
    console.log('q. 종료\n');
    const choice=(await ask('선택: ')).toLowerCase();
    if(choice==='q')break;
    if(choice==='1'){
      const {scripts}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
      if(!scripts.test?.startsWith('node --test '))throw new Error('package.json의 Node 단위 테스트 명령을 확인하세요.');
      // The repository's test command contains simple whitespace-separated paths.
      // Avoid a shell/nested .cmd process and its Ctrl+C batch confirmation.
      await run([...scripts.test.slice(5).trim().split(/\s+/).slice(0,1),'--test-concurrency=2',...scripts.test.slice(5).trim().split(/\s+/).slice(1)]);
    }else if(choice==='2'){
      console.log('\n목표·50만점 도달 후에도 사망할 때까지 진행합니다. 수 시간 이상 걸릴 수 있습니다.');
      console.log('낮은 우선순위, 계산 사이 휴식, PC 부하에 따른 자동 감속을 적용합니다.');
      console.log('중지한 테스트는 출력된 실행 ID로 재개할 수 있습니다. 코드를 수정했다면 새로 시작하세요.');
      const id=await ask('재개할 실행 ID (새 비교는 Enter): ');
      if(id&&!/^[a-zA-Z0-9_-]+$/.test(id)){console.log('실행 ID에는 영문, 숫자, 밑줄, 하이픈만 사용할 수 있습니다.\n');continue;}
      const args=['tests/target-benchmark.mjs'];
      if(id)args.push('--run',id);
      else{
        const seed=await ask('추첨 시드 (Enter = 509): ');
        if(seed&&!/^\d+$/.test(seed)){console.log('0부터 4294967295 사이의 정수를 입력하세요.\n');continue;}
        if(seed)args.push('--seed',seed);
        const pairs=await ask('비교할 시드 수 1~4 (Enter = 3, 목표 ON/OFF 총 6게임): ');
        if(pairs&&!/^[1-4]$/.test(pairs)){console.log('1부터 4까지 입력하세요.\n');continue;}
        if(pairs)args.push('--pairs',pairs);
      }
      const parallel=await ask(`최대 동시 계산 1~${recommendedParallelism()} (Enter = 자동 ${recommendedParallelism()}): `);
      if(parallel&&(!/^[1-4]$/.test(parallel)||Number(parallel)>recommendedParallelism())){console.log('표시된 범위 안에서 선택하세요.\n');continue;}
      if(parallel)args.push('--parallel',parallel);
      await run(args);
    }
  }
}catch(error){if(!closing){console.error(error.stack||error);process.exitCode=1;await ask('Enter를 누르면 종료합니다.');}}
