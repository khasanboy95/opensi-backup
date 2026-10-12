import {api} from './api';
type Directory = {name:string;queryPermission:(o:{mode:string})=>Promise<string>;requestPermission:(o:{mode:string})=>Promise<string>;getDirectoryHandle:(name:string,o:{create:boolean})=>Promise<Directory>;getFileHandle:(name:string,o:{create:boolean})=>Promise<{createWritable:()=>Promise<{write:(b:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>}>}>};
type Delivery={mode:'cloud'|'folder'|'download';handle?:Directory;name?:string;done?:string;error?:string;after:number};
const selected=new Map<string,Directory>();
async function db(){return new Promise<IDBDatabase>((resolve,reject)=>{const q=indexedDB.open('opensi-delivery',1);q.onupgradeneeded=()=>q.result.createObjectStore('destinations');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});}
async function record(key:string,value?:Delivery){const d=await db();return new Promise<Delivery|undefined>((resolve,reject)=>{const t=d.transaction('destinations',value?'readwrite':'readonly');const q=value?t.objectStore('destinations').put(value,key):t.objectStore('destinations').get(key);let result:Delivery|undefined;q.onsuccess=()=>{result=value||q.result;};t.oncomplete=()=>{d.close();resolve(result);};t.onerror=()=>{d.close();reject(t.error);};});}
export const canChooseFolder=()=>typeof (window as unknown as {showDirectoryPicker?:unknown}).showDirectoryPicker==='function';
export async function chooseFolder(user:string){const handle=await (window as unknown as {showDirectoryPicker:(o:unknown)=>Promise<Directory>}).showDirectoryPicker({mode:'readwrite',id:'opensi-output'});selected.set(user,handle);return handle.name;}
export function hasChosenFolder(user:string){return selected.has(user);}
export async function bindDestination(user:string,project:string,mode:Delivery['mode']){const handle=mode==='folder'?selected.get(user):undefined;if(mode==='folder'&&!handle)throw new Error('Natijalar uchun papkani qayta tanlang.');await record(`${user}:${project}`,{mode,handle,name:handle?.name,after:Date.now()-5000});}
export async function deliveryFor(user:string,project:string){return record(`${user}:${project}`);}
export async function chooseProjectFolder(user:string,project:string){const name=await chooseFolder(user);await bindDestination(user,project,'folder');return name;}
export async function downloadProject(project:string){await api(`/projects/${project}/download-manifest`);const a=document.createElement('a');a.href=`/api/projects/${encodeURIComponent(project)}/export`;a.download=`OpenSI-${project}.zip`;document.body.appendChild(a);a.click();a.remove();}
const active=new Set<string>();
export async function deliver(user:string,project:string,run:string,interactive=false){
 const key=`${user}:${project}`;if(active.has(key))return;active.add(key);
 try {const value=await record(key);if(!value||value.mode==='cloud'||(!interactive&&value.done===run)||(!interactive&&value.error))return;
  try {
   if(value.mode==='download')await downloadProject(project);
   else {
    if(!value.handle)throw new Error('Saqlash papkasini qayta tanlang.');
    let permission=await value.handle.queryPermission({mode:'readwrite'});if(permission!=='granted'&&interactive)permission=await value.handle.requestPermission({mode:'readwrite'});if(permission!=='granted')throw new Error('Papkaga yozish uchun “Natijani saqlash”ni bosing.');
    const manifest=await api<{files:{path:string;size:number;updated_at:string}[]}>(`/projects/${project}/download-manifest`);
    let root=await value.handle.getDirectoryHandle('OpenSI',{create:true});root=await root.getDirectoryHandle(project,{create:true});root=await root.getDirectoryHandle(run,{create:true});
    for(const file of manifest.files){const parts=file.path.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||/[\\:]/.test(p)))throw new Error('Natija fayli yo‘li noto‘g‘ri.');let dir=root;for(const p of parts.slice(0,-1))dir=await dir.getDirectoryHandle(p,{create:true});
     const response=await fetch(`/api/projects/${project}/download-file?path=${encodeURIComponent(file.path)}`,{headers:{'x-opensi-client':'web'}});if(!response.ok)throw new Error(`${file.path} yuklanmadi. Qayta saqlang.`);
     if(!response.body)throw new Error(`${file.path} oqimi ochilmadi.`);
     const handle=await dir.getFileHandle(parts.at(-1)!,{create:true});const writer=await handle.createWritable();const reader=response.body.getReader();let received=0;try{for(;;){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;await writer.write(chunk.value);}if(received!==file.size)throw new Error(`${file.path} hajmi o‘zgardi. Qayta saqlang.`);await writer.close();}catch(e){await reader.cancel().catch(()=>{});await writer.abort();throw e;}finally{reader.releaseLock();}
    }
    const after=await api<typeof manifest>(`/projects/${project}/download-manifest`);if(JSON.stringify(after)!==JSON.stringify(manifest))throw new Error('Saqlash paytida loyiha o‘zgardi. Vazifa tugagach qayta saqlang.');
   }
   await record(key,{...value,done:run,error:undefined});return value.mode==='folder'?`Natijalar ${value.name}/OpenSI papkasiga saqlandi.`:'ZIP yuklash brauzerga yuborildi.';
  }catch(error){await record(key,{...value,error:(error as Error).message});throw error;}
 }finally{active.delete(key);}
}
