import {id,now,HttpError} from './security.mjs';

export const linkedProject=(store,project)=>store.setting('project-link:'+project.id)||(project.environment==='local'?{nodeId:project.node_id,kind:'computer'}:null);
export function folderCatalog(value){
 if(!Array.isArray(value)||value.length>200)throw new HttpError(400,'Papka ro‘yxati noto‘g‘ri.');
 return value.map(item=>{
  if(!item||!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||typeof item.label!=='string'||!item.label.trim()||item.label.length>120)throw new HttpError(400,'Papka identifikatori noto‘g‘ri.');
  return {id:item.id,label:item.label,kind:item.kind==='browser'?'browser':'computer'};
 });
}
export function linkProject(store,nodes,userId,{nodeId,sourceId,title,notes=''}){
 const node=nodes.list(userId).find(n=>n.id===nodeId&&n.online&&!n.revoked);
 if(!node)throw new HttpError(409,'Papka ulangan qurilma hozir offline.');
 const source=(store.setting('node-folders:'+nodeId)||[]).find(f=>f.id===sourceId);
 if(!source)throw new HttpError(404,'Qurilmada ruxsat berilgan papka topilmadi.');
 const previous=store.all('SELECT * FROM projects WHERE user_id=? AND node_id=?',userId,nodeId).find(p=>linkedProject(store,p)?.sourceId===sourceId);
 if(previous)return {project:previous};
 if(typeof title!=='string'||!title.trim()||title.length>100||typeof notes!=='string'||notes.length>12000)throw new HttpError(400,'Loyiha nomi yoki izohi noto‘g‘ri.');
 const stamp=now(),project={id:id('prj_'),user_id:userId,title:title.trim(),environment:'local',node_id:nodeId,created_at:stamp,updated_at:stamp};
 const run={id:id('run_'),project_id:project.id,user_id:userId};
 store.db.exec('BEGIN IMMEDIATE');try{
  store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',project.id,userId,project.title,'local',nodeId,stamp,stamp);
  store.exec('INSERT INTO project_execution VALUES(?,?)',project.id,'automatic');
  store.setSetting('project-link:'+project.id,{sourceId,...source,nodeId});
  store.exec('INSERT INTO project_context VALUES(?,?,?)',project.id,'Tanlangan papkaning mavjud fayllarini o‘qib, kelgan joyidan davom eting. Fayllar lokal qurilmada saqlanadi. Har vazifa oldidan joriy holatni qayta o‘qing.',notes);
  store.exec('INSERT INTO runs(id,user_id,project_id,agent_id,prompt,status,environment,node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',run.id,userId,project.id,'developer','Mavjud papkani ulash','completed','local',nodeId,stamp,stamp);
  store.message(run,'assistant',{role:'assistant',content:`**${source.label}** papkasi ulandi. Fayllar serverga ko‘chirilmadi. Shu papkadagi loyihani davom ettirish uchun vazifa yozing. ${source.kind==='browser'?'Brauzer oynasi ochiq va papka ruxsati faol bo‘lsin. Terminal uchun kompyuter connectori kerak.':'Kompyuter connectori online bo‘lsin.'}`});
  store.db.exec('COMMIT');
 }catch(e){store.db.exec('ROLLBACK');throw e;}
 return {project,run};
}
// Keep source bytes in the active model request only, not in the persisted tool history.
export function linkedRecord(message){
 if(message.role==='tool')return {...message,content:JSON.stringify({local:true,note:'Natija lokal papkadan olingan. Joriy faylni qayta o‘qing.'})};
 if(message.tool_calls)return {...message,tool_calls:message.tool_calls.map(c=>({...c,function:{...c.function,arguments:JSON.stringify({local:true,note:'Lokal amal argumentlari saqlanmagan.'})}}))};
 return message;
}
