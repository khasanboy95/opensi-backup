import {api} from './api';
type Folder = {id:string;label:string;handle:any;userId:string;nodeId:string;token:string};
let revision=0;
async function database(){return new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('opensi-linked-folders',1);request.onupgradeneeded=()=>request.result.createObjectStore('folders',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function rows():Promise<Folder[]>{const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('folders');const r=tx.objectStore('folders').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function save(folder:Folder){const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('folders','readwrite');tx.objectStore('folders').put(folder);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);});revision++;}
async function connector(folder:Folder,route:string,body:unknown){const r=await fetch('/api/connector/'+route,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+folder.token},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Brauzer papkasi ulanishi uzildi ('+r.status+').');return r.json();}
export const supportsBrowserFolder=()=>typeof (window as any).showDirectoryPicker==='function';
export async function selectBrowserProject(title:string,notes:string){
 const handle=await (window as any).showDirectoryPicker({id:'opensi-project-source',mode:'readwrite'});
 const {user}=await api<{user:{id:string}}>('/me');
 const old=(await rows()).filter(f=>f.userId===user.id);let folder:Folder|undefined;
 for(const f of old)if(await f.handle.isSameEntry(handle)){folder={...f,handle};break;}
 if(!folder){const {code}=await api<{code:string}>('/nodes/pair-code',{method:'POST',body:{}});const r=await fetch('/api/connector/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code,name:'Brauzer · '+handle.name,platform:'browser',workspace:handle.name})});if(!r.ok)throw Error('Brauzer ulanmagan.');folder={id:crypto.randomUUID(),label:handle.name,handle,userId:user.id,...await r.json()};}
 await save(folder!);await announce(folder!);
 return api<{project:{id:string}}>('/projects/link',{method:'POST',body:{nodeId:folder!.nodeId,sourceId:folder!.id,title:title||handle.name,notes}});
}
async function announce(f:Folder){await connector(f,'folders',{folders:[{id:f.id,label:f.label,kind:'browser'}]});await connector(f,'heartbeat',{capabilities:['linked_folders_v1','browser_files_v1']});}
function parts(name:string){if(typeof name!=='string'||name.length>240||/[\\:\x00-\x1f<>"|?*]/.test(name))throw Error('Fayl yo‘li noto‘g‘ri.');const p=name.split('/');if(p.some(v=>!v||v==='..'||v.startsWith('.')||['node_modules','.git'].includes(v)))throw Error('Papka tashqarisiga ruxsat yo‘q.');return p;}
async function fileHandle(root:any,name:string,create=false){const p=parts(name);let dir=root;for(const v of p.slice(0,-1))dir=await dir.getDirectoryHandle(v,{create});return dir.getFileHandle(p.at(-1),{create});}
async function manifest(root:any){const files:any[]=[];async function walk(dir:any,prefix='',depth=0){if(depth>16||files.length>=5000)return;for await(const [name,h] of dir.entries()){if(name.startsWith('.')||['node_modules','venv','__pycache__'].includes(name))continue;const p=prefix+name;if(h.kind==='directory')await walk(h,p+'/',depth+1);else{const f=await h.getFile();files.push({path:p,size:f.size,updated_at:new Date(f.lastModified).toISOString()});}if(files.length>=5000)break;}}await walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));}
export async function browserFileTool(root:any,tool:string,args:any):Promise<any>{
 if(tool==='list_files'||tool==='project_inspect'){const all=await manifest(root);if(tool==='project_inspect')return {files:all.length,stack:['Brauzer papkasi'],scripts:{},profiles:[],note:'Terminal bu brauzerda mavjud emas.'};const files=all.filter(f=>!args.path||f.path.startsWith(args.path)),offset=Math.max(0,args.offset||0),limit=Math.min(500,args.limit||200);return {files:files.slice(offset,offset+limit),total:files.length,nextOffset:offset+limit<files.length?offset+limit:null};}
 if(tool==='prepare_local_attachment'){if(!/^att_[a-f0-9]{24}$/.test(args.id)||!args.name||/[\\/]/.test(args.name))throw Error('Biriktirma noto‘g‘ri.');const path=`inputs/${args.id}/${args.name}`,f=await (await fileHandle(root,path)).getFile();return {path,...(f.size<=5000000&&/^image\/(png|jpeg|webp)$/.test(args.mime)?{image:`data:${args.mime};base64,${(await browserFileTool(root,'preview_file',{path})).base64}`}:{})};}
 if(tool==='publish_preview')return {published:true,local:true};
 if(tool==='upload_chunk'){if(!args.path?.startsWith('inputs/att_')||!Number.isSafeInteger(args.offset)||args.offset<0||typeof args.base64!=='string'||args.base64.length>1000000)throw Error('Fayl bo‘lagi noto‘g‘ri.');const raw=atob(args.base64),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(args.offset+bytes.length>1000000000)throw Error('Fayl 1 GB dan katta.');const h=await fileHandle(root,args.path,args.offset===0),f=await h.getFile();if(f.size!==args.offset)throw Error('Fayl bo‘lagi tartibi noto‘g‘ri.');const w=await h.createWritable({keepExistingData:true});try{await w.write({type:'write',position:args.offset,data:bytes});await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}return {saved:true,bytes:args.offset+bytes.length};}
 if(tool==='preview_file'){const f=await (await fileHandle(root,args.path)).getFile();if(f.size>5000000)throw Error('Preview fayli juda katta.');const b=new Uint8Array(await f.arrayBuffer());let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return {base64:btoa(s)};}
 if(!['read_file','write_file','append_file','edit_file','copy_file'].includes(tool))throw Error('Bu amal uchun kompyuter connectorini tanlang. Brauzer faqat tanlangan papka fayllarini boshqaradi.');
 if(tool==='read_file'){const f=await (await fileHandle(root,args.path)).getFile();if(f.size>2000000)throw Error('Matn fayli juda katta.');const text=await f.text(),offset=Math.max(0,args.offset||0),limit=Math.min(500000,args.limit||20000);return {path:args.path,content:text.slice(offset,offset+limit),offset,nextOffset:offset+limit<text.length?offset+limit:null,truncated:offset+limit<text.length};}
 let content=args.content;
 if(tool==='append_file'||tool==='edit_file'){const old=await (await (await fileHandle(root,args.path)).getFile()).text();if(tool==='append_file')content=old+args.content;else{if(!args.search||old.split(args.search).length!==2)throw Error('Tahrir uchun yagona moslik topilmadi.');content=old.replace(args.search,args.replace);}}
 if(tool==='copy_file'){content=await (await (await fileHandle(root,args.from)).getFile()).text();}
 if(typeof content!=='string'||content.length>2000000)throw Error('Fayl matni noto‘g‘ri yoki juda katta.');const h=await fileHandle(root,args.path,true),w=await h.createWritable();try{await w.write(content);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}return {saved:true,path:args.path,bytes:new TextEncoder().encode(content).length};
}
export function startBrowserWorkspaces(userId:string){
 let stopped=false;const active=new Set<string>();
 async function tick(){for(const f of (await rows()).filter(f=>f.userId===userId)){if(active.has(f.id)||await f.handle.queryPermission({mode:'readwrite'})!=='granted')continue;active.add(f.id);void navigator.locks.request('opensi-folder:'+f.id,{ifAvailable:true},async lock=>{if(!lock)return;let last=0;while(!stopped){try{if(await f.handle.queryPermission({mode:'readwrite'})!=='granted')break;if(Date.now()-last>5000){await announce(f);last=Date.now();}const {command}=await connector(f,'poll',{});if(command){let result;try{if(command.sourceId!==f.id)throw Error('Bu loyihaga papka ruxsati yo‘q.');result=await browserFileTool(f.handle,command.tool,command.args);}catch(e){result={error:(e as Error).message};}await connector(f,'result',{commandId:command.id,result});}}catch{break;}await new Promise(r=>setTimeout(r,1000));}}).finally(()=>active.delete(f.id));}}
 let seen=revision;const timer=setInterval(()=>{if(revision!==seen)seen=revision;void tick().catch(()=>{});},3000);void tick().catch(()=>{});return ()=>{stopped=true;clearInterval(timer);};
}

export async function attachBrowserFile(userId:string,nodeId:string,file:File){
 const folder=(await rows()).find(f=>f.userId===userId&&f.nodeId===nodeId);
 if(!folder||await folder.handle.queryPermission({mode:'readwrite'})!=='granted')throw Error('Brauzer papkasini shu qurilmada qayta ulang. Fayl serverga yuborilmadi.');
 const id='att_'+crypto.randomUUID().replaceAll('-','').slice(0,24),name=file.name||'screenshot.png';
 const h=await fileHandle(folder.handle,`inputs/${id}/${name}`,true),w=await h.createWritable();
 try{await w.write(file);await w.close();}catch(e){await w.abort().catch(()=>{});throw e;}
 return connector(folder,'attachment',{id,name,mime:file.type||'application/octet-stream',size:file.size});
}
