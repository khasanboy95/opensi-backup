import {mkdir,writeFile,readdir,lstat} from 'node:fs/promises';
import {projectRoot,safePath} from './files.mjs';
import {id,HttpError} from './security.mjs';

export function evidenceType(bytes){
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext:'png',mime:'image/png'};
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {ext:'jpg',mime:'image/jpeg'};
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {ext:'webp',mime:'image/webp'};
 if(/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return {ext:'gif',mime:'image/gif'};
 const signature=bytes.toString('ascii',0,4);
 if(signature==='wOF2')return {ext:'woff2',mime:'font/woff2'};
 if(signature==='wOFF')return {ext:'woff',mime:'font/woff'};
 return null;
}
export async function saveBrowserEvidence({config,project,run,nodes,result,signal}){
 const root=projectRoot(config,project);const folder=`inputs/att_capture_${id('')}`;
 const inputDir=await safePath(root,'inputs');await mkdir(inputDir,{recursive:true});
 const captures=(await readdir(inputDir)).filter(n=>n.startsWith('att_capture_'));
 let used=0,stored=0;for(const capture of captures){const directory=await safePath(root,`inputs/${capture}`);let bytes=0;for(const file of await readdir(directory)){const info=await lstat(await safePath(root,`inputs/${capture}/${file}`));if(info.isFile())bytes+=info.size;}used+=bytes;if(bytes)stored++;}
 // Local connector evidence and interrupted saves can leave empty reservations.
 // They contain no server evidence and must not consume a collection slot.
 if(stored>=30||used>=100_000_000)throw new HttpError(413,'Ushbu loyihada brauzer dalillari uchun 100 MB/30 to‘plam chegarasi.');
 const files=[];let bytesTotal=0;
 const stage=(name,bytes)=>{if(bytes.length>5_000_000||bytesTotal+bytes.length>30_000_000||used+bytesTotal+bytes.length>100_000_000)throw new HttpError(413,'Brauzer dalillari hajmi katta. Kamroq ekran bilan qayta oling.');bytesTotal+=bytes.length;const path=`${folder}/${name}`;files.push({path,bytes});return path;};
 const frames=[];const images=[];
 for(const [index,frame] of (result.frames||[]).slice(0,12).entries()){
  const bytes=Buffer.from(frame.image||'','base64'),kind=evidenceType(bytes);
  if(!kind?.mime.startsWith('image/'))throw new HttpError(502,'Brauzer haqiqiy screenshot qaytarmadi.');
  const screenshot=stage(`screen-${index+1}.${kind.ext}`,bytes);const {image,...evidence}=frame;
  const details=stage(`screen-${index+1}.json`,Buffer.from(JSON.stringify(evidence,null,2)));
  frames.push({screenshot,details,stateLabel:frame.stateLabel||null,scrollY:frame.scrollY,width:frame.width,height:frame.height,title:frame.title,visibleText:(frame.viewportText||frame.text||'').slice(0,300)});
  images.push({path:screenshot,mime:kind.mime,base64:frame.image});
 }
 const assets=[];const missingAssets=[...(result.missingAssets||[])];
 for(const [index,asset] of (result.assets||[]).slice(0,40).entries()){
  const bytes=Buffer.from(asset.body||'','base64'),kind=evidenceType(bytes);
  if(!kind){missingAssets.push({url:asset.url,reason:'Qo‘llanmagan yoki tekshirilmagan format; asl screenshotdan foydalaning.'});continue;}
  const path=stage(`asset-${index+1}.${kind.ext}`,bytes);assets.push({url:asset.url,path,mime:kind.mime,bytes:bytes.length});
 }
 const links=[...new Map((result.frames||[]).flatMap(frame=>frame.design?.links||[]).map(link=>[link.url,link])).values()].slice(0,150);
 const manifest={source:'untrusted_browser_content',url:result.url,capturedAt:new Date().toISOString(),mobile:result.mobile,...(result.publicPage?{publicPage:true}:{}),viewport:result.viewport,atBottom:Boolean(result.atBottom),truncated:Boolean(result.truncated),continuation:result.continuation||null,frames,assets,missingAssets,links};
 const manifestPath=stage('manifest.json',Buffer.from(JSON.stringify(manifest,null,2)));
 await mkdir(await safePath(root,folder),{recursive:true});
 for(const file of files){signal?.throwIfAborted();if(project.environment!=='local')await writeFile(await safePath(root,file.path),file.bytes,{flag:'wx'});
  if(project.environment==='local'){if(!nodes)throw new Error('Lokal connector mavjud emas.');for(let offset=0;offset<file.bytes.length;offset+=750000){signal?.throwIfAborted();await nodes.dispatch(project,run.id,'upload_chunk',{path:file.path,offset,base64:file.bytes.subarray(offset,offset+750000).toString('base64')},signal);}}
 }
 const selected=[...new Set([0,Math.floor(images.length/2),images.length-1])].filter(i=>i>=0&&images[i]);
 return {...manifest,manifestPath,bytes:bytesTotal,_images:selected.map(i=>images[i])};
}
