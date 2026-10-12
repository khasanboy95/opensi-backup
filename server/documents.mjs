import path from 'node:path';
import {lstat,mkdir,open,readFile,statfs} from 'node:fs/promises';
import {z} from 'zod';
import {id,now,HttpError} from './security.mjs';
import {projectRoot,safePath,listFiles} from './files.mjs';
import {remoteCommand} from './commands.mjs';
export function documentFormats(name){
 const ext=path.extname(name).slice(1).toLowerCase();
 const choices=/^(doc|docx|odt|rtf|txt|md|html|htm)$/.test(ext)?['pdf','docx','odt','rtf','txt']:/^(xls|xlsx|ods|csv|tsv)$/.test(ext)?['pdf','xlsx','ods','csv']:/^(ppt|pptx|odp)$/.test(ext)?['pdf','pptx','odp']:/^(png|jpe?g|webp)$/.test(ext)?['pdf']:[];
 return choices.filter(f=>f!==ext);
}
export function documentFailure(result){
 const output=String(result?.output||'');
 if(/Unable to find image|pull access denied for opensi-(?:documents|runtime)|No such image: opensi-(?:documents|runtime)/i.test(output))return new HttpError(503,'PDF konvertori serverda ishga tayyor emas. Server image holatini tekshirish kerak; fayl va mazmun saqlangan.');
 if(/No space left on device/i.test(output))return new HttpError(507,'Serverda PDF yaratish uchun joy yetarli emas.');
 return new HttpError(422,result?.timedOut?'Aylantirish vaqti tugadi. Hujjatni qismlarga ajratib urinib ko‘ring.':'Hujjatni aylantirib bo‘lmadi. Format, fayl buzilmaganligi va parolini tekshiring.');
}
export function documentService(app,{store,config,library,parse,editProject,execute=remoteCommand}){
 store.db.exec(`CREATE TABLE IF NOT EXISTS document_jobs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,project_id TEXT NOT NULL,path TEXT NOT NULL,format TEXT NOT NULL,status TEXT NOT NULL,output TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
 store.exec("UPDATE document_jobs SET status='failed',error='Xizmat qayta ishga tushdi. Qayta aylantirish tugmasini bosing.',updated_at=? WHERE status='running'",now());
 const pending=new Set(),controllers=new Set(),locks=new Set();let closing=false;
 function owned(userId,projectId){const p=store.project(userId,projectId);if(!p)throw new HttpError(404,'Hujjat loyihasi topilmadi.');return p;}
 async function convert(project,args,signal){
  if(closing)throw new HttpError(503,'Xizmat yangilanmoqda.');
  if(!config.runnerUrl||!config.runnerToken)throw new HttpError(409,'Hujjat konvertori serverga hali ulanmagan.');
  if(!documentFormats(args.path).includes(args.format))throw new HttpError(400,'Bu formatga aylantirish qo‘llanmaydi. Asl faylni yuklab olishingiz mumkin.');
  const root=projectRoot(config,project),file=await safePath(root,args.path);const info=await lstat(file);
  if(!info.isFile()||info.size>50_000_000)throw new HttpError(413,'Aylantiriladigan hujjat 50 MB gacha. Asl faylni 1 GB gacha yuklab olish mumkin.');
  const space=await statfs(root);if(space.bavail*space.bsize<250_000_000)throw new HttpError(507,'Serverda hujjat eksporti uchun joy yetarli emas.');
  const files=await listFiles(root,{maxFiles:5000,strict:true});if(files.reduce((n,f)=>n+f.size,0)>1_950_000_000)throw new HttpError(413,'Loyiha 2 GB saqlash chegarasiga yetdi.');
  if(locks.has(project.id)||locks.size>=2)throw new HttpError(409,'Hujjat konvertori band. Bajarilayotgan ish tugagach qayta urinib ko‘ring.');
  locks.add(project.id);
  try{
   const output=`exports/document-${id('')}.${args.format}`;
   const payload=Buffer.from(JSON.stringify({path:args.path,format:args.format,output})).toString('base64url');
   const result=await execute(config,root,{kind:'document',command:`node /opt/toolchain/documents.mjs ${payload}`,timeout:110},signal);
   if(result.exitCode!==0||result.timedOut)throw documentFailure(result);
   const target=await safePath(root,output),stat=await lstat(target);if(!stat.isFile()||stat.size===0||stat.size>50_000_000)throw new Error('Konvertor natijasi yaroqsiz.');
   if(args.format==='pdf'){const f=await open(target,'r');const header=Buffer.alloc(5);try{await f.read(header,0,5,0);}finally{await f.close();}if(header.toString()!=='%PDF-')throw new Error('PDF natijasi yaroqsiz.');}
   store.exec('UPDATE projects SET updated_at=? WHERE id=?',now(),project.id);
   return {projectId:project.id,path:output,size:stat.size,format:args.format,downloadUrl:`/api/projects/${project.id}/download-file?path=${encodeURIComponent(output)}`};
  }finally{locks.delete(project.id);}
 }
 app.get('/api/documents',async(req,res)=>{
  const chosen=typeof req.query.projectId==='string'?req.query.projectId:null;
  const projects=chosen?[owned(req.user.id,chosen)]:store.all('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT 100',req.user.id);
  const files=[];let limited=false;
  for(const p of projects){const entries=await listFiles(projectRoot(config,p),{maxFiles:1000});if(entries.length>=1000)limited=true;for(const f of entries){if(!chosen&&!/\.(pdf|docx?|odt|rtf|txt|md|html?|xlsx?|ods|csv|tsv|pptx?|odp|png|jpe?g|webp)$/i.test(f.path))continue;files.push({...f,id:`${p.id}:${f.path}`,name:f.path.split('/').at(-1),projectId:p.id,projectTitle:p.title,formats:documentFormats(f.path),url:`/api/projects/${p.id}/download-file?path=${encodeURIComponent(f.path)}`});}}
  if(!chosen)for(const a of store.all('SELECT id,name,size,created_at FROM library_assets WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC',req.user.id))files.push({id:a.id,assetId:a.id,name:a.name,path:a.name,size:a.size,updated_at:a.created_at,projectTitle:'Kutubxona',formats:documentFormats(a.name),url:`/api/library/${a.id}/content`});
  res.json({files:files.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)),jobs:store.all(`SELECT * FROM document_jobs WHERE user_id=? ${chosen?'AND project_id=?':''} ORDER BY created_at DESC LIMIT 20`,...[req.user.id,...(chosen?[chosen]:[])]),available:Boolean(config.runnerUrl&&config.runnerToken),limited:limited||projects.length===100,conversionLimit:50_000_000});
 });
 app.post('/api/documents/convert',async(req,res)=>{
  const v=parse(z.object({projectId:z.string().max(80).optional(),path:z.string().min(1).max(240).optional(),assetId:z.string().max(80).optional(),format:z.enum(['pdf','docx','odt','rtf','txt','xlsx','ods','csv','pptx','odp'])}).strict(),req.body);
  if(closing||pending.size>=2)throw new HttpError(409,'Konvertor band. Birozdan keyin takrorlang.');
  let project,source;
  if(v.assetId){
   if(v.projectId||v.path)throw new HttpError(400,'Bitta fayl manbasini tanlang.');const asset=library.get(req.user.id,v.assetId);
   if(!documentFormats(asset.name).includes(v.format)||asset.size>50_000_000)throw new HttpError(400,'Format qo‘llanmaydi yoki hujjat 50 MB dan katta.');
   const key=`documents-project:${req.user.id}`;project=store.project(req.user.id,store.setting(key)?.id||'');
   if(!project){project={id:id('prj_'),user_id:req.user.id,title:'Hujjatlar · yuklangan fayllar',environment:'cloud',node_id:null};store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',project.id,project.user_id,project.title,'cloud',null,now(),now());store.setSetting(key,{id:project.id});}
   source=`imports/${id('')}.${path.extname(asset.name).slice(1).toLowerCase()}`;
   await editProject(project,async()=>{const target=await safePath(projectRoot(config,project),source);await mkdir(path.dirname(target),{recursive:true});await library.copy(asset,target,true);});
  }else{if(!v.projectId||!v.path)throw new HttpError(400,'Loyiha va faylni tanlang.');project=owned(req.user.id,v.projectId);source=v.path;await safePath(projectRoot(config,project),source);}
  if(!documentFormats(source).includes(v.format))throw new HttpError(400,'Bu formatga aylantirish qo‘llanmaydi.');
  const jobId=id('doc_'),controller=new AbortController();controllers.add(controller);
  store.exec('INSERT INTO document_jobs VALUES(?,?,?,?,?,?,NULL,NULL,?,?)',jobId,req.user.id,project.id,source,v.format,'running',now(),now());
  const work=editProject(project,()=>convert(project,{path:source,format:v.format},controller.signal)).then(result=>{store.exec("UPDATE document_jobs SET status='completed',output=?,updated_at=? WHERE id=?",JSON.stringify(result),now(),jobId);}).catch(e=>{store.exec("UPDATE document_jobs SET status='failed',error=?,updated_at=? WHERE id=?",e.message.slice(0,500),now(),jobId);}).finally(()=>{pending.delete(work);controllers.delete(controller);});
  pending.add(work);res.status(202).json({id:jobId});
 });
 app.get('/api/documents/jobs/:id',(req,res)=>{const job=store.one('SELECT * FROM document_jobs WHERE id=? AND user_id=?',req.params.id,req.user.id);if(!job)throw new HttpError(404,'Aylantirish topilmadi.');res.json({...job,result:job.output?JSON.parse(job.output):null});});
 return {convert,instructions(run){return `When asked for documents, PDFs or Office files, save complete content (HTML/Markdown or Office source) to the project. If document_convert is unavailable, write opensi-export.json with {"version":1,"runId":"${run.id}","requests":[{"path":"report.html","format":"pdf"},{"path":"report.html","format":"docx"}]}. Up to 5 exports, 50 MB/source. Formats: text/HTML/Markdown/Word -> pdf/docx/odt/rtf/txt; spreadsheets -> pdf/xlsx/ods/csv; slides -> pdf/pptx/odp; PNG/JPEG/WebP -> pdf. Only request formats the user needs. OpenSI performs exports after your turn and displays actual results in Hujjatlar. Never pretend to create binary files by renaming text or claim conversion succeeded before it has run. Do not use this manifest for ordinary web-app tasks.`;},async finalize(run,project,signal,onEvent){
  const file=await safePath(projectRoot(config,project),'opensi-export.json');let value;try{if((await lstat(file)).size>16000)throw new Error('Eksport ro‘yxati juda katta.');value=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(value.runId!==run.id)return;
  const request=z.object({version:z.literal(1),runId:z.literal(run.id),requests:z.array(z.object({path:z.string().min(1).max(240),format:z.string().max(8)}).strict()).min(1).max(5)}).strict().parse(value);
  for(const args of request.requests){signal.throwIfAborted();onEvent('tool_start',{tool:'document_convert',args,agent:'Hujjat ustaxonasi'});const result=await convert(project,args,signal);onEvent('tool_result',{tool:'document_convert',result,agent:'Hujjat ustaxonasi'});onEvent('files_changed',{});}
 },async close(){closing=true;for(const c of controllers)c.abort();await Promise.allSettled([...pending]);}};
}
