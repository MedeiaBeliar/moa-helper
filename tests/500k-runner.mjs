// No setup prompts. Keep the result visible when launched from the CMD file.
import {createInterface} from 'node:readline/promises';

if(!process.argv.includes('--preset'))process.argv.push('--preset','500k');
try{await import('./target-benchmark.mjs');}
catch(error){console.error(error.stack||String(error));process.exitCode=1;}
if(process.stdin.isTTY&&!process.argv.includes('--help')){
  const terminal=createInterface({input:process.stdin,output:process.stdout});
  try{await terminal.question('\nEnter를 누르면 창을 닫습니다.');}finally{terminal.close();}
}
