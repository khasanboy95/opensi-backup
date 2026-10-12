import {z} from 'zod';
import {HttpError,id,now} from './security.mjs';
const stepSchema=z.object({title:z.string().trim().min(1).max(100),prompt:z.string().trim().min(1).max(20000),providerId:z.string().min(1).max(80),model:z.string().min(1).max(200),agentId:z.string().min(1).max(80),checkpoint:z.boolean().default(false)});
const definition=z.object({name:z.string().trim().min(1).max(100),description:z.string().max(500).default(''),steps:z.array(stepSchema).min(1).max(12)});
export function flowService(app,{store,runner,createTask,parse}) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS flows(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,description TEXT NOT NULL,steps TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS flow_runs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),flow_id TEXT NOT NULL REFERENCES flows(id),name TEXT NOT NULL,steps TEXT NOT NULL,input TEXT NOT NULL,status TEXT NOT NULL,step_index INTEGER NOT NULL DEFAULT 0,project_id TEXT,run_id TEXT,history TEXT NOT NULL DEFAULT '[]',error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);`);
  store.exec("UPDATE flow_runs SET status='interrupted',error='Server qayta ishga tushdi. Natijalarni tekshirib davom ettiring.' WHERE status='running'");
  const owned=(table,userId,rowId)=>{const row=store.one(`SELECT * FROM ${table} WHERE id=? AND user_id=?`,rowId,userId);if(!row)throw new HttpError(404,'Ish oqimi topilmadi.');return row;};
  const visible=row=>({...row,steps:JSON.parse(row.steps),...(row.history?{history:JSON.parse(row.history)}:{})});
  function launch(row) {
    const steps=JSON.parse(row.steps);const step=steps[row.step_index];
    const user=store.one('SELECT * FROM users WHERE id=? AND disabled=0',row.user_id);if(!user)throw new HttpError(403,'Hisob faol emas.');
    const {run,project}=createTask(user,{prompt:`Ish oqimi: ${row.name}. Bosqich ${row.step_index+1}/${steps.length}: ${step.title}\n${step.prompt.replaceAll('{{input}}',()=>row.input)}`,providerId:step.providerId,model:step.model,agentId:step.agentId,environment:'cloud',projectId:row.project_id});
    const history=JSON.parse(row.history);history.push({step:row.step_index,title:step.title,runId:run.id});
    store.exec("UPDATE flow_runs SET run_id=?,project_id=?,history=?,status='running',error=NULL,updated_at=? WHERE id=?",run.id,project.id,JSON.stringify(history),now(),row.id);
  }
  function tick() {
    for(const row of store.all("SELECT * FROM flow_runs WHERE status='running'"))try{
      if(!row.run_id){launch(row);continue;}
      const run=store.one('SELECT status,error FROM runs WHERE id=?',row.run_id);
      if(run && ['queued','running','waiting_approval','waiting_input'].includes(run.status))continue;
      if(run?.status!=='completed'){store.exec("UPDATE flow_runs SET status=?,error=?,updated_at=? WHERE id=?",run?.status==='cancelled'?'cancelled':'failed',run?.error||'Bosqich tugallanmadi.',now(),row.id);continue;}
      const steps=JSON.parse(row.steps);const next=row.step_index+1;
      const state=next===steps.length?'completed':steps[row.step_index].checkpoint?'paused':'running';
      store.exec('UPDATE flow_runs SET step_index=?,run_id=NULL,status=?,updated_at=? WHERE id=?',next,state,now(),row.id);
      if(state==='running')launch(store.one('SELECT * FROM flow_runs WHERE id=?',row.id));
    }catch(error){store.exec("UPDATE flow_runs SET status='failed',error=?,updated_at=? WHERE id=?",String(error.message).slice(0,700),now(),row.id);}
  }
  const timer=setInterval(tick,500);timer.unref();
  app.get('/api/flows',(req,res)=>res.json(store.all('SELECT * FROM flows WHERE user_id=? AND archived=? ORDER BY updated_at DESC',req.user.id,req.query.archived==='true'?1:0).map(visible)));
  app.post('/api/flows',(req,res)=>{const v=parse(definition,req.body);for(const s of v.steps)runner.providerFor(s.providerId,s.model,req.user.id);if(store.one('SELECT COUNT(*) n FROM flows WHERE user_id=?',req.user.id).n>=100)throw new HttpError(400,'100 ta oqim chegarasi.');const fid=id('flow_');store.exec('INSERT INTO flows VALUES(?,?,?,?,?,?,?,0)',fid,req.user.id,v.name,v.description,JSON.stringify(v.steps),now(),now());res.status(201).json(visible(owned('flows',req.user.id,fid)));});
  app.put('/api/flows/:flowId',(req,res)=>{const row=owned('flows',req.user.id,req.params.flowId);const v=parse(definition,req.body);for(const s of v.steps)runner.providerFor(s.providerId,s.model,req.user.id);store.exec('UPDATE flows SET name=?,description=?,steps=?,updated_at=? WHERE id=?',v.name,v.description,JSON.stringify(v.steps),now(),row.id);res.json(visible(owned('flows',req.user.id,row.id)));});
  app.patch('/api/flows/:flowId',(req,res)=>{const row=owned('flows',req.user.id,req.params.flowId);const v=parse(z.object({archived:z.boolean()}),req.body);store.exec('UPDATE flows SET archived=? WHERE id=?',v.archived?1:0,row.id);res.json({ok:true});});
  app.get('/api/flow-runs',(req,res)=>res.json(store.all('SELECT * FROM flow_runs WHERE user_id=? ORDER BY created_at DESC LIMIT 100',req.user.id).map(row=>({...visible(row),stage_status:row.run_id?store.one('SELECT status FROM runs WHERE id=?',row.run_id)?.status:null}))));
  app.post('/api/flows/:flowId/start',(req,res)=>{const flow=owned('flows',req.user.id,req.params.flowId);if(flow.archived)throw new HttpError(409,'Oqim arxivlangan.');const v=parse(z.object({input:z.string().max(5000).default('')}),req.body);if(store.one("SELECT COUNT(*) n FROM flow_runs WHERE user_id=? AND status IN ('running','paused','interrupted')",req.user.id).n>=2)throw new HttpError(429,'Avval faol ish oqimlarini yakunlang yoki to‘xtating.');const fid=id('fr_');store.exec("INSERT INTO flow_runs(id,user_id,flow_id,name,steps,input,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'running',?,?)",fid,req.user.id,flow.id,flow.name,flow.steps,v.input,now(),now());tick();res.status(201).json(visible(owned('flow_runs',req.user.id,fid)));});
  app.post('/api/flow-runs/:flowRunId/resume',(req,res)=>{const row=owned('flow_runs',req.user.id,req.params.flowRunId);if(!['paused','failed','interrupted'].includes(row.status))throw new HttpError(409,'Oqim davom ettirish holatida emas.');const current=row.run_id?store.one('SELECT status FROM runs WHERE id=?',row.run_id):null;if(current && ['running','queued','waiting_approval','waiting_input'].includes(current.status))throw new HttpError(409,'Joriy bosqich hali faol.');store.exec("UPDATE flow_runs SET status='running',run_id=?,error=NULL,updated_at=? WHERE id=?",current?.status==='completed'?row.run_id:null,now(),row.id);tick();res.json(visible(owned('flow_runs',req.user.id,row.id)));});
  app.post('/api/flow-runs/:flowRunId/cancel',(req,res)=>{const row=owned('flow_runs',req.user.id,req.params.flowRunId);if(row.status==='completed')throw new HttpError(409,'Oqim tugallangan.');store.exec("UPDATE flow_runs SET status='cancelled',updated_at=? WHERE id=?",now(),row.id);if(row.run_id)runner.cancel(req.user.id,row.run_id);res.json({ok:true});});
  return {close:()=>clearInterval(timer)};
}
