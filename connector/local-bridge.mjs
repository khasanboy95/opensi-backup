import http from 'node:http';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile,readFile,stat,copyFile,rm} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {execFile} from 'node:child_process';
import {safePath} from '../server/files.mjs';

const max=1_000_000_000;
const validId=id=>/^att_[a-f0-9]{24}$/.test(id);
function validName(name){if(!name||name.length>160||/[\\/\x00-\x1f]/.test(name))throw Error('Fayl nomi noto‘g‘ri.');return name;}
function pickWindows(){return new Promise((resolve,reject)=>{
 const script="Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; if($d.ShowDialog() -eq 'OK'){ $j=ConvertTo-Json -InputObject @($d.FileNames) -Compress; [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($j))) }";
 execFile('powershell.exe',['-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:120000,maxBuffer:100000},(e,out)=>{if(e)return reject(Error('Fayl tanlash oynasi yopildi yoki javob bermadi.'));try{resolve(out.trim()?JSON.parse(Buffer.from(out.trim(),'base64').toString('utf8')):[]);}catch{reject(Error('Fayl tanlash javobi noto‘g‘ri.'));}});
});}

export async function startLocalBridge({server,nodeId,stateDir,api}){
 const directory=path.join(stateDir,'local-inputs');await mkdir(directory,{recursive:true});let busy=0,picking=false;
 async function register(source,name,mime,size,id='att_'+randomBytes(12).toString('hex')){
  await writeFile(path.join(directory,id+'.json'),JSON.stringify({source,name,mime,size}),{mode:0o600,flag:'wx'});
  try{return await api('/attachment',{id,name,mime,size});}catch(e){await rm(path.join(directory,id+'.json'),{force:true});throw e;}
 }
 const listener=http.createServer(async(req,res)=>{
  const respond=(status,value)=>{if(!res.headersSent)res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value));};
  try{
   if(req.headers.origin!==server||req.headers.host!==`127.0.0.1:${listener.address().port}`)return respond(403,{error:'Origin denied'});
   res.setHeader('Access-Control-Allow-Origin',server);res.setHeader('Vary','Origin');
   if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type,x-opensi-local-ticket,x-file-name,x-file-type');res.setHeader('Access-Control-Allow-Private-Network','true');res.writeHead(204);return res.end();}
   if(req.method!=='POST')return respond(405,{error:'POST required'});
   const ticket=req.headers['x-opensi-local-ticket'];if(typeof ticket!=='string'||ticket.length>100)return respond(401,{error:'Local ticket required'});
   await api('/local-ticket',{ticket});
   if(req.url==='/status')return respond(200,{nodeId,nativePicker:process.platform==='win32'});
   if(req.url==='/pick'){
    if(process.platform!=='win32')return respond(409,{error:'Bu tizimda faylni brauzerga tashlang.'});
    if(picking)return respond(409,{error:'Fayl tanlash oynasi allaqachon ochiq.'});picking=true;
    try{const selected=await pickWindows(),files=[];for(const source of selected.slice(0,100)){const info=await stat(source);if(!info.isFile()||info.size>max)throw Error('Fayl 1 GB chegarasidan oshdi.');files.push(await register(source,validName(path.basename(source)),'application/octet-stream',info.size));}return respond(200,{files});}finally{picking=false;}
   }
   if(req.url!=='/files')return respond(404,{error:'Not found'});
   if(busy>=2)return respond(429,{error:'Lokal fayl tayyorlanmoqda. Qayta urinib ko‘ring.'});
   const name=validName(decodeURIComponent(req.headers['x-file-name']||'')),mime=String(req.headers['x-file-type']||'application/octet-stream').slice(0,150);
   if(Number(req.headers['content-length'])>max)return respond(413,{error:'Fayl 1 GB dan katta.'});
   const id='att_'+randomBytes(12).toString('hex'),target=path.join(directory,id+'.bin');let size=0,ok=false;busy++;
   try{await pipeline(req,new Transform({transform(chunk,_encoding,done){size+=chunk.length;done(size>max?Error('Fayl 1 GB dan katta.'):null,chunk);}}),createWriteStream(target,{flags:'wx',mode:0o600}));const file=await register(target,name,mime,size,id);ok=true;respond(201,file);}finally{busy--;if(!ok)await rm(target,{force:true});}
  }catch(e){respond(400,{error:String(e.message).slice(0,250)});}
 });
 listener.requestTimeout=30*60_000;
 await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
 return {port:listener.address().port,close:()=>new Promise(resolve=>{listener.close(resolve);listener.closeAllConnections();}),async prepare(root,{id}){
  if(!validId(id))throw Error('Biriktirma identifikatori noto‘g‘ri.');
  const saved=JSON.parse(await readFile(path.join(directory,id+'.json'),'utf8')),info=await stat(saved.source);
  if(!info.isFile()||info.size>max)throw Error('Lokal fayl topilmadi yoki hajmi o‘zgargan.');
  const relative=`inputs/${id}/${validName(saved.name)}`,target=await safePath(root,relative);await mkdir(path.dirname(target),{recursive:true});await copyFile(saved.source,target);
  const ext=path.extname(saved.name).toLowerCase(),mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp'}[ext];
  return {path:relative,...(mime&&info.size<=5_000_000?{image:`data:${mime};base64,${(await readFile(target)).toString('base64')}`}:{})};
 }};
}
