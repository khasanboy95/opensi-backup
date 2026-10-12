import {api} from './api';
import type {Attachment} from './types';
type Access={url:string;ticket:string;nodeId:string};
export async function localAccess(nodeId:string){
 const access=await api<Access>('/nodes/'+nodeId+'/local-access',{method:'POST',body:{}});
 try{const status=await fetch(access.url+'/status',{method:'POST',headers:{'x-opensi-local-ticket':access.ticket},signal:AbortSignal.timeout(20000)});if(!status.ok||(await status.json()).nodeId!==nodeId)throw Error('Mismatch');}
 catch{throw Error('Bu brauzer tanlangan kompyuterga bevosita ulana olmadi. Shu kompyuterda yangilangan connectorni ishga tushiring va brauzerning lokal tarmoq ruxsatini bering. Fayl serverga yuborilmadi.');}
 return access;
}
export async function attachLocalFile(nodeId:string,file:File):Promise<Attachment>{
 const access=await localAccess(nodeId);
 const response=await fetch(access.url+'/files',{method:'POST',headers:{'x-opensi-local-ticket':access.ticket,'x-file-name':encodeURIComponent(file.name),'x-file-type':file.type||'application/octet-stream','content-type':'application/octet-stream'},body:file,signal:AbortSignal.timeout(30*60_000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Lokal fayl biriktirilmadi.');return value;
}
export async function pickLocalFiles(nodeId:string):Promise<Attachment[]>{
 const access=await localAccess(nodeId);const response=await fetch(access.url+'/pick',{method:'POST',headers:{'x-opensi-local-ticket':access.ticket},signal:AbortSignal.timeout(130000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Lokal fayl tanlanmadi.');return value.files;
}
