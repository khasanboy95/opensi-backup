import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {id,now,HttpError,redact} from './security.mjs';
import {complete} from './provider.mjs';
import {projectRoot,listFiles,safePath} from './files.mjs';
import {parallelWorkspace} from './parallel-workspace.mjs';
import {cloudCommand,cloudAvailable} from './commands.mjs';
import {WorkPool} from './work-pool.mjs';
import {canFallback} from './orchestration.mjs';
import {withProviderFailure} from './model-health.mjs';
import {repairToolHistory} from './history.mjs';
import {recoverableToolFailure} from './adaptive-team.mjs';

export const parallelSchemas={
  parallel_read:z.object({taskId:z.string().max(80),path:z.string().max(240),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(10000).default(6000)}).strict(),
  parallel_resolve:z.object({taskId:z.string().max(80),path:z.string().max(240),expectedHash:z.string().nullable(),content:z.string().max(400000).optional(),remove:z.boolean().default(false),choice:z.enum(['current','proposed']).optional()}).strict(),
  parallel_finish:z.object({taskId:z.string().max(80),summary:z.string().min(5).max(2000)}).strict()
};
export const parallelDescriptions={
  parallel_read:'Read a prepared parallel change: base, proposed and CURRENT file plus hashes. Read all ranges using nextOffset before resolving long files. Use the current file and all user requests when resolving overlaps. Large/binary files are identified explicitly.',
  parallel_resolve:'Resolve a parallel file conflict using reviewed combined content, an explicitly requested deletion, or choice=current/proposed to retain that version (also supports binary files). expectedHash MUST equal currentHash from a fresh parallel_read. Preserve all user requirements. A changed hash requires a fresh read.',
  parallel_finish:'Mark a parallel request reviewed and integrated after checking its files, requirements and applicable real tests. Every conflict must be resolved first. Summary describes actual checks and any unverified boundary. Never mark an incomplete task finished.'
};
const fileSchemas={
  list_files:z.object({path:z.string().max(240).optional(),offset:z.number().int().min(0).optional(),limit:z.number().int().min(1).max(500).optional()}).strict(),
  prepare_files:z.object({path:z.string().max(240).default('')}).strict(),
  read_file:z.object({path:z.string().max(240),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(12000).default(12000)}).strict(),
  write_file:z.object({path:z.string().max(240),content:z.string().max(400000)}).strict(),
  append_file:z.object({path:z.string().max(240),content:z.string().max(400000)}).strict(),
  edit_file:z.object({path:z.string().max(240),search:z.string().min(1).max(12000),replace:z.string().max(400000)}).strict(),
  run_command:z.object({command:z.string().min(1).max(8000),timeout:z.number().int().min(1).max(110).optional()}).strict()
};
const activeStatuses=['queued','running','waiting_approval','waiting_input'];
const terminal=new Set(['completed','cancelled']);

export function parallelService({config,store,nodes,event,candidates,providerFor,teamLoad,modelHealth,prepareInputs,automatic,checkAccount,safeError}){
  store.db.exec(`CREATE TABLE IF NOT EXISTS parallel_tasks(
    id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),request_id TEXT NOT NULL,
    prompt TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,model TEXT,step INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL DEFAULT '',error TEXT,data TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(run_id,request_id));CREATE INDEX IF NOT EXISTS parallel_run ON parallel_tasks(run_id,created_at);`);
  const inflight=new Map(),controllers=new Map(),setupRetries=new Set(),pool=new WorkPool(config.maxConcurrent||100,config.parallelPerUser||3);let stopping=false;
  const data=row=>JSON.parse(store.setting('parallel-data:'+row.id,row.data||'{}'));
  const saveData=(task,value)=>store.setSetting('parallel-data:'+task.id,JSON.stringify(value));
  const rawList=runId=>store.all('SELECT * FROM parallel_tasks WHERE run_id=? ORDER BY created_at,id',runId);
  const publicTask=row=>({id:row.id,prompt:row.prompt,status:row.status,providerId:row.provider_id,model:row.model,step:row.step,summary:row.summary,error:row.error,files:(data(row).changes||[]).map(({path,state})=>({path,state})),createdAt:row.created_at,updatedAt:row.updated_at});
  const emit=task=>event(task.run_id,'parallel_task',{task:publicTask(store.one('SELECT * FROM parallel_tasks WHERE id=?',task.id))});
  const update=(task,values)=>{for(const [key,value] of Object.entries(values))if(['status','provider_id','model','step','summary','error'].includes(key))store.exec(`UPDATE parallel_tasks SET ${key}=?,updated_at=? WHERE id=?`,value,now(),task.id);emit(task);};
  function owned(run,taskId){const row=store.one('SELECT * FROM parallel_tasks WHERE id=? AND run_id=?',taskId,run.id);if(!row)throw new HttpError(404,'Qo‘shimcha vazifa topilmadi.');return row;}
  const branch=(run,task)=>parallelWorkspace(projectRoot(config,{...run,id:run.project_id}),path.join(config.dataDir,'parallel',run.user_id,task.id),{workRoot:projectRoot(config,{...run,id:'prj_'+task.id.slice(4)})});
  async function action(run,project,task,operation,args,signal,requestId){
    if(project.environment==='local')return nodes.dispatch(project,run.id,'parallel_workspace',{taskId:task.id,operation,...args,requestId:requestId||id('req_')},signal);
    const fs=branch(run,task);
    if(operation==='create')return fs.create(signal);
    if(operation==='files')return fs.files(args.tool,args.args);
    if(operation==='command')return cloudCommand(config,fs.work,args,signal);
    if(operation==='changes')return fs.changes();
    if(operation==='apply')return fs.apply(signal);
    if(operation==='read')return fs.read(args.path,args);
    if(operation==='resolve')return fs.resolve(args);
    if(operation==='cleanup')return fs.cleanup();
    throw Error('Parallel amal bu muhitda mavjud emas.');
  }
  async function prepare(run,project,task){
    const controller=new AbortController();controllers.set(task.id,controller);const {signal}=controller;
    let release,workspaceReady=false;
    try{
      release=await pool.acquire(run.user_id,signal);checkAccount(run.user_id);
      const saved=data(task);
      let input=saved.input||[];
      if(saved.attachmentIds?.length&&!saved.inputsReady){input=await prepareInputs(run,project,saved.attachmentIds,signal);saved.inputsReady=true;saved.input=project.environment==='local'?[]:input;saveData(task,saved);}
      const created=await action(run,project,task,'create',{},signal,task.id+':create');
      const inventory=await action(run,project,task,'files',{tool:'list_files',args:{limit:200}},signal);
      workspaceReady=true;saved.setupFailed=false;saved.snapshot=created;saveData(task,saved);
      let history=saved.history||[{role:'system',content:'OpenSI parallel preparation worker. You work in a PRIVATE SNAPSHOT while the main model continues. Implement this additional request with actual file tools. Preserve existing files and project instructions; read before editing. Do not deploy, publish, message people, access account credentials or change system settings. Only prepare code/documents and relevant local checks. Other workers may be editing the same files: final integration and conflict resolution belong to the coordinator. Never claim a test ran without a tool result. Keep final summary concise (max 2000 characters), list changed files, actual checks, integration requirements and remaining problems. Large projects use a local source index: list_files paginates the entire index and supports a path prefix; read_file/edit_file/write_file materialize the selected original automatically. materialized=false means available on demand, NOT missing or deleted. Before scratch terminal tests use prepare_files with the relevant project subfolder to materialize its sources. Do not test a partial tree as if it were complete. Large assets stay in the original project; the final coordinator can inspect them there. Source inventory total: '+inventory.total+'; on-demand files: '+(created.lazyFiles||0)+'. First inventory page: '+inventory.files.map(f=>f.path).join(', ').slice(0,12000)},
        {role:'user',content:[{type:'text',text:'Main project request (context only): '+run.prompt.slice(0,6000)+'\nYOUR ADDITIONAL REQUEST: '+task.prompt+'\n'+(created.resumed?'A previous attempt was interrupted. Inspect your existing scratch files and continue; do not start over.':'')},...input]}];
      history=repairToolHistory(history);if(saved.history&&created.resumed)history.push({role:'user',content:'This preparation resumed after an interruption. Read existing scratch files first; unknown tool outcomes must be inspected before retrying.'});
      const commandAllowed=automatic(project)&&(project.environment==='local'||cloudAvailable(config));
      const tools=Object.entries(fileSchemas).filter(([name])=>name!=='run_command'||commandAllowed).map(([name,schema])=>({type:'function',function:{name,description:name==='run_command'?'Run a build or test in your scratch project. No deploy or external side effects.':name==='prepare_files'?'Materialize all indexed sources of a selected project subfolder before scratch build/tests. Empty path selects the whole project. Bounded to 64 MB total and 16 MB per file; choose a narrower subfolder if it does not fit. Never changes the original project.':'Read or edit only your isolated scratch project. '+name,parameters:z.toJSONSchema(schema,{target:'draft-7'})}}));
      const excluded=new Set();let chosen,failedSteps=0;
      for(let step=0;step<(config.parallelMaxSteps||48);step++){
        signal.throwIfAborted();checkAccount(run.user_id);
        if(!chosen){
          const roster=candidates(run,project,'build',excluded).filter(m=>{const p=providerFor(m.providerId,m.model,run.user_id);return p.protocol!=='antigravity-cli'||!created.lazyFiles&&nodes.list(run.user_id).find(n=>n.id===p.node_id)?.capabilities.includes('parallel_workspace_v1');});
          const mainModel=store.all("SELECT data FROM events WHERE run_id=? AND type='model_route' ORDER BY id DESC LIMIT 1",run.id).map(row=>JSON.parse(row.data))[0]?.model||run.model;
          const assigned=new Set(rawList(run.id).filter(t=>t.id!==task.id&&!terminal.has(t.status)).map(t=>t.provider_id+':'+t.model));
          const ranked=teamLoad.rank(run.user_id,roster);chosen=ranked.find(m=>m.model!==mainModel&&!assigned.has(m.providerId+':'+m.model))||ranked.find(m=>m.model!==mainModel)||ranked[0];
          if(!chosen)throw Error('Qo‘shimcha vazifa uchun mos online model qolmadi.');
          update(task,{provider_id:chosen.providerId,model:chosen.model,status:'preparing',error:null});
        }
        const provider=providerFor(chosen.providerId,chosen.model,run.user_id),lease=teamLoad.start(run.user_id,chosen);let reply;
        try{
          if(provider.protocol==='antigravity-cli'){
            const nativeArgs={model:chosen.model,prompt:'OpenSI PARALLEL PRIVATE SNAPSHOT. Implement only the additional request below in this scratch workspace. Preserve existing code. Do not deploy, send messages, read credentials or change OS/account settings. Use native file tools; terminal is only for local tests if already permitted. Work is merged by another coordinator. Inspect saved files and continue if a prior attempt exists. Main request: '+run.prompt.slice(0,6000)+'\nADDITIONAL REQUEST: '+task.prompt};
            let result;
            if(project.environment==='cloud'){
              const fs=branch(run,task),remote={...project,environment:'local',node_id:provider.node_id};
              const files=await listFiles(fs.work);let size=0;const seed=[];
              for(const file of files){size+=file.size;if(size>5_000_000||seed.length>=300)throw Error('Antigravity parallel nusxasi 5 MB / 300 fayl chegarasidan oshdi. Nazorat modeli API orqali davom ettiradi.');seed.push({path:file.path,base64:(await readFile(await safePath(fs.work,file.path))).toString('base64')});}
              await nodes.dispatch(remote,run.id,'parallel_workspace',{taskId:task.id,operation:'seed',files:seed,requestId:task.id+':seed'},signal);
              saveData(task,{...saved,remoteNode:provider.node_id});
              result=await nodes.dispatch(remote,run.id,'parallel_workspace',{taskId:task.id,operation:'native',...nativeArgs,requestId:task.id+':native:'+step+':'+chosen.model},signal);
              const changes=await nodes.dispatch(remote,run.id,'parallel_workspace',{taskId:task.id,operation:'export',requestId:task.id+':export:'+step},signal);
              await fs.import(changes.files);
              saved.remoteNode=provider.node_id;
            }else result=await action(run,project,task,'native',nativeArgs,signal,task.id+':native:'+step+':'+chosen.model);
            if(result.usage)recordUsage(run,task,provider,chosen.model,{prompt_tokens:result.usage.input_tokens,completion_tokens:result.usage.output_tokens},lease);
            if(result.failure||result.error)throw withProviderFailure(Error(result.failure||result.error),result.providerError);
            reply={role:'assistant',content:result.response};
          }else{
            reply=await complete({provider,model:chosen.model,messages:history,tools,signal,config,onUsage:usage=>recordUsage(run,task,provider,chosen.model,usage,lease)});
          }
          if(!reply.tool_calls?.length&&!String(reply.content||'').trim())throw Error('Model empty response');
        }catch(error){
          if(!signal.aborted&&canFallback(error)&&excluded.size<6){modelHealth.fail(run.user_id,chosen,error);excluded.add(chosen.providerId+':'+chosen.model);chosen=null;history.push({role:'user',content:'The previous provider failed. Inspect existing scratch files and continue; preserve saved work.'});continue;}
          throw error;
        }finally{lease.release();}
        history.push(reply);update(task,{step:step+1});
        if(!reply.tool_calls?.length){
          if(failedSteps){if(excluded.size>=6)throw Error('Qo‘shimcha ishning oxirgi amali yoki testi tuzatilmagan.');excluded.add(chosen.providerId+':'+chosen.model);chosen=null;failedSteps=0;history.push({role:'user',content:'The last tool or test failed. Another model must inspect the failure and repair the saved work before declaring preparation complete.'});continue;}
          const changes=await action(run,project,task,'changes',{},signal);saveData(task,{...saved,changes:changes.changes,history:undefined,input:undefined});
          update(task,{status:'ready',summary:String(reply.content).slice(0,2000)});return;
        }
        let stepFailed=false;
        for(const call of reply.tool_calls.slice(0,12)){
          signal.throwIfAborted();let result;
          try{
            const schema=fileSchemas[call.function.name];if(!schema||call.function.name==='run_command'&&!commandAllowed)throw Error('Bu vosita tayyorlash bosqichida mavjud emas.');
            const args=schema.parse(JSON.parse(call.function.arguments||'{}'));
            result=await action(run,project,task,call.function.name==='run_command'?'command':'files',call.function.name==='run_command'?args:{tool:call.function.name,args},signal,task.id+':'+call.id);
          }catch(error){if(signal.aborted)throw error;result={error:redact(error.message,[provider.key])};}
          if(typeof result.output==='string'&&result.output.length>16000)result={...result,output:result.output.slice(-16000),truncated:true};
          if(recoverableToolFailure(result))stepFailed=true;
          history.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(result)});
        }
        // Do not persist local source bytes or shell output in server history.
        if(project.environment==='cloud')saveData(task,{...saved,history});
        failedSteps=stepFailed?failedSteps+1:0;
        if(failedSteps>=2&&excluded.size<6){excluded.add(chosen.providerId+':'+chosen.model);chosen=null;failedSteps=0;history.push({role:'user',content:'Repeated tool/test failures: continue with another model, inspect existing files and repair the exact error.'});}
        if(history.length>30)history=[...history.slice(0,2),...history.slice(-24)];
      }
      throw Error('Qo‘shimcha ish bosqich chegarasiga yetdi. Nazorat modeli saqlangan qoralamani davom ettiradi.');
    }catch(error){
      if(stopping||signal.aborted){update(task,{status:store.one('SELECT status FROM parallel_tasks WHERE id=?',task.id)?.status==='cancelled'?'cancelled':'preparing'});}
      else {saveData(task,{...data(task),setupFailed:!workspaceReady});update(task,{status:'needs_repair',error:safeError(error)});}
    }finally{release?.();controllers.delete(task.id);}
  }
  function recordUsage(run,task,provider,model,usage,lease){lease.usage(usage);store.usage(run,provider,model,'parallel:'+task.id,usage);event(run.id,'usage',{known:Boolean(usage&&Number.isFinite(usage.prompt_tokens)&&Number.isFinite(usage.completion_tokens)),input:usage?.prompt_tokens??null,output:usage?.completion_tokens??null,model,agent:'Qo‘shimcha vazifa'});}
  function start(run,project,task){
    if(stopping||inflight.has(task.id))return;
    const legacySetupFailure=task.step===0&&/Eksportda fayllar soni|eksport chegarasidan|Parallel nusxa uchun loyiha/.test(task.error||'');
    if(task.status==='needs_repair'&&(data(task).setupFailed||legacySetupFailure)&&!setupRetries.has(task.id)){
      setupRetries.add(task.id);update(task,{status:'preparing',error:null});task={...task,status:'preparing'};
    }
    if(task.status!=='preparing')return;
    const promise=prepare(run,project,task).finally(()=>inflight.delete(task.id));inflight.set(task.id,promise);
  }
  return {
    list:runId=>rawList(runId).map(publicTask),
    hasPending:runId=>rawList(runId).some(t=>!terminal.has(t.status)),
    add(run,project,{prompt,requestId,attachmentIds=[]}){
      const existing=store.one('SELECT * FROM parallel_tasks WHERE run_id=? AND request_id=?',run.id,requestId);if(existing)return publicTask(existing);
      if(!activeStatuses.includes(store.one('SELECT status FROM runs WHERE id=?',run.id)?.status))throw new HttpError(409,'Vazifa yakunlangan. Qo‘shimcha topshiriqni yangi davom sifatida yuboring.');
      checkAccount(run.user_id);
      if(!candidates(run,project,'review').some(m=>providerFor(m.providerId,m.model,run.user_id).protocol!=='antigravity-cli'))throw new HttpError(409,'Parallel birlashtirish uchun online API yoki ChatGPT modeli kerak.');
      if(project.environment==='local'&&!nodes.list(run.user_id).find(n=>n.id===project.node_id)?.capabilities?.includes('parallel_workspace_v1'))throw new HttpError(409,'Parallel ish uchun kompyuter connectorini yangilang: Ulanishlar → Kompyuter ulash.');
      if(rawList(run.id).filter(t=>!terminal.has(t.status)).length>=100)throw new HttpError(429,'Bu loyihada 100 ta tugallanmagan qo‘shimcha so‘rov bor.');
      const task={id:id('par_'),run_id:run.id,request_id:requestId,prompt,status:'preparing',created_at:now()};
      store.exec('INSERT INTO parallel_tasks(id,run_id,request_id,prompt,status,data,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',task.id,run.id,requestId,prompt,'preparing','{}',task.created_at,task.created_at);
      saveData(task,{attachmentIds});store.message(run,'user',{role:'user',content:prompt,parallelTaskId:task.id});event(run.id,'parallel_message',{taskId:task.id,prompt});emit(task);start(run,project,task);return publicTask(store.one('SELECT * FROM parallel_tasks WHERE id=?',task.id));
    },
    resume(run,project){for(const task of rawList(run.id)){setupRetries.delete(task.id);start(run,project,task);}},
    async join(run,project,signal,review){
      for(;;){
        signal.throwIfAborted();const batch=rawList(run.id).filter(t=>!terminal.has(t.status));if(!batch.length)return;
        for(const task of batch)start(run,project,task);
        await Promise.all(batch.map(t=>inflight.get(t.id)).filter(Boolean));signal.throwIfAborted();
        const pendingTasks=rawList(run.id).filter(t=>!terminal.has(t.status));
        for(const task of pendingTasks){
          if(task.status==='preparing')continue;
          const checkpoint=data(task);if(!checkpoint.reviewCursor){checkpoint.reviewCursor=store.one('SELECT MAX(id) n FROM events WHERE run_id=?',run.id).n||0;saveData(task,checkpoint);}update(task,{status:'reviewing'});
          try{const result=await action(run,project,task,'apply',{},signal);saveData(task,{...data(task),changes:result.changes});update(task,{status:'reviewing'});event(run.id,'files_changed',{});}
          catch(error){if(signal.aborted)throw error;update(task,{status:'reviewing',error:redact(error.message,[])});}
        }
        const reviewing=rawList(run.id).filter(t=>t.status==='reviewing');if(!reviewing.length)continue;
        event(run.id,'parallel_coordinator',{status:'reviewing',tasks:reviewing.map(t=>t.id),message:'Nazorat modeli qo‘shimcha natijalarni birlashtirib, tekshirmoqda.'});
        await review(reviewing.map(t=>({...publicTask(t),changes:data(t).changes||[]})));
        const unfinished=reviewing.filter(t=>!terminal.has(store.one('SELECT status FROM parallel_tasks WHERE id=?',t.id).status));
        if(unfinished.length)throw Error('Nazorat modeli qo‘shimcha ishlarni yakunlamadi. Qoralamalar saqlangan; shu joydan davom ettirish mumkin.');
        event(run.id,'parallel_coordinator',{status:'completed',tasks:reviewing.map(t=>t.id),message:'Natijalar birlashtirildi va nazoratdan o‘tdi.'});
      }
    },
    async tool(run,project,name,args,signal){
      const task=owned(run,args.taskId);if(name==='parallel_finish'&&task.status==='completed')return {finished:true,reused:true,taskId:task.id};if(task.status!=='reviewing')throw Error('Qo‘shimcha ish hali tekshiruv bosqichiga kelmagan.');
      if(name==='parallel_read')return action(run,project,task,'read',args,signal);
      if(name==='parallel_resolve'){
        const previous=data(task),change=previous.changes?.find(c=>c.path===args.path);if(!change)throw Error('Bu fayl qo‘shimcha ish natijasiga kirmaydi.');
        const result=await action(run,project,task,'resolve',args,signal);change.state='resolved';saveData(task,previous);emit(task);event(run.id,'files_changed',{});return result;
      }
      const value=data(task);if(value.changes?.some(c=>c.state==='conflict'))throw Error('Avval fayl ziddiyatlarini parallel_read va parallel_resolve bilan hal qiling.');
      const lastCheck=store.one("SELECT data FROM events WHERE run_id=? AND id>? AND type='tool_result' AND json_extract(data,'$.tool') IN ('run_command','browser_test') ORDER BY id DESC LIMIT 1",run.id,value.reviewCursor||0);
      if(lastCheck&&recoverableToolFailure(JSON.parse(lastCheck.data).result))throw Error('Oxirgi tekshiruv muvaffaqiyatsiz. Xatoni tuzatib qayta tekshiring.');
      update(task,{status:'completed',summary:args.summary,error:null});
      if(value.remoteNode)await nodes.dispatch({...project,environment:'local',node_id:value.remoteNode},run.id,'parallel_workspace',{taskId:task.id,operation:'cleanup',requestId:task.id+':remote-cleanup'},signal).catch(()=>{});
      await action(run,project,task,'cleanup',{},signal).catch(()=>{});saveData(task,{changes:value.changes});return {finished:true,taskId:task.id};
    },
    cancel(run,taskId){const task=owned(run,taskId);if(terminal.has(task.status))return;if(task.status==='reviewing')throw new HttpError(409,'Bu qoralama birlashtirilmoqda. Asosiy vazifani to‘xtatish mumkin.');update(task,{status:'cancelled'});controllers.get(task.id)?.abort(Error('Qo‘shimcha vazifa to‘xtatildi.'));},
    async stop(runId){for(const task of rawList(runId))controllers.get(task.id)?.abort(Error('Asosiy vazifa to‘xtatildi.'));await Promise.all(rawList(runId).map(t=>inflight.get(t.id)).filter(Boolean));},
    async close(){stopping=true;for(const controller of controllers.values())controller.abort(Error('Server to‘xtatildi.'));await Promise.all([...inflight.values()]);}
  };
}
