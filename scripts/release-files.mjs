import {readdir,stat,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=fileURLToPath(new URL('../',import.meta.url));
// Explicit roots keep player data and old local archives out of public bundles.
const roots=['.github','.gitignore','.gitattributes','.editorconfig','public','tests','docs','examples','scripts',
  'README.md','AGENTS.md','CONTRIBUTING.md','SECURITY.md','LICENSE','THIRD_PARTY_NOTICES.md',
  'package.json','package-lock.json','server.mjs','storage.mjs','start.cmd','test-targets.cmd','test-500k.cmd'];

export async function releaseFiles(){
  const files=[];
  async function visit(relative){
    const absolute=path.join(root,relative),info=await lstat(absolute);
    if(info.isSymbolicLink())throw new Error(`배포 경로에는 심볼릭 링크를 넣을 수 없습니다: ${relative}`);
    if(info.isDirectory())for(const name of (await readdir(absolute)).sort())await visit(`${relative}/${name}`);
    else{
      if(/(^|\/)(data|node_modules|test-results|\.git|\.hallmark|releases)(\/|$)|\.(zip|log|tmp)$|(^|\/)\.env(?:\.|$)/i.test(relative))throw new Error(`배포 제외 경로: ${relative}`);
      if((await stat(absolute)).size>10*1024*1024)throw new Error(`10MB 초과 파일을 확인하세요: ${relative}`);
      files.push(relative);
    }
  }
  for(const relative of roots)await visit(relative);
  return files.sort();
}
