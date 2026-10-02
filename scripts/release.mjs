// A portable source ZIP with no archiver dependency or subprocess.
import './check-release.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import path from 'node:path';
import {releaseFiles,root} from './release-files.mjs';

const table=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=buffer=>{let value=0xffffffff;for(const byte of buffer)value=table[(value^byte)&255]^(value>>>8);return(value^0xffffffff)>>>0;};
const local=[],central=[],manifest=[];
let offset=0,centralSize=0;
for(const file of await releaseFiles()){
  const body=await readFile(path.join(root,file)),packed=deflateRawSync(body),name=Buffer.from(`moa-helper/${file}`),crc=crc32(body);
  // Fixed DOS date and file order make identical source trees reproducible.
  const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);
  header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(packed.length,18);
  header.writeUInt32LE(body.length,22);header.writeUInt16LE(name.length,26);
  local.push(header,name,packed);
  const record=Buffer.alloc(46);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);
  record.writeUInt16LE(0x800,8);record.writeUInt16LE(8,10);record.writeUInt16LE(0x21,14);record.writeUInt32LE(crc,16);
  record.writeUInt32LE(packed.length,20);record.writeUInt32LE(body.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(offset,42);
  central.push(record,name);centralSize+=record.length+name.length;offset+=header.length+name.length+packed.length;
  manifest.push(`${createHash('sha256').update(body).digest('hex')}  ${file}`);
}
const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(manifest.length,8);end.writeUInt16LE(manifest.length,10);
end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);
const zip=Buffer.concat([...local,...central,end]),directory=path.join(root,'releases'),name='moa-helper-github.zip';
await mkdir(directory,{recursive:true});await writeFile(path.join(directory,name),zip);
await writeFile(path.join(directory,`${name}.sha256`),`${createHash('sha256').update(zip).digest('hex')}  ${name}\n`);
await writeFile(path.join(directory,'source-manifest.sha256'),manifest.join('\n')+'\n');
console.log(`Created releases/${name}: ${manifest.length} files, ${(zip.length/1024/1024).toFixed(2)} MiB`);
