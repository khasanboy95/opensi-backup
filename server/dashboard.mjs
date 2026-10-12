import {z} from 'zod';
import {id,now,HttpError} from './security.mjs';
export function dashboardRoutes(app,{store,parse,createTask}){
  store.db.exec('CREATE TABLE IF NOT EXISTS dashboard_cards(id TEXT PRIMARY KEY,user_id TEXT,title TEXT,kind TEXT,data TEXT,created_at TEXT);');
  const schema=z.object({title:z.string().trim().min(1).max(100),kind:z.enum(['action','panel']),prompt:z.string().max(12000).default(''),providerId:z.string().max(80).default(''),model:z.string().max(160).default(''),projectId:z.string().max(80).nullable().default(null)}).strict();
  app.get('/api/dashboard', (req,res)=>res.json(store.all('SELECT * FROM dashboard_cards WHERE user_id=? ORDER BY created_at DESC',req.user.id).map(row=>({...JSON.parse(row.data),id:row.id,title:row.title,kind:row.kind}))));
  app.post('/api/dashboard',(req,res)=>{
    const value=parse(schema,req.body);if(value.projectId&&!store.project(req.user.id,value.projectId))throw new HttpError(404,'Loyiha topilmadi.');
    if(value.kind==='panel'&&!value.projectId)throw new HttpError(400,'Panel uchun loyiha tanlang.');
    if(value.kind==='action'&&(!value.prompt.trim()||!value.providerId||!value.model))throw new HttpError(400,'Amal uchun topshiriq va model kerak.');
    if(store.one('SELECT COUNT(*) AS n FROM dashboard_cards WHERE user_id=?',req.user.id).n>=30)throw new HttpError(409,'30 ta kartagacha saqlash mumkin.');
    const key=id('card_');store.exec('INSERT INTO dashboard_cards VALUES(?,?,?,?,?,?)',key,req.user.id,value.title,value.kind,JSON.stringify(value),now());res.status(201).json({id:key,...value});
  });
  app.post('/api/dashboard/:id/run',async(req,res)=>{
    const card=store.one('SELECT * FROM dashboard_cards WHERE user_id=? AND id=?',req.user.id,req.params.id);if(!card||card.kind!=='action')throw new HttpError(404,'Amal topilmadi.');
    const value=JSON.parse(card.data);if(value.projectId&&!store.project(req.user.id,value.projectId))throw new HttpError(404,'Loyiha topilmadi.');
    const project=value.projectId?store.project(req.user.id,value.projectId):null;
    res.status(201).json(await createTask(req.user,{prompt:value.prompt,providerId:value.providerId,model:value.model,agentId:'developer',environment:project?.environment||'cloud',nodeId:project?.node_id||null,projectId:value.projectId,attachmentIds:[]}));
  });
  app.delete('/api/dashboard/:id',(req,res)=>{store.exec('DELETE FROM dashboard_cards WHERE id=? AND user_id=?',req.params.id,req.user.id);res.json({ok:true});});
}
