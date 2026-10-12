import path from 'node:path';
import {mkdir,readFile,writeFile,rm,lstat,statfs} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {projectRoot,listFiles,safePath,validFileName} from './files.mjs';
import {linkedProject} from './project-links.mjs';
import {previewSource} from './preview-source.mjs';
import {HttpError,now} from './security.mjs';

const extensions=new Set('.html .htm .css .js .mjs .json .png .jpg .jpeg .webp .gif .svg .ico .woff .woff2 .ttf .otf .wasm .mp3 .wav .ogg .mp4 .webm .pdf'.split(' '));
const maxBytes=25_000_000,maxFile=5_000_000,maxFiles=1000;
export function publishable(name){
 try{validFileName(name);}catch{return false;}
 return extensions.has(path.posix.extname(name).toLowerCase())&&!name.split('/').some(p=>/^(?:src|server|api|tests?|coverage|inputs|node_modules|config|credentials|secrets?)(?:[.-]|$)/i.test(p)||/^(?:package(?:-lock)?|tsconfig|vercel|opensi-artifact)\./i.test(p));
}
const secretPattern=/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|\b\d{7,12}:[A-Za-z0-9_-]{30,}|["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["'][^"'\s]{12,}["'])/i;

export function publishingService({store,config,nodes}){
 store.exec(`CREATE TABLE IF NOT EXISTS publications(project_id TEXT PRIMARY KEY REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),slug TEXT UNIQUE NOT NULL,revision TEXT NOT NULL,entry TEXT NOT NULL,manifest TEXT NOT NULL,bytes INTEGER NOT NULL,updated_at TEXT NOT NULL)`);
 const locks=new Set(),root=path.join(config.dataDir,'publications');
 const current=p=>store.one('SELECT * FROM publications WHERE project_id=?',p.id);
 const metadata=row=>row?{url:new URL('/p/'+row.slug+'/',config.appUrl).href,entry:row.entry,files:JSON.parse(row.manifest).length,bytes:row.bytes,updatedAt:row.updated_at}:null;
 async function inventory(p){
  if(!linkedProject(store,p))return listFiles(projectRoot(config,p),{maxFiles:5000,strict:true});
  const files=[];let offset=0;
  while(true){const page=await nodes.dispatch(p,null,'list_files',{offset,limit:500});files.push(...page.files);if(files.length>5000)throw new HttpError(413,'Loyiha juda katta. Alohida build papkasini tanlang.');if(page.nextOffset==null)break;if(page.nextOffset<=offset)throw new HttpError(409,'Connector fayllar ro‘yxatini tugatmadi.');offset=page.nextOffset;}
  return files;
 }
 async function candidates(p){const files=await inventory(p);return {publication:metadata(current(p)),entries:files.filter(f=>/\.html?$/i.test(f.path)&&publishable(f.path)).map(f=>f.path).sort((a,b)=>(a==='dist/index.html'?-2:a==='index.html'?-1:0)-(b==='dist/index.html'?-2:b==='index.html'?-1:0)),files:files.filter(f=>publishable(f.path)),limits:{bytes:maxBytes,fileBytes:maxFile,files:maxFiles}};}
 async function locked(p,fn){if(locks.has(p.user_id))throw new HttpError(409,'Nashr tayyorlanmoqda. Bir oz kuting.');if(locks.size>=4)throw new HttpError(429,'Nashr xizmati band. Birozdan keyin urinib ko‘ring.');locks.add(p.user_id);try{return await fn();}finally{locks.delete(p.user_id);}}
 async function publish(p,input){return locked(p,async()=>{
  if(!input||typeof input.entry!=='string'||!Array.isArray(input.files)||!input.files.length||input.files.length>maxFiles||!input.files.includes(input.entry)||!/\.html?$/i.test(input.entry))throw new HttpError(400,'HTML sahifa va nashr fayllarini tanlang.');
  const names=[...new Set(input.files)];if(names.some(n=>typeof n!=='string'||!publishable(n)))throw new HttpError(400,'Faqat ochiq statik fayllarni nashr qilish mumkin.');
  const all=new Map((await inventory(p)).map(f=>[f.path,f]));
  const prefix=path.posix.dirname(input.entry)==='.'?'':path.posix.dirname(input.entry)+'/';
  if(names.some(n=>!all.has(n)||!n.startsWith(prefix)))throw new HttpError(400,'Tanlangan fayl HTML papkasida mavjud emas.');
  const previous=current(p),revision=randomBytes(16).toString('hex'),dir=path.join(root,revision),slug=previous?.slug||randomBytes(16).toString('hex');
  const other=store.one('SELECT COALESCE(SUM(bytes),0) AS bytes FROM publications WHERE user_id=? AND project_id!=?',p.user_id,p.id).bytes;
  let bytes=0;const manifest=[];
  await mkdir(dir,{recursive:true});
  try{
   const disk=await statfs(dir);if(disk.bavail*disk.bsize<maxBytes+256_000_000)throw new HttpError(507,'Serverda nashr uchun bo‘sh joy yetarli emas. Oldingi nashrlarni yoping.');
   for(const name of names){
    if(all.get(name).size>maxFile)throw new HttpError(413,'Bitta nashr fayli 5 MB dan oshmasin.');
    let data;
    if(linkedProject(store,p)){const result=await nodes.dispatch(p,null,'preview_file',{path:name});data=Buffer.from(result.base64,'base64');}
    else {const target=await safePath(projectRoot(config,p),name);const stat=await lstat(target);if(!stat.isFile()||stat.size>maxFile)throw new HttpError(413,'Nashr fayli hajmi katta.');data=await readFile(target);}
    bytes+=data.length;if(data.length>maxFile||bytes>maxBytes||bytes+other>100_000_000)throw new HttpError(413,'Nashr 25 MB, hisobdagi jami nashrlar 100 MB dan oshmasin.');
    if(/\.(?:html?|css|[cm]?js|json)$/i.test(name)&&secretPattern.test(data.toString('utf8')))throw new HttpError(400,'Tanlangan faylda maxfiy kalitga o‘xshash qiymat bor: '+name+'. Uni ochiq koddan olib tashlang.');
    const relative=name.slice(prefix.length);const target=await safePath(dir,relative);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,data);manifest.push(relative);
   }
   const entry=input.entry.slice(prefix.length);
   store.exec('INSERT INTO publications VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,entry=excluded.entry,manifest=excluded.manifest,bytes=excluded.bytes,updated_at=excluded.updated_at',p.id,p.user_id,slug,revision,entry,JSON.stringify(manifest),bytes,now());
  }catch(error){await rm(dir,{recursive:true,force:true});throw error;}
  if(previous)await rm(path.join(root,previous.revision),{recursive:true,force:true}).catch(()=>{});
  return metadata(current(p));
 });}
 async function unpublish(p){return locked(p,async()=>{const row=current(p);if(row){store.exec('DELETE FROM publications WHERE project_id=?',p.id);await rm(path.join(root,row.revision),{recursive:true,force:true});}return {ok:true};});}
 function publicRoutes(app){
  app.get(['/p/:slug','/p/:slug/{*file}'],async(req,res)=>{
   res.setHeader('Cache-Control','no-store');
   const row=/^[a-f0-9]{32}$/.test(req.params.slug)?store.one('SELECT p.* FROM publications p JOIN users u ON u.id=p.user_id WHERE p.slug=? AND u.disabled=0',req.params.slug):null;
   if(!row)return res.status(404).type('text').send('Nashr topilmadi yoki yopilgan.');
   if(!req.params.file&&!req.path.endsWith('/'))return res.redirect(308,req.path+'/');
   let name=Array.isArray(req.params.file)?req.params.file.join('/'):req.params.file||row.entry;
   if(name.endsWith('/'))name+='index.html';
   if(!JSON.parse(row.manifest).includes(name))return res.status(404).type('text').send('Fayl topilmadi.');
   const base='/p/'+row.slug+'/',source=new URL(base,config.appUrl).href;
   // Every active document has an opaque origin, even when opened as a top-level page.
   // Only this public snapshot can be loaded/fetched, never authenticated OpenSI APIs.
   res.setHeader('Content-Security-Policy',`default-src 'none'; script-src ${source} 'unsafe-inline'; style-src ${source} 'unsafe-inline'; img-src ${source} data: blob: https:; font-src ${source} data:; media-src ${source} blob:; connect-src ${source}; frame-ancestors 'self'; base-uri ${source}; form-action 'none'; sandbox allow-scripts allow-downloads`);
   res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('Referrer-Policy','no-referrer');
   const data=await readFile(await safePath(path.join(root,row.revision),name)),ext=path.extname(name).toLowerCase();
   const nested=path.posix.dirname(name)==='.'?'':path.posix.dirname(name)+'/';
   res.type(ext).send(['.html','.htm','.js','.mjs','.css'].includes(ext)?previewSource(data.toString('utf8'),ext,base,base+nested):data);
  });
 }
 function privateRoutes(app,projectFor){
  app.get('/api/projects/:projectId/publication', (req,res)=>res.json({publication:metadata(current(projectFor(req)))}));
  app.get('/api/projects/:projectId/publication/files',async(req,res)=>res.json(await candidates(projectFor(req))));
  app.post('/api/projects/:projectId/publication',async(req,res)=>res.json(await publish(projectFor(req),req.body)));
  app.delete('/api/projects/:projectId/publication',async(req,res)=>res.json(await unpublish(projectFor(req))));
 }
 return {publicRoutes,privateRoutes};
}
