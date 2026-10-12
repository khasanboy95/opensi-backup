import path from 'node:path';
import {readFile,realpath,stat,writeFile,rename,rm,readdir} from 'node:fs/promises';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
// Called only by a human's authenticated folder-link request, never by an agent tool.
export async function registerFolder(stateDir,value){
 const root=await resolveDirectory(value);
 const key=p=>process.platform==='win32'?p.toLowerCase():p;
 const rows=await localFolders(stateDir);
 for(const row of rows){const resolved=await realpath(row.path).catch(()=>row.path);if(key(resolved)===key(root))return {id:row.id,label:row.label,kind:'computer'};}
 if(rows.length>=200)throw Error('200 ta papka ulangan. Keraksiz ulanishni olib tashlang.');
 const row={id:'folder_'+createHash('sha256').update(key(root)).digest('hex').slice(0,32),label:(path.basename(root)||root).slice(0,100),path:root};
 const temporary=path.join(stateDir,'folders-'+randomUUID()+'.tmp');
 try{await writeFile(temporary,JSON.stringify([...rows,row]),{mode:0o600,flag:'wx'});await rename(temporary,path.join(stateDir,'folders.json'));}finally{await rm(temporary,{force:true});}
 return {id:row.id,label:row.label,kind:'computer'};
}
async function resolveDirectory(value){
 if(typeof value!=='string'||value.length>2000||/[\x00-\x1f]/.test(value))throw Error('Papka yo‘li noto‘g‘ri.');
 const input=value.trim().replace(/^"(.*)"$/,'$1');
 if(!path.isAbsolute(input)||input.startsWith('\\\\')||input.startsWith('//'))throw Error('Shu kompyuterdagi to‘liq papka yo‘lini kiriting.');
 let root;try{root=await realpath(input);if(!(await stat(root)).isDirectory())throw Error();}catch{throw Error('Papka topilmadi. Yo‘l va tanlangan kompyuterni tekshiring.');}
 return root;
}
export async function browseFolders(stateDir,workspace,{path:requested='',offset=0}={}){
 if(!Number.isSafeInteger(offset)||offset<0||offset>100000)throw Error('Papka sahifasi noto‘g‘ri.');
 if(!requested){
  const roots=process.platform==='win32'?Array.from({length:26},(_,i)=>String.fromCharCode(65+i)+':\\'):['/'];
  const candidates=[{label:'Uy papkasi',path:os.homedir()},{label:'OpenSI loyihalari',path:workspace},...roots.map(p=>({label:p,path:p})),...(await localFolders(stateDir)).map(r=>({label:r.label,path:r.path}))];
  const seen=new Set(),entries=[];
  for(const item of candidates){try{const resolved=await resolveDirectory(item.path),key=process.platform==='win32'?resolved.toLowerCase():resolved;if(seen.has(key))continue;seen.add(key);entries.push({...item,path:resolved});}catch{/* Missing drives and moved old folders are not shown. */}}
  return {path:'',parent:null,entries,more:false,markers:[]};
 }
 const root=await resolveDirectory(requested);let items;
 try{items=await readdir(root,{withFileTypes:true});}catch{throw Error('Bu papkani o‘qishga kompyuter ruxsat bermadi. Boshqa papkani tanlang.');}
 const dirs=items.filter(e=>e.isDirectory()||e.isSymbolicLink()).sort((a,b)=>a.name.localeCompare(b.name));
 const entries=[];for(const entry of dirs.slice(offset,offset+200)){const target=path.join(root,entry.name);if(entry.isSymbolicLink()&&!(await stat(target).catch(()=>null))?.isDirectory())continue;entries.push({label:entry.name,path:target});}
 const markers=items.filter(e=>e.isFile()&&['package.json','pyproject.toml','requirements.txt','Cargo.toml','go.mod','pom.xml','README.md','index.html'].includes(e.name)).map(e=>e.name);
 return {path:root,parent:path.dirname(root)===root?'':path.dirname(root),entries,more:offset+200<dirs.length,nextOffset:offset+200,markers};
}
export async function localFolders(stateDir){
 let rows;try{rows=JSON.parse(await readFile(path.join(stateDir,'folders.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return [];throw e;}
 if(!Array.isArray(rows)||rows.length>200)throw Error('folders.json ro‘yxati noto‘g‘ri.');
 return rows.filter(r=>r&&/^[a-zA-Z0-9_-]{1,80}$/.test(r.id)&&typeof r.path==='string'&&path.isAbsolute(r.path)&&typeof r.label==='string').map(r=>({...r,kind:'computer'}));
}
export async function commandRoot(workspace,stateDir,command){
 if(!command.sourceId)return path.join(workspace,command.projectId);
 const item=(await localFolders(stateDir)).find(r=>r.id===command.sourceId);
 if(!item)throw Error('Bu papkaga lokal ruxsat berilmagan. Uni kompyuterda qayta ulang.');
 const root=await realpath(item.path);if(!(await stat(root)).isDirectory())throw Error('Loyiha papkasi topilmadi.');
 return root;
}
