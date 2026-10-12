import { readFile } from 'node:fs/promises';
import { listFiles, safePath } from './files.mjs';
import { HttpError } from './security.mjs';
import {createReadStream} from 'node:fs';

// ZIP method 0 (stored), UTF-8 filenames. Bounded export, no shell or external archive process.
const crcTable = Array.from({length:256},(_,n)=>{ for(let k=0;k<8;k++) n=n&1 ? 0xedb88320^(n>>>1) : n>>>1; return n>>>0; });
const crc32 = bytes => { let crc=0xffffffff; for(const byte of bytes) crc=crcTable[(crc^byte)&255]^(crc>>>8); return (crc^0xffffffff)>>>0; };
// Stream large exports with ZIP data descriptors; memory stays bounded to one chunk.
export async function* projectZipStream(root){
 const files=await listFiles(root,{maxFiles:5000,strict:true});let total=0;for(const f of files)if(f.size>1_000_000_000||(total+=f.size)>2_000_000_000)throw new HttpError(413,'ZIP 2 GB yoki bitta fayl 1 GB dan oshdi.');
 const directory=[];let offset=0;
 for(const f of files){const file=await safePath(root,f.path),name=Buffer.from(f.path),start=offset;let size=0,crc=0xffffffff;const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt16LE(0x808,6);header.writeUInt16LE(name.length,26);yield header;yield name;offset+=30+name.length;
  for await(const chunk of createReadStream(file)){size+=chunk.length;if(size>f.size)throw new Error('Eksport paytida fayl o‘zgardi. Qayta yuklang.');for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8);yield chunk;offset+=chunk.length;}
  if(size!==f.size)throw new Error('Eksport paytida fayl o‘zgardi.');crc=(crc^0xffffffff)>>>0;const descriptor=Buffer.alloc(16);descriptor.writeUInt32LE(0x08074b50);descriptor.writeUInt32LE(crc,4);descriptor.writeUInt32LE(size,8);descriptor.writeUInt32LE(size,12);yield descriptor;offset+=16;
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x808,8);central.writeUInt32LE(crc,16);central.writeUInt32LE(size,20);central.writeUInt32LE(size,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(start,42);directory.push(central,name);
 }
 const bytes=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(bytes.length,12);end.writeUInt32LE(offset,16);yield bytes;yield end;
}
export async function projectZip(root) {
  const files = await listFiles(root,{maxFiles:5000,strict:true}); const chunks = []; const directory = []; let offset=0; let size=0;
  for (const file of files) {
    if (file.size > 50_000_000 || (size+=file.size)>200_000_000) throw new HttpError(413,'ZIP hajmi 200 MB yoki bitta fayl 50 MB dan oshdi.');
    const content=await readFile(await safePath(root,file.path)); const name=Buffer.from(file.path); const crc=crc32(content);
    const header=Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20,4); header.writeUInt16LE(0x800,6); header.writeUInt32LE(crc,14); header.writeUInt32LE(content.length,18); header.writeUInt32LE(content.length,22); header.writeUInt16LE(name.length,26);
    const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6); central.writeUInt16LE(0x800,8); central.writeUInt32LE(crc,16); central.writeUInt32LE(content.length,20); central.writeUInt32LE(content.length,24); central.writeUInt16LE(name.length,28); central.writeUInt32LE(offset,42);
    chunks.push(header,name,content); directory.push(central,name); offset+=header.length+name.length+content.length;
  }
  const directoryBytes=Buffer.concat(directory); const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length/2,8); end.writeUInt16LE(directory.length/2,10); end.writeUInt32LE(directoryBytes.length,12); end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,directoryBytes,end]);
}
