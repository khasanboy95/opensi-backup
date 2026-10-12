import { setTimeout as delay } from 'node:timers/promises';
import {folderCatalog,linkedProject} from './project-links.mjs';
import { WorkPool } from './work-pool.mjs';
import {withProviderFailure} from './model-health.mjs';
import { id, token, hash, now, HttpError } from './security.mjs';

export function nodeService(config, store) {
  const progressListeners = new Map();
  const commands = new WorkPool(1000, 1);
  const nodeCommands = new WorkPool(1000, 4);
  const folderRequests=new Map();
  const takeFolder=node=>{const request=[...folderRequests.values()].find(r=>r.nodeId===node.id&&r.userId===node.user_id&&!r.claimed);if(!request)return null;request.claimed=true;return {id:request.id,tool:request.tool,args:request.args};};
  let commandSecurity,connectionListener;const browserPayloads=new Map(),browserResults=new Map();
  return {
    acknowledge(commandId){if(commandId)store.exec('UPDATE commands SET consumed=1 WHERE id=?',commandId);},
    setConnectionListener(listener){connectionListener=listener;},
    async linkFolderPath(userId,nodeId,folderPath){const result=await this.folderRequest(userId,nodeId,'link_folder_path',{path:folderPath});return {nodeId:result.nodeId,folder:folderCatalog([result.value])[0]};},
    async browseFolders(userId,nodeId,args){return (await this.folderRequest(userId,nodeId,'browse_folders',args)).value;},
    async folderRequest(userId,nodeId,tool,args){
      const folderPath=args.path;
      const candidates=this.list(userId).filter(n=>n.online&&!n.revoked&&n.platform!=='browser'&&!store.setting('hosted-antigravity:'+n.id));
      const node=nodeId?candidates.find(n=>n.id===nodeId):candidates.length===1?candidates[0]:null;
      if(!node)throw new HttpError(409,nodeId?'Tanlangan kompyuter offline yoki hisobingizga ulanmagan.':'Loyihalar → Mavjud papkani ulash orqali online kompyuterni tanlang.');
      if(!node.capabilities.includes(tool==='browse_folders'?'folder_browse_v1':'folder_path_v1'))throw new HttpError(409,'Kompyuter connectorini yangilang: Ulanishlar → Kompyuter ulash.');
      if(typeof folderPath!=='string'||(tool==='link_folder_path'&&!folderPath.trim())||folderPath.length>2000||/[\x00-\x1f]/.test(folderPath))throw new HttpError(400,'Papka yo‘li noto‘g‘ri.');
      if([...folderRequests.values()].some(r=>r.nodeId===node.id))throw new HttpError(409,'Bu kompyuterda papka tekshirilmoqda. Bir ozdan keyin qayta urining.');
      const request={id:id('folder_'),nodeId:node.id,userId,tool,args,claimed:false,result:null};folderRequests.set(request.id,request);
      try{const deadline=Date.now()+Math.min(30000,config.connectorTimeout);while(Date.now()<deadline){
        if(!this.list(userId).some(n=>n.id===node.id&&!n.revoked&&n.online))throw new HttpError(409,'Kompyuter ulanishi uzildi.');
        if(request.result){if(request.result.error)throw new HttpError(400,request.result.error);return {nodeId:node.id,value:request.result};}
        await delay(150);
      }throw new HttpError(504,'Kompyuter papka yo‘liga javob bermadi. Connectorni tekshirib qayta urining.');}finally{folderRequests.delete(request.id);}
    },
    folders(node, folders) {store.setSetting('node-folders:'+node.id,folderCatalog(folders));return {ok:true};},
    setCommandSecurity(value){commandSecurity=value;},
    agentCatalog(node, models) {
      store.setSetting(`antigravity:${node.id}`, { models, updated: now() });
      return { ok: true };
    },
    providers(userId) {
      return this.list(userId).filter(node => !node.revoked).flatMap(node => {
        const catalog = store.setting(`antigravity:${node.id}`);
        if (!catalog?.models?.length) return [];
        const hosted = store.setting(`hosted-antigravity:${node.id}`)?.owner === userId;
        return [{ id: `agy_${node.id}`, node_id: node.id, hosted, label: `Antigravity · ${node.name}`, protocol: 'antigravity-cli', base_url: hosted ? 'Rasmiy CLI · bulutdagi hisob' : 'Rasmiy CLI · lokal hisob',
          models: catalog.models.map(m => m.id), model_labels: Object.fromEntries(catalog.models.map(m => [m.id, m.label])),
          enabled: node.online, has_key: false, verified_at: catalog.updated, tested_at: null }];
      });
    },
    pairCode(user) {
      const code = token().slice(0, 20);
      store.exec('DELETE FROM pair_codes WHERE expires_at<?', Date.now());
      store.exec('INSERT INTO pair_codes VALUES(?,?,?)', hash(code), user.id, Date.now() + 10 * 60_000);
      return { code, expiresIn: 600 };
    },
    pair({ code, name, platform, workspace }) {
      const row = store.one('SELECT * FROM pair_codes WHERE hash=? AND expires_at>?', hash(code), Date.now());
      if (!row) throw new HttpError(401, 'Ulash kodi noto‘g‘ri yoki muddati tugagan.');
      const user = store.one('SELECT disabled FROM users WHERE id=?', row.user_id);
      if (!user || user.disabled) throw new HttpError(403, 'Hisob faol emas.');
      const secret = token(); const nodeId = id('node_');
      store.db.exec('BEGIN IMMEDIATE');
      try {
        const deleted = store.exec('DELETE FROM pair_codes WHERE hash=?', hash(code));
        if (!deleted.changes) throw new HttpError(401, 'Ulash kodi allaqachon ishlatilgan.');
        store.exec('INSERT INTO nodes(id,user_id,name,platform,workspace,token_hash,last_seen) VALUES(?,?,?,?,?,?,?)', nodeId, row.user_id, name, platform, workspace, hash(secret), now());
        store.db.exec('COMMIT');
      } catch (error) { store.db.exec('ROLLBACK'); throw error; }
      return { nodeId, token: secret };
    },
    authenticate(req) {
      const secret = req.get('authorization')?.replace(/^Bearer /, '');
      if (!secret) throw new HttpError(401, 'Connector avtorizatsiyasi kerak.');
      const node = store.one('SELECT n.* FROM nodes n JOIN users u ON u.id=n.user_id WHERE n.token_hash=? AND n.revoked=0 AND u.disabled=0', hash(secret));
      if (!node) throw new HttpError(401, 'Connector tokeni bekor qilingan.');
      return node;
    },
    list(userId) {
      return store.all('SELECT id,name,platform,workspace,last_seen,revoked FROM nodes WHERE user_id=? ORDER BY last_seen DESC', userId)
        .map(node => ({ ...node, hosted:Boolean(store.setting('hosted-antigravity:'+node.id)),local_port:store.setting('node-local-port:'+node.id)||null, folders:store.setting('node-folders:'+node.id)||[], capabilities:store.setting('node-capabilities:'+node.id)||[], online: !node.revoked && Date.now() - new Date(node.last_seen).getTime() < 25_000 }));
    },
    heartbeat(node, capabilities, localPort) {
      if(Number.isInteger(localPort)&&localPort>=1024&&localPort<=65535)store.setSetting('node-local-port:'+node.id,localPort);
      if(Array.isArray(capabilities))store.setSetting('node-capabilities:'+node.id,capabilities.filter(v=>['computer_browser_v1','project_service_v1','webhook_v1','linked_folders_v1','browser_files_v1','folder_path_v1','folder_browse_v1','native_command_bridge_v2','native_diagnostics_v1','parallel_workspace_v1'].includes(v)));
      store.exec('UPDATE nodes SET last_seen=? WHERE id=?', now(), node.id);
      const cancelled = store.all("SELECT c.id FROM commands c LEFT JOIN runs r ON r.id=c.run_id WHERE c.node_id=? AND c.status IN ('claimed','cancelled') AND (c.status='cancelled' OR r.status IN ('cancelled','failed','interrupted') OR (c.run_id IS NULL AND c.created_at<?)) ORDER BY c.created_at DESC LIMIT 100", node.id, new Date(Date.now() - 330000).toISOString());
      return { cancelCommandIds: cancelled.map(item => item.id),...(capabilities?.includes('folder_browse_v1')?{folderCommand:takeFolder(node)}:{}) };
    },
    poll(node) {
      this.heartbeat(node);
      const folder=takeFolder(node);if(folder)return {command:folder};
      const row = store.one("SELECT c.* FROM commands c LEFT JOIN runs r ON r.id=c.run_id WHERE c.node_id=? AND c.status='queued' AND (c.run_id IS NULL OR r.status='running' OR c.tool='parallel_workspace' AND r.status IN ('queued','waiting_input','waiting_approval')) ORDER BY c.created_at LIMIT 1", node.id);
      if (!row) return { command: null };
      store.exec("UPDATE commands SET status='claimed',claimed_at=? WHERE id=? AND status='queued'", now(), row.id);
      let args=row.tool==='computer_browser'?browserPayloads.get(row.id):JSON.parse(row.args);if(!args){store.exec("UPDATE commands SET status='cancelled' WHERE id=?",row.id);return {command:null};}
      try{if(commandSecurity)args=commandSecurity.hydrate(node,row,args);}catch{store.exec("UPDATE commands SET status='done',result=? WHERE id=?",JSON.stringify({error:'Xizmat kalitlari mavjud emas yoki ruxsat bekor qilingan.'}),row.id);return {command:null};}
      return { command: { id: row.id,runId:row.run_id, projectId: row.project_id, linked:Boolean(linkedProject(store,store.one('SELECT id,environment,node_id FROM projects WHERE id=?',row.project_id)||{id:row.project_id})), sourceId:linkedProject(store,{id:row.project_id})?.sourceId, tool: row.tool, args } };
    },
    result(node, commandId, result) {
      if(commandId.startsWith('folder_')){const request=folderRequests.get(commandId);if(!request||request.nodeId!==node.id||request.userId!==node.user_id||!request.claimed)throw new HttpError(404,'Papka so‘rovi eskirgan.');request.result=result;return {ok:true};}
      const accepted=store.one("SELECT c.id FROM commands c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.node_id=? AND c.status='done' AND p.user_id=?",commandId,node.id,node.user_id);
      if(accepted)return {ok:true,replayed:true};
      const command = store.one("SELECT c.* FROM commands c JOIN projects p ON p.id=c.project_id WHERE c.id=? AND c.node_id=? AND c.status='claimed' AND p.user_id=?", commandId, node.id, node.user_id);
      if (!command) throw new HttpError(404, 'Connector buyrug‘i topilmadi.');
      if(command.tool==='computer_browser'){browserResults.set(commandId,result);store.exec("UPDATE commands SET status='done',result=NULL WHERE id=?",commandId);return {ok:true};}
      store.exec("UPDATE commands SET status='done',result=? WHERE id=?", JSON.stringify(commandSecurity?commandSecurity.redact(node,command,result):result), commandId);
      return { ok: true };
    },
    progress(node, commandId, output) {
      const command = store.one("SELECT c.id FROM commands c JOIN projects p ON p.id=c.project_id JOIN runs r ON r.id=c.run_id WHERE c.id=? AND c.node_id=? AND c.status='claimed' AND c.tool IN ('run_command','antigravity_task') AND p.user_id=? AND r.status='running'", commandId, node.id, node.user_id);
      if (!command) throw new HttpError(404, 'Faol terminal buyrug‘i topilmadi.');
      progressListeners.get(commandId)?.(output); return { ok: true };
    },
    async dispatch(project, runId, tool, args, signal, onOutput) {
      const parallel=tool==='parallel_workspace';
      const release = await commands.acquire(project.node_id+':'+(parallel?project.id+':'+args.taskId:'main'), signal);
      let nodeRelease;
      try {
      nodeRelease=await nodeCommands.acquire(project.node_id,signal);
      signal?.throwIfAborted();
      const node = store.one('SELECT * FROM nodes WHERE id=? AND user_id=? AND revoked=0', project.node_id, project.user_id);
      if (!node) throw new HttpError(403, 'Lokal connector ulanishi bekor qilingan.');
      if (!runId && Date.now() - new Date(node.last_seen).getTime() > 25_000) throw new HttpError(409, 'Lokal connector hozir offline. Kompyuterda connectorni ishga tushiring.');
      const previous=runId&&tool!=='computer_browser'?(parallel?store.one("SELECT id FROM commands WHERE run_id=? AND node_id=? AND tool=? AND json_extract(args,'$.requestId')=? AND (status IN ('queued','claimed') OR (status='done' AND consumed=0)) ORDER BY created_at LIMIT 1",runId,node.id,tool,args.requestId):store.one("SELECT id FROM commands WHERE run_id=? AND node_id=? AND tool=? AND (status IN ('queued','claimed') OR (status='done' AND consumed=0)) ORDER BY created_at LIMIT 1",runId,node.id,tool)):null;
      const commandId = previous?.id||id('cmd_');if(tool==='computer_browser')browserPayloads.set(commandId,args);
      if(!previous)store.exec('INSERT INTO commands(id,node_id,project_id,run_id,tool,args,status,created_at) VALUES(?,?,?,?,?,?,?,?)', commandId, node.id, project.id, runId || null, tool, tool==='computer_browser'?'{}':JSON.stringify(args), 'queued', now());
      let remaining=tool === 'antigravity_task'||parallel&&args.operation==='native' ? 330000 : config.connectorTimeout,lastTick=Date.now(),disconnected=false;
      if (onOutput) progressListeners.set(commandId, onOutput);
      try {
        while (remaining>0) {
          signal?.throwIfAborted();
          const current=store.one('SELECT last_seen,revoked FROM nodes WHERE id=?',node.id);
          if(!current||current.revoked)throw new HttpError(403,'Lokal connector ulanishi bekor qilingan.');
          const online=Date.now()-Date.parse(current.last_seen)<(config.connectorOfflineMs||25000);
          const tick=Date.now();if(online||!runId)remaining-=tick-lastTick;lastTick=tick;
          if(runId&&disconnected===online){disconnected=!online;connectionListener?.(runId,online);}
          const row = store.one('SELECT status,result FROM commands WHERE id=?', commandId);
          if (row?.status === 'done') {
            const result = tool==='computer_browser'?browserResults.get(commandId):JSON.parse(row.result);if(!result)throw new HttpError(409,'Brauzer buyrug‘i eskirgan. Qayta kuzating.');
            store.exec('UPDATE commands SET consumed=1 WHERE id=?',commandId);
            if (result.error){const error=withProviderFailure(new HttpError(result.status===404?404:502, result.error),result.providerError);if(result.code==='connector_interrupted')error.connectionLost=true;throw error;}
            return result;
          }
          if(row?.status==='cancelled')throw new HttpError(409,'Connector buyrug‘i bekor qilindi.');
          await delay(300, undefined, { signal });
        }
        throw new HttpError(504, 'Lokal connector javobi uchun vaqt tugadi.');
      } finally {browserPayloads.delete(commandId);browserResults.delete(commandId);const interrupted=runId&&store.one('SELECT status FROM runs WHERE id=?',runId)?.status==='interrupted';if(!interrupted&&(linkedProject(store,project)||tool==='prepare_local_attachment'))store.exec("UPDATE commands SET args='{}',result=NULL WHERE id=?",commandId); progressListeners.delete(commandId);if(!interrupted)store.exec("UPDATE commands SET status='cancelled' WHERE id=? AND status IN ('queued','claimed')", commandId); }
      } finally { nodeRelease?.();release(); }
    },
  };
}
