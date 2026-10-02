import {writeFile,rename} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
// Windows readers/antivirus can briefly deny replacing a destination. Preserve
// the complete temporary file and retry; never truncate the current checkpoint.
export async function atomicJson(file,data,{renameFile=rename,delay=sleep}={}){
  const temp=`${file}.tmp`;await writeFile(temp,JSON.stringify(data));
  for(let attempt=0;;attempt++){
    try{await renameFile(temp,file);return;}
    catch(error){if(!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt===9)throw error;await delay(Math.min(100,10*(attempt+1)));}
  }
}
