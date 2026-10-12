import {HttpError,hash,token,now} from './security.mjs';

export function localAttachments({app,store,nodes,authenticated=false}) {
 store.db.exec('CREATE TABLE IF NOT EXISTS local_attachments(attachment_id TEXT PRIMARY KEY REFERENCES attachments(id),node_id TEXT NOT NULL REFERENCES nodes(id),size INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS local_tickets(hash TEXT PRIMARY KEY,node_id TEXT NOT NULL,expires INTEGER NOT NULL)');
 if(authenticated){
  app.post('/api/nodes/:nodeId/local-access',(req,res)=>{
   const node=nodes.list(req.user.id).find(n=>n.id===req.params.nodeId&&n.online&&!n.revoked);
   if(!node?.local_port)throw new HttpError(409,'Kompyuter connectorini yangilang va ishga tushiring.');
   const ticket=token();store.exec('DELETE FROM local_tickets WHERE expires<?',Date.now());
   store.exec('INSERT INTO local_tickets VALUES(?,?,?)',hash(ticket),node.id,Date.now()+30*60_000);
   res.setHeader('Cache-Control','no-store');res.json({url:'http://127.0.0.1:'+node.local_port,ticket,nodeId:node.id});
  });return;
 }
 app.post('/api/connector/local-ticket',(req,res)=>{
  const node=nodes.authenticate(req),ticket=req.body?.ticket;
  if(typeof ticket!=='string'||!store.one('SELECT hash FROM local_tickets WHERE hash=? AND node_id=? AND expires>?',hash(ticket),node.id,Date.now()))throw new HttpError(403,'Lokal ulanish ruxsati tugagan.');
  res.json({ok:true});
 });
 app.post('/api/connector/attachment',(req,res)=>{
  const node=nodes.authenticate(req),{id,name,mime,size}=req.body||{};
  if(!/^att_[a-f0-9]{24}$/.test(id)||typeof name!=='string'||!name||name.length>160||/[\\/\x00-\x1f]/.test(name)||typeof mime!=='string'||mime.length>150||!Number.isSafeInteger(size)||size<0||size>1_000_000_000)throw new HttpError(400,'Lokal biriktirma noto‘g‘ri.');
  if(store.one('SELECT id FROM attachments WHERE id=?',id))throw new HttpError(409,'Biriktirma allaqachon mavjud.');
  store.db.exec('BEGIN IMMEDIATE');try{store.exec('INSERT INTO attachments VALUES(?,?,?,?,?,?)',id,node.user_id,name,mime,'',now());store.exec('INSERT INTO local_attachments VALUES(?,?,?)',id,node.id,size);store.db.exec('COMMIT');}catch(e){store.db.exec('ROLLBACK');throw e;}
  res.status(201).json({id,name,mime,size,nodeId:node.id,storage:'local'});
 });
}
