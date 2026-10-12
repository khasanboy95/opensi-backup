import path from 'node:path';
import { readFile, writeFile, mkdir, rename, open, copyFile } from 'node:fs/promises';
import { readFileSync, constants } from 'node:fs';
import { z } from 'zod';
import { HttpError, id, now } from './security.mjs';
import { projectRoot, safePath } from './files.mjs';

const types = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', mp3:'audio/mpeg', wav:'audio/wav', ogg:'audio/ogg', m4a:'audio/mp4', mp4:'video/mp4', webm:'video/webm', pdf:'application/pdf' };
const textExtensions = /\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|py|log|xml|yaml|yml|sql)$/i;
const metadata = 'id,name,mime,size,folder,source,created_at,deleted_at';
export function libraryService(store, config = {}) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS library_assets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,folder TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,bytes BLOB NOT NULL); CREATE INDEX IF NOT EXISTS library_owner ON library_assets(user_id,created_at);`);
  if(!store.all('PRAGMA table_info(library_assets)').some(c=>c.name==='file_path'))store.db.exec("ALTER TABLE library_assets ADD COLUMN file_path TEXT");
  function get(userId, assetId) { const row=store.one(`SELECT ${metadata},file_path FROM library_assets WHERE id=? AND user_id=? AND deleted_at IS NULL`,assetId,userId); if(!row) throw new HttpError(404,'Kutubxona fayli topilmadi.'); return {...row,get bytes(){if(row.size>50_000_000)throw new HttpError(413,'Katta fayl oqim orqali yuklanadi; modelga bir martada o‘qilmaydi.');return row.file_path?readFileSync(row.file_path):Buffer.from(store.one('SELECT bytes FROM library_assets WHERE id=?',assetId).bytes);}}; }
  function trash(userId, assetId) { if(assetId)store.exec('UPDATE library_assets SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL',now(),assetId,userId); }
  function quota(userId,size){const used=store.one('SELECT COALESCE(SUM(size),0) total,COUNT(*) count FROM library_assets WHERE user_id=?',userId);if(used.total+size>5_000_000_000||used.count>=1000||store.one('SELECT COALESCE(SUM(size),0) total FROM library_assets').total+size>20_000_000_000)throw new HttpError(413,'Kutubxona saqlash chegarasiga yetdi (hisob: 5 GB, server: 20 GB).');}
  function validate(name,bytes){if(!name||name.length>160||/[\\/\x00-\x1f]/.test(name))throw new HttpError(400,'Fayl nomi noto‘g‘ri.');const ext=path.extname(name).slice(1).toLowerCase();const mime=types[ext]||(textExtensions.test(name)?'text/plain':'application/octet-stream');if(mime==='image/png'&&!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new HttpError(400,'PNG formati mos emas.');if(mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216))throw new HttpError(400,'JPEG formati mos emas.');if(mime==='image/webp'&&!(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'))throw new HttpError(400,'WebP formati mos emas.');return mime;}
  async function addFile(userId,name,temporary,size,folder='',source='upload'){
    if(size>1_000_000_000)throw new HttpError(413,'Fayl 1 GB dan katta.');
    const handle=await open(temporary,'r');const head=Buffer.alloc(16);try{await handle.read(head,0,16,0);}finally{await handle.close();}
    const mime=validate(name,head),assetId=id('asset_');const directory=path.join(config.dataDir,'library-files');await mkdir(directory,{recursive:true});const file=path.join(directory,assetId);await rename(temporary,file);
    try{quota(userId,size);store.exec('INSERT INTO library_assets(id,user_id,name,mime,size,folder,source,created_at,deleted_at,bytes,file_path) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)',assetId,userId,name,mime,size,folder,source,now(),Buffer.alloc(0),file);}catch(error){await (await import('node:fs/promises')).unlink(file).catch(()=>{});throw error;}
    return store.one(`SELECT ${metadata} FROM library_assets WHERE id=?`,assetId);
  }
  async function copy(asset,target,exclusive=false){if(asset.file_path)await copyFile(asset.file_path,target,exclusive?constants.COPYFILE_EXCL:0);else await writeFile(target,asset.bytes,exclusive?{flag:'wx'}:{});}
  function add(userId, name, bytes, folder='', source='upload') {
    if(!name || name.length>160 || /[\\/\x00-\x1f]/.test(name)) throw new HttpError(400,'Fayl nomi noto‘g‘ri.');
    if(bytes.length>50_000_000) throw new HttpError(400,'Fayl 50 MB dan oshmasligi kerak.');
    const ext=path.extname(name).slice(1).toLowerCase(); const mime=types[ext] || (textExtensions.test(name)?'text/plain':'application/octet-stream');
    // Never render uploaded active content (HTML/SVG) on the application origin.
    if(mime==='image/png' && !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new HttpError(400,'PNG formati mos emas.');
    if(mime==='image/jpeg' && !(bytes[0]===255 && bytes[1]===216)) throw new HttpError(400,'JPEG formati mos emas.');
    if(mime==='image/webp' && !(bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP')) throw new HttpError(400,'WebP formati mos emas.');
    quota(userId,bytes.length);
    const assetId=id('asset_'); store.exec('INSERT INTO library_assets(id,user_id,name,mime,size,folder,source,created_at,deleted_at,bytes) VALUES(?,?,?,?,?,?,?,?,NULL,?)',assetId,userId,name,mime,bytes.length,folder,source,now(),bytes);
    return store.one(`SELECT ${metadata} FROM library_assets WHERE id=?`,assetId);
  }
  return {get,add,addFile,copy,trash};
}
export function libraryRoutes(app,{store,library,config,parse,projectFor,editProject,attachmentsService}) {
  app.get('/api/library',(req,res)=>res.json(store.all(`SELECT ${metadata} FROM library_assets WHERE user_id=? AND ${req.query.trash==='true'?'deleted_at IS NOT NULL':'deleted_at IS NULL'} ORDER BY created_at DESC`,req.user.id)));
  app.post('/api/library',(req,res)=>{ const v=parse(z.object({name:z.string().max(160),content:z.string().max(13_333_336),folder:z.string().trim().max(80).default('')}),req.body); if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v.content)) throw new HttpError(400,'Base64 formati noto‘g‘ri.'); res.status(201).json(library.add(req.user.id,v.name,Buffer.from(v.content,'base64'),v.folder)); });
  app.patch('/api/library/:assetId',(req,res)=>{const v=parse(z.object({folder:z.string().trim().max(80).optional(),deleted:z.boolean().optional()}),req.body); const row=store.one('SELECT id FROM library_assets WHERE id=? AND user_id=?',req.params.assetId,req.user.id); if(!row) throw new HttpError(404,'Fayl topilmadi.'); if(v.folder!==undefined)store.exec('UPDATE library_assets SET folder=? WHERE id=?',v.folder,row.id); if(v.deleted!==undefined)store.exec('UPDATE library_assets SET deleted_at=? WHERE id=?',v.deleted?now():null,row.id);res.json({ok:true});});
  app.get('/api/library/:assetId/content',(req,res)=>{const a=library.get(req.user.id,req.params.assetId); const inline=req.query.inline==='true' && /^(image|audio|video)\//.test(a.mime);res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Content-Disposition',`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);if(a.file_path)res.type(a.mime).sendFile(a.file_path);else res.type(a.mime).send(a.bytes);});
  app.post('/api/library/:assetId/attach',(req,res)=>res.json(attachmentsService.attach(req.user.id,req.params.assetId)));
  app.post('/api/projects/:projectId/library-import',async(req,res)=>{const p=projectFor(req);const v=parse(z.object({assetId:z.string().max(80),path:z.string().min(1).max(240)}),req.body);const a=library.get(req.user.id,v.assetId);if(p.environment!=='cloud')throw new HttpError(400,'Fayl nusxalash bulut loyihasi uchun.');await editProject(p,async()=>{const file=await safePath(projectRoot(config,p),v.path);await mkdir(path.dirname(file),{recursive:true});try{await library.copy(a,file,true);}catch(e){if(e.code==='EEXIST')throw new HttpError(409,'Bu nomdagi fayl mavjud. Boshqa nom tanlang.');throw e;}});res.json({ok:true});});
  app.post('/api/projects/:projectId/library-save',async(req,res)=>{const p=projectFor(req);const v=parse(z.object({path:z.string().min(1).max(240),folder:z.string().max(80).default('')}),req.body);res.status(201).json(await editProject(p,async()=>{const file=await safePath(projectRoot(config,p),v.path);const {stat}=await import('node:fs/promises');if((await stat(file)).size>10_000_000)throw new HttpError(413,'Fayl 10 MB dan katta.');return library.add(req.user.id,path.basename(v.path),await readFile(file),v.folder,`project:${p.id}`);}));});
}
