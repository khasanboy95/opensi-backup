import {localBrowserService} from './browser.mjs';
import {connectorLock} from './instance-lock.mjs';
import {resultDelivery} from './delivery.mjs';
import {nativeMemory} from './native-memory.mjs';
import {startLocalBridge} from './local-bridge.mjs';
import {localFolders,commandRoot,registerFolder,browseFolders} from './folders.mjs';
import {inspectProject} from '../server/project-inspect.mjs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileTool, listFiles, safePath } from '../server/files.mjs';
import { localCommand } from '../server/commands.mjs';
import { cliModels, cliTask } from './antigravity.mjs';
import { progressSender } from './progress.mjs';
import {serviceManager} from './services.mjs';
import {webhookWorker} from '../server/webhook-worker.mjs';
import {parallelWorkspace} from '../server/parallel-workspace.mjs';

export async function startConnector(options) {
  const release=await connectorLock(options.stateDir||path.join(os.homedir(),'.opensi'));
  try{return await runConnector(options);}finally{await release();}
}
async function runConnector({ server, code, workspace, stateDir, antigravity, name = os.hostname(), signal: stopSignal, quiet = false, pairOnly = false }) {
  const serverUrl = new URL(server);
  if (serverUrl.username || serverUrl.password || serverUrl.search || serverUrl.hash || serverUrl.pathname !== '/') throw new Error('Connector uchun serverning asosiy manzili kerak.');
  if (serverUrl.protocol !== 'https:' && !(serverUrl.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(serverUrl.hostname))) throw new Error('Connector HTTPS yoki localhost orqali ulanadi.');
  server = serverUrl.origin;
  workspace = path.resolve(workspace);
  stateDir = path.resolve(stateDir || path.join(os.homedir(), '.opensi'));
  await mkdir(workspace, { recursive: true }); await mkdir(stateDir, { recursive: true });
  let credentials;
  const credentialPath = path.join(stateDir, 'connection.json');
  const api = async (route, body, bearer) => {
    const response = await fetch(`${server}/api/connector${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(route==='/computer-network'?100_000:20_000), redirect: 'error',
    });
    if (!response.ok) { const error=new Error(`Connector HTTP ${response.status}. Ulanish yoki tokenni tekshiring.`);error.status=response.status;throw error; }
    return response.json();
  };
  if (code) {
    credentials = { ...(await api('/pair', { code, name, platform: process.platform, workspace: path.basename(workspace) })), server, workspace };
    await writeFile(credentialPath, JSON.stringify(credentials), { mode: 0o600 });
  } else {
    credentials = JSON.parse(await readFile(credentialPath, 'utf8'));
    if (credentials.server !== server || credentials.workspace !== workspace) throw new Error('Saqlangan ulanish boshqa server yoki workspacega tegishli. Yangi kod bilan ulang.');
  }
  if(pairOnly)return;
  if (!quiet) console.log(`OpenSI connector ulandi. Workspace: ${workspace}. To‘xtatish: Ctrl+C.`);
  let agentModels = [];
  if (antigravity) {
    if (!path.isAbsolute(antigravity)) throw new Error('Antigravity CLI uchun to‘liq fayl yo‘li kerak.');
    agentModels = await cliModels(antigravity, workspace);
    await api('/agent-catalog', { models: agentModels }, credentials.token).catch(()=>{});
    if (!quiet) console.log(`Antigravity: ${agentModels.length} model. Google hisob sessiyasi kompyuterda qoladi.`);
  } else await api('/agent-catalog', { models: [] }, credentials.token).catch(() => {});
  const services=serviceManager();const browsers=localBrowserService({server,approveWrite:body=>api('/computer-network',body,credentials.token)});
  const bridge=await startLocalBridge({server,nodeId:credentials.nodeId,stateDir,api:(route,body)=>api(route,body,credentials.token)});
  async function folderCommand(command){
    let result;try{if(command.tool==='browse_folders')result=await browseFolders(stateDir,workspace,command.args);else if(command.tool==='link_folder_path'){result=await registerFolder(stateDir,command.args.path);await api('/folders',{folders:(await localFolders(stateDir)).map(({id,label,kind})=>({id,label,kind}))},credentials.token);}else throw Error('Papka amali noto‘g‘ri.');}
    catch(error){result={error:String(error.message).slice(0,250)};}
    await api('/result',{commandId:command.id,result},credentials.token);
  }
  const active = new Map(); let heartbeatBusy = false;
  const delivery=await resultDelivery(stateDir,body=>api('/result',body,credentials.token),{signal:stopSignal});
  const native=await nativeMemory(stateDir);
  const heartbeat = setInterval(async () => {
    if (heartbeatBusy) return; heartbeatBusy = true;
    try {
      await api('/folders', {folders:(await localFolders(stateDir)).map(({id,label,kind})=>({id,label,kind}))}, credentials.token);
      const result = await api('/heartbeat', {capabilities:['computer_browser_v1','project_service_v1','webhook_v1','linked_folders_v1','folder_path_v1','folder_browse_v1','parallel_workspace_v1',...(antigravity?['native_command_bridge_v2','native_diagnostics_v1']:[])],localPort:bridge.port}, credentials.token);
      if(antigravity)await api('/agent-catalog',{models:agentModels},credentials.token);
      for (const commandId of result.cancelCommandIds || []) active.get(commandId)?.abort(new Error('Vazifa bekor qilindi.'));
      if(result.folderCommand)await folderCommand(result.folderCommand);
    } catch(error) { if([401,403].includes(error.status))await services.close(); }
    finally { heartbeatBusy = false; }
  }, 5000);
  const stop = () => { for (const controller of active.values()) controller.abort(new Error('Connector to‘xtatildi.')); };
  const executions=new Set();
  stopSignal?.addEventListener('abort', stop, { once: true });
  try {
    while (!stopSignal?.aborted) {
      try {
        if(executions.size>=4){await Promise.race(executions);continue;}
        await delivery.flush(new Set(active.keys()));
        const { command } = await api('/poll', {}, credentials.token);
        if (!command) { await delay(900, undefined, { signal: stopSignal }); continue; }
        if(command.tool==='link_folder_path'||command.tool==='browse_folders'){
          await folderCommand(command);continue;
        }
        if (!/^prj_[a-f0-9]{24}$/.test(command.projectId)) throw new Error('Noto‘g‘ri loyiha identifikatori.');
        const controller = new AbortController(); active.set(command.id, controller);
        const execution=(async()=>{
        let root;
        await delivery.begin(command);
        let result;
        try {
          root=await commandRoot(workspace,stateDir,command);
          if(command.tool==='parallel_workspace'){
            const {taskId,operation}=command.args;
            if(!/^par_[a-f0-9]{24}$/.test(taskId))throw Error('Parallel vazifa identifikatori noto‘g‘ri.');
            const fork=parallelWorkspace(root,path.join(stateDir,'parallel',taskId));
            if(operation==='create')result=await fork.create(controller.signal);
            else if(operation==='seed')result=await fork.seed(command.args.files);
            else if(operation==='export')result=await fork.export();
            else if(operation==='files')result=await fork.files(command.args.tool,command.args.args);
            else if(operation==='command')result=await localCommand(fork.work,command.args,controller.signal);
            else if(operation==='changes')result=await fork.changes();
            else if(operation==='apply')result=await fork.apply(controller.signal);
            else if(operation==='read')result=await fork.read(command.args.path,command.args);
            else if(operation==='resolve')result=await fork.resolve(command.args);
            else if(operation==='cleanup')result=await fork.cleanup();
            else if(operation==='native'){
              if(!antigravity||!agentModels.some(m=>m.id===command.args.model))throw Error('Parallel Antigravity modeli mavjud emas.');
              const saved=await fork.state();
              result=await cliTask(antigravity,fork.work,{...command.args,...(saved.model===command.args.model?saved:{})},controller.signal,()=>{});
              await fork.native({model:command.args.model,conversationId:result.conversationId,cumulativeUsage:result.cumulativeUsage});
              // Source files and private CLI conversation remain on this device.
              const {conversationId,cumulativeUsage,...publicResult}=result;result=publicResult;
            }else throw Error('Parallel papka amali noto‘g‘ri.');
          }
          else if(command.tool==='computer_browser')result=await browsers.command(command.args);
          else if (command.tool === 'antigravity_task') {
            if (!antigravity || !agentModels.some(m => m.id === command.args.model) || typeof command.args.prompt !== 'string' || command.args.prompt.length > 200000) throw new Error('Antigravity modeli yoki vazifasi noto‘g‘ri.');
            await mkdir(root, { recursive: true });
            const progress = progressSender(output => api('/progress', { commandId: command.id, output }, credentials.token));
            try { result = await cliTask(antigravity, root, await native.restore(command), controller.signal, output => {
              progress.push(output);
            }); } finally { await progress.flush(); }
            if(command.linked||command.sourceId){result.local=true;result.files=[];}else{
            const candidates = (await listFiles(root)).filter(file => !file.path.startsWith('inputs/'));
            const manifest = candidates.filter(file => file.size < 500000).slice(0, 150);
            result.filesTruncated = manifest.length < candidates.length;
            let total = 0; result.files = [];
            for (const file of manifest) {
              const bytes = await readFile(await safePath(root, file.path)); total += bytes.length;
              if (total > 5000000) { result.filesTruncated = true; break; }
              result.files.push({ path: file.path, base64: bytes.toString('base64') });
            }
            if (!result.response.trim() && !result.files.length && !result.filesTruncated) result.failure ||= 'Antigravity javob ham, fayl ham qaytarmadi. Vazifa bajarilgani tasdiqlanmadi.';
            }
          }
          else if(command.tool==='prepare_local_attachment')result=await bridge.prepare(root,command.args);
          else if(command.tool==='project_inspect')result=await inspectProject(root,path.basename(root));
          else if(command.tool==='preview_file'){const bytes=await readFile(await safePath(root,command.args.path));if(bytes.length>5_000_000)throw Error('Preview fayli 5 MB dan katta.');result={base64:bytes.toString('base64')};}
          else if (['search_files','rename_file','delete_file','list_files', 'read_file', 'write_file', 'append_file', 'edit_file', 'copy_file'].includes(command.tool)) result = await fileTool(root, command.tool, command.args);
          else if (command.tool === 'upload_chunk') {
            const {path:relative,offset,base64}=command.args;
            if(!relative.startsWith('inputs/att_') || !Number.isSafeInteger(offset) || offset<0 || offset>1_000_000_000 || typeof base64!=='string' || base64.length>1_000_000)throw new Error('Fayl bo‘lagi noto‘g‘ri.');
            const target=await safePath(root,relative);await mkdir(path.dirname(target),{recursive:true});
            const handle=await open(target,offset===0?'wx':'r+');
            try {const bytes=Buffer.from(base64,'base64');if(offset+bytes.length>1_000_000_000)throw new Error('Fayl 1 GB dan katta.');if((await handle.stat()).size!==offset)throw new Error('Fayl bo‘lagi tartibi noto‘g‘ri.');await handle.write(bytes,0,bytes.length,offset);result={saved:true,bytes:offset+bytes.length};}finally{await handle.close();}
          }
          else if (command.tool === 'project_service') result=await services.execute(root,command.args,controller.signal);
          else if (command.tool === 'webhook_request') result=await webhookWorker(root,command.args,controller.signal);
          else if (command.tool === 'run_command') {
            const progress = progressSender(output => api('/progress', { commandId: command.id, output }, credentials.token));
            try { result = await localCommand(root, command.args, controller.signal, text => progress.push(text)); }
            finally { await progress.flush(); }
          }
          else if (command.tool === 'publish_preview' && (command.linked||command.sourceId)) {result={published:true,local:true};}
          else if (command.tool === 'publish_preview') {
            const folder = command.args.directory || 'dist';
            const safeFolder = await safePath(root, `${folder}/index.html`);
            const base = path.dirname(safeFolder);
            const manifest = (await listFiles(base)).filter(file => file.size < 500_000).slice(0, 100);
            result = { files: await Promise.all(manifest.map(async file => ({ path: `${folder}/${file.path}`, base64: (await readFile(await safePath(base, file.path))).toString('base64') }))) };
            if (JSON.stringify(result).length > 10_000_000) throw new Error('Preview hajmi 10 MB dan oshdi.');
          } else throw new Error('Connector bu vositani qo‘llab-quvvatlamaydi.');
        } catch (error) { result = command.tool==='computer_browser'?{error:error.status===404?'Lokal brauzer yopilgan.':error.status?error.message:'Brauzer amali bajarilmadi. Ekranni yangilab qayta tekshiring.',status:error.status}: { error: String(error.message).slice(0, 600), ...(error.providerError ? {providerError:error.providerError}: {}) }; }
        await native.record(command,result);
        await delivery.deliver(command.id,result);
        })().catch(async error=>{if([401,403].includes(error.status))await services.close();if(!quiet&&!stopSignal?.aborted)console.error('OpenSI amal natijasini saqladi. Ulanish qayta tekshirilmoqda.');}).finally(()=>{active.delete(command.id);executions.delete(execution);});
        executions.add(execution);
      } catch (error) {
        if([401,403].includes(error.status))await services.close();
        if (stopSignal?.aborted) break;
        if (!quiet) console.error('OpenSI serveriga ulanish vaqtincha uzildi. Qayta ulanmoqda.');
        await delay(3000, undefined, { signal: stopSignal }).catch(() => {});
      }
    }
  } finally { clearInterval(heartbeat); stopSignal?.removeEventListener('abort', stop); stop(); await Promise.allSettled([...executions]);await bridge.close(); await services.close();await browsers.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
    if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]); return pairs;
  }, []));
  if (!args.server || !args.workspace) {
    console.log('node connector/index.mjs --server https://opensi.example --code ULANISH_KODI --workspace "D:\\OpenSI Projects"');
    process.exit(1);
  }
  const stop = new AbortController();
  process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
  startConnector({ ...args, stateDir: args['state-dir'], pairOnly:args['pair-only']==='true', signal: stop.signal }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
