import {personalRoutes,personalState,savePersonal} from './personal.mjs';
import {publishingService} from './publishing.mjs';
import {localAttachments} from './local-attachments.mjs';
import {visibleProviders} from './model-access.mjs';
import {linkedProject,linkProject} from './project-links.mjs';
import {previewSource} from './preview-source.mjs';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import path from 'node:path';
import os from 'node:os';
import { existsSync } from 'node:fs';
import { readFile, lstat, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { makeConfig, rootDir } from './config.mjs';
import { createVault, HttpError, id, now, validateUrl, redact } from './security.mjs';
import { openStore } from './storage.mjs';
import { authService } from './auth.mjs';
import { chatgptService } from './chatgpt.mjs';
import {zcodeService} from './zcode.mjs';
import { nodeService } from './nodes.mjs';
import { createRunner } from './runner.mjs';
import { agentsFor } from './agents.mjs';
import { discoverModels, complete } from './provider.mjs';
import { connectMcp } from './mcp.mjs';
import { projectRoot, listFiles, fileTool, safePath } from './files.mjs';
import { cloudAvailable, browserTest } from './commands.mjs';
import { captureVersions, lineDiff } from './versions.mjs';
import { Readable } from 'node:stream';
import {pipeline} from 'node:stream/promises';
import { projectZipStream,projectZip } from './archive.mjs';
import {libraryService,libraryRoutes} from './library.mjs';
import {skillService} from './skills.mjs';
import {flowService} from './flows.mjs';
import {mediaService} from './media.mjs';
import {videoAccountPreferenceRoutes} from './video-account-preferences.mjs';
import {videoStitchService} from './video-stitch.mjs';
import {videoStoryService} from './video-story.mjs';
import {creativeService} from './creative.mjs';
import {documentService} from './documents.mjs';
import {automationService} from './automation.mjs';
import {autoProvider} from './orchestration.mjs';
import {textModel} from './creative-catalog.mjs';
import {studioTools} from './studio-tools.mjs';
import {computerService} from './computer.mjs';
import {dashboardRoutes} from './dashboard.mjs';
import {jevService} from './jev.mjs';
import {executionService} from './execution.mjs';
import {attachmentService,uploadLimits} from './attachments.mjs';
import {projectImportRoutes} from './project-import.mjs';
import {taskCatalog} from './task-catalog.mjs';
import {dotBridge} from './dot-bridge.mjs';

const providerSchema = z.object({ label: z.string().trim().min(1).max(80), baseUrl: z.string().min(1).max(2000),
  apiKey: z.string().max(8000).optional(), models: z.array(z.string().min(1).max(200)).max(300).optional(), protocol: z.enum(['chat-completions','responses','gemini-image','anthropic-messages']).optional(), enabled: z.boolean().optional() });
const terminal = ['completed', 'failed', 'cancelled', 'interrupted'];
const parse = (schema, value) => { const result = schema.safeParse(value); if (!result.success) throw new HttpError(400, result.error.issues.map(item => `${item.path.join('.')}: ${item.message}`).join('; ').slice(0, 700)); return result.data; };
const providerPublic = row => ({ id: row.id, label: row.label, base_url: row.base_url, models: JSON.parse(row.models),
  protocol: row.protocol, has_key: Boolean(row.secret), enabled: Boolean(row.enabled), verified_at: row.verified_at, tested_at: row.tested_at });
const mcpPublic = row => ({ id: row.id, label: row.label, url: row.url, has_key: Boolean(row.secret), tools: JSON.parse(row.tools), enabled: Boolean(row.enabled) });

export function createApp(overrides = {}) {
  const config = makeConfig(overrides); const vault = createVault(config); const store = openStore(config, vault);
  const auth = authService(config, store, vault); const nodes = nodeService(config, store);
  const chatgpt = chatgptService(config, store, vault);const zcode=zcodeService(config,store); const runner = createRunner(config, store, vault, nodes, chatgpt,zcode);
  const execution=executionService(store);const library=libraryService(store,config);
  const skills=skillService(store);runner.attachSkills(skills);
  const attachmentsService=attachmentService({store,config,library,nodes});
  const jev=jevService({config,store});runner.attachExtensions({execution,attachmentsService,jev});
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:', 'blob:'], mediaSrc: ["'self'", 'blob:'], connectSrc: ["'self'", 'http://127.0.0.1:*'], frameSrc: ["'self'", 'blob:'],
    objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], upgradeInsecureRequests: null,
  } }, strictTransportSecurity: config.production ? undefined : false, crossOriginEmbedderPolicy: false }));
  let webhookReceiver;
  app.post('/api/webhooks/telegram/:sessionId',rateLimit({windowMs:60000,limit:2000,standardHeaders:'draft-8',legacyHeaders:false}),express.json({limit:'128kb'}),(req,res,next)=>webhookReceiver?Promise.resolve(webhookReceiver(req,res)).catch(next):res.sendStatus(503));
  app.use('/mcp',express.json({limit:'128kb'}));
  app.use(express.json({ limit: '16mb' })); app.use(cookieParser());
  // Validate identity before choosing a bucket: users sharing Wi-Fi do not share a quota.
  app.use('/api', (req, _res, next) => {
    req.rateUser = auth.user(req);
    if (req.path.startsWith('/connector/') && req.path !== '/connector/pair') {
      try { req.rateNode = nodes.authenticate(req).id; } catch { /* Invalid tokens use the anonymous bucket. */ }
    }
    next();
  });
  app.use('/api', rateLimit({ windowMs: 15 * 60_000, limit: 4000, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => req.rateNode ? `node:${req.rateNode}` : req.rateUser ? `user:${req.rateUser.id}` : `ip:${ipKeyGenerator(req.ip)}`,
    message: { error: 'So‘rovlar chegarasiga yetildi. Birozdan keyin qayta urinib ko‘ring.' } }));
  const computer=computerService(app,{store,config,parse,nodes});
  runner.attachComputer(computer);
  app.get('/api/health', (_req, res) => res.json({ ok: true, name: 'OpenSI', version: '0.8.0' }));
  app.get('/api/ready', async(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(!config.runnerUrl||!config.runnerToken)return res.status(503).json({ok:false,terminal:false,documents:false});
    try{
      const response=await fetch(config.runnerUrl+'/health',{headers:{authorization:`Bearer ${config.runnerToken}`},signal:AbortSignal.timeout(5000)});
      const runner=response.ok?await response.json():{};
      const terminal=runner.ok===true&&runner.runtimeReady===true,documents=runner.ok===true&&runner.documentsReady===true;
      return res.status(terminal&&documents?200:503).json({ok:terminal&&documents,terminal,documents});
    }catch{return res.status(503).json({ok:false,terminal:false,documents:false});}
  });
  app.get('/api/auth/config', (_req, res) => res.json(auth.publicConfig()));
  app.get('/api/auth/google', (req, res) => auth.begin(req, res));
  app.get('/api/auth/google/callback', (req, res) => auth.callback(req, res));
  // Native loopback helper uses single-use bearer tickets, never browser cookies.
  const bridgeTicket = req => { if (req.get('origin')) throw new HttpError(403, 'Faqat OpenSI ulash yordamchisi uchun.'); const value = req.get('authorization') || ''; if (!/^Bearer [A-Za-z0-9_-]{43}$/.test(value)) throw new HttpError(401, 'Ulash kodi kerak.'); return value.slice(7); };
  app.post('/api/chatgpt/bridge/start', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(chatgpt.start(bridgeTicket(req))); });
  app.post('/api/chatgpt/bridge/finish', async (req, res) => {
    const ticket = bridgeTicket(req);
    const value = parse(z.object({ clientId: z.string().max(200), tokens: z.object({ access_token: z.string().min(1).max(20000), refresh_token: z.string().min(1).max(20000), id_token: z.string().min(1).max(20000), token_type: z.string().max(20), expires_in: z.number().positive().max(86400 * 30), scope: z.string().max(2000) }) }), req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await chatgpt.finish(ticket, value.clientId, value.tokens));
  });
  localAttachments({app,store,nodes});
  app.post('/api/connector/pair', (req, res) => res.json(nodes.pair(parse(z.object({ code: z.string().min(16).max(100),
    name: z.string().min(1).max(120), platform: z.string().max(30), workspace: z.string().max(120) }), req.body))));
  app.post('/api/connector/folders',(req,res)=>res.json(nodes.folders(nodes.authenticate(req),req.body?.folders)));
  app.post('/api/connector/heartbeat', (req, res) => res.json(nodes.heartbeat(nodes.authenticate(req),req.body?.capabilities,req.body?.localPort)));
  app.post('/api/connector/agent-catalog', (req, res) => {
    const node = nodes.authenticate(req);
    const value = parse(z.object({ models: z.array(z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,119}$/), label: z.string().min(1).max(150) })).max(100) }), req.body);
    res.json(nodes.agentCatalog(node, value.models));
  });
  app.post('/api/connector/poll', (req, res) => res.json(nodes.poll(nodes.authenticate(req))));
  app.post('/api/connector/result', (req, res) => {
    const value = parse(z.object({ commandId: z.string().max(80), result: z.record(z.string(), z.unknown()) }), req.body);
    res.json(nodes.result(nodes.authenticate(req), value.commandId, value.result));
  });
  app.post('/api/connector/progress', (req, res) => {
    const node = nodes.authenticate(req);
    const value = parse(z.object({ commandId: z.string().max(80), output: z.string().max(16384) }), req.body);
    res.json(nodes.progress(node, value.commandId, value.output));
  });

  // Preview tokens can only read non-hidden files of one project for fifteen minutes.
  const publishing=publishingService({store,config,nodes});
  publishing.publicRoutes(app);
  app.get('/api/previews/:grant/*file', async (req, res) => {
    const [payload, signature] = req.params.grant.split('.');
    if (!vault.verify(payload, signature)) throw new HttpError(403, 'Preview manzili noto‘g‘ri.');
    let grant;
    try { grant = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new HttpError(403, 'Preview manzili noto‘g‘ri.'); }
    if (grant.expires < Date.now()) throw new HttpError(403, 'Preview muddati tugadi. Previewni yangilang.');
    const project = store.one('SELECT * FROM projects WHERE id=?', grant.project);
    if (!project || store.one('SELECT disabled FROM users WHERE id=?', project.user_id)?.disabled) throw new HttpError(404, 'Preview topilmadi.');
    const name = Array.isArray(req.params.file) ? req.params.file.join('/') : req.params.file;
    const file = await safePath(projectRoot(config, project), name);
    const remote=linkedProject(store,project)?await nodes.dispatch(project,null,'preview_file',{path:name}):null;
    const stat = remote?null:await lstat(file);
    if (!remote&&(!stat.isFile() || stat.size > 5_000_000)) throw new HttpError(400, 'Preview fayli juda katta.');
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; base-uri 'self'; sandbox allow-scripts allow-downloads");
    const extension=path.extname(name).toLowerCase();
    if(['.html','.htm','.js','.mjs','.css'].includes(extension)){
      const base='/api/previews/'+req.params.grant+'/'+(name.startsWith('dist/')?'dist/':'');
      return res.type(extension).send(previewSource(remote?Buffer.from(remote.base64,'base64').toString('utf8'):await readFile(file,'utf8'),extension,base));
    }
    if(remote)return res.type(extension).send(Buffer.from(remote.base64,'base64'));
    res.sendFile(file);
  });

  app.use('/api', (req, res, next) => auth.requireUser(req, res, next));
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.get('x-opensi-client') !== 'web') return next(new HttpError(403, 'So‘rov manbasi tasdiqlanmadi.'));
      const origin = req.get('origin');
      if (origin && origin !== new URL(config.appUrl).origin) return next(new HttpError(403, 'Begona saytdan so‘rov rad etildi.'));
    }
    next();
  });
  personalRoutes(app,store,parse,z);
  videoAccountPreferenceRoutes(app,store,parse,z);
  const admin = (req, res, next) => auth.requireAdmin(req, res, next);
  skills.routes(app,parse);skills.start();
  const projectFor = req => { const project = store.project(req.user.id, req.params.projectId); if (!project) throw new HttpError(404, 'Loyiha topilmadi.'); return project; };
  publishing.privateRoutes(app,projectFor);
  const runFor = req => { const run = store.one('SELECT * FROM runs WHERE id=? AND user_id=? AND deleted_at IS NULL', req.params.runId, req.user.id); if (!run) throw new HttpError(404, 'Vazifa topilmadi.'); return run; };
  const recoveringDrafts = new Set();
  const projectLocks = new Set();
  const ensureIdle = project => {
    if (projectLocks.has(project.id) || store.one("SELECT id FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_approval','waiting_input')", project.id)) throw new HttpError(409, 'Loyihada amal bajarilmoqda. Tugashini kuting.');
  };
  const editProject = async (project, operation) => {
    ensureIdle(project); projectLocks.add(project.id);
    try { return await operation(); } finally { projectLocks.delete(project.id); }
  };
  const usageFor = runId => store.one('SELECT COALESCE(SUM(input_tokens),0) AS input,COALESCE(SUM(output_tokens),0) AS output,COALESCE(SUM(known=0),0) AS unknown FROM usage WHERE run_id=?', runId);

  app.get('/api/me', (req, res) => res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role,
    local: req.user.local, token_limit: req.user.token_limit }, auth: auth.publicConfig(), capabilities: { cloudShell: cloudAvailable(config), localConnector: true } }));
  app.post('/api/auth/logout', (req, res) => auth.logout(req, res));
  app.get('/api/providers',(req,res)=>{const values=visibleProviders(store,config,req.user.id,[...store.all('SELECT * FROM providers ORDER BY created_at').map(providerPublic),...chatgpt.list(req.user.id),...nodes.providers(req.user.id),...zcode.list(req.user.id)]);res.json([...(values.some(p=>p.enabled&&p.models.some(m=>textModel(p,m)))?[autoProvider]:[]),...values]);});
  app.get('/api/zcode/account',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(zcode.status(req.user.id));});
  app.post('/api/zcode/connect',admin,async(req,res)=>{const value=parse(z.object({shared:z.boolean().default(true)}),req.body);res.setHeader('Cache-Control','no-store');res.json(await zcode.connect(req.user.id,value));});
  app.post('/api/zcode/models',admin,async(req,res)=>res.json(await zcode.refresh(req.user.id)));
  app.patch('/api/zcode/sharing',admin,(req,res)=>{const value=parse(z.object({shared:z.boolean()}),req.body);res.json(zcode.share(req.user.id,value.shared));});
  app.post('/api/zcode/disconnect',admin,async(req,res)=>res.json(await zcode.disconnect(req.user.id)));
  app.post('/api/zcode/test',admin,async(req,res)=>{const value=parse(z.object({model:z.string().min(1).max(200)}),req.body);res.json(await zcode.test(req.user.id,value.model));});
  app.get('/api/chatgpt/accounts', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json(chatgpt.list(req.user.id)); });
  app.patch('/api/chatgpt/:accountId/sharing', admin, (req, res) => {
    const value = parse(z.object({ shared: z.boolean() }), req.body);
    res.json(chatgpt.share(req.user.id, req.params.accountId, value.shared));
  });
  app.post('/api/chatgpt/connect', (req, res) => { const value = parse(z.object({ accountId: z.string().max(80).optional() }), req.body); res.setHeader('Cache-Control', 'no-store'); res.json(chatgpt.begin(req.user.id, value.accountId)); });
  app.post('/api/chatgpt/:accountId/models', async (req, res) => res.json(await chatgpt.refreshModels(req.user.id, req.params.accountId)));
  app.post('/api/chatgpt/:accountId/disconnect', async (req, res) => res.json(await chatgpt.disconnect(req.user.id, req.params.accountId)));
  app.post('/api/chatgpt/:accountId/test', async (req, res) => {
    const value = parse(z.object({ model: z.string().min(1).max(200) }), req.body);
    const provider = chatgpt.provider(req.user.id, req.params.accountId, value.model);
    const used = store.one("SELECT COALESCE(SUM(input_tokens+output_tokens),0) AS total FROM usage WHERE user_id=? AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now')", req.user.id).total;
    if (req.user.token_limit !== -1 && used >= req.user.token_limit) throw new HttpError(429, 'Oylik token chegarasiga yetildi. Administrator limitni yangilashi mumkin.');
    if(provider.protocol==='gemini-image'){const models=await discoverModels(provider,config);if(!models.includes(value.model))throw new HttpError(400,'Bu model Google ro‘yxatida topilmadi.');return res.json({ok:true,message:'Google model ro‘yxati tekshirildi. Rasm yoki video yaratishni Media studiyada sinang.',model:value.model});}
    const reply = await complete({ provider, model: value.model, messages: [{ role: 'user', content: 'Reply with OPENSI_CONNECTED only.' }], config,
      onUsage: usage => store.usage({ id: null, user_id: req.user.id }, provider, value.model, 'connection_test', usage) });
    res.json({ ok: true, message: reply.content, model: value.model });
  });
  async function saveProvider(req, res) {
    const value = parse(providerSchema, req.body);
    const existing = req.params.providerId ? store.one('SELECT * FROM providers WHERE id=?', req.params.providerId) : null;
    if (req.params.providerId && !existing) throw new HttpError(404, 'Provider topilmadi.');
    const baseUrl = await validateUrl(value.baseUrl, { allowLocal: config.localAuth });
    if (existing && (existing.base_url !== baseUrl || existing.protocol !== (value.protocol || existing.protocol)) && value.apiKey === undefined && existing.secret) throw new HttpError(400, 'Yangi manzil yoki protokol uchun API kalitini qayta kiriting.');
    const key = value.apiKey === undefined ? vault.decrypt(existing?.secret || '') : value.apiKey;
    if (/^vcp_/i.test(key)) throw new HttpError(400, 'Bu Vercel shaxsiy access tokeni. Claude uchun Anthropic API kaliti yoki Vercel AI Gateway API kaliti kerak.');
    if ((value.protocol || existing?.protocol) === 'anthropic-messages' && !key) throw new HttpError(400, 'Claude API kalitini kiriting.');
    if ((value.protocol || existing?.protocol) === 'gemini-image' && !key) throw new HttpError(400, 'Google Gemini media API kalitini kiriting.');
    const models = value.models?.length ? [...new Set(value.models)] : await discoverModels({ base_url: baseUrl, key, protocol:value.protocol||existing?.protocol }, config);
    const providerId = existing?.id || id('p_');
    store.exec('INSERT INTO providers(id,label,base_url,secret,models,protocol,enabled,verified_at,tested_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,base_url=excluded.base_url,secret=excluded.secret,models=excluded.models,protocol=excluded.protocol,enabled=excluded.enabled,verified_at=excluded.verified_at,tested_at=NULL',
      providerId, value.label, baseUrl, vault.encrypt(key), JSON.stringify(models), value.protocol || existing?.protocol || 'chat-completions', value.enabled === false ? 0 : 1, value.models?.length ? null : now(), null, existing?.created_at || now());
    res.json(providerPublic(store.one('SELECT * FROM providers WHERE id=?', providerId)));
  }
  app.post('/api/providers', admin, saveProvider); app.put('/api/providers/:providerId', admin, saveProvider);
  app.post('/api/providers/:providerId/test', admin, async (req, res) => {
    const value = parse(z.object({ model: z.string().min(1).max(200) }), req.body);
    const provider = runner.providerFor(req.params.providerId, value.model, req.user.id);
    if(provider.protocol==='gemini-image'){const models=await discoverModels(provider,config);if(!models.includes(value.model))throw new HttpError(400,'Bu model Google ro‘yxatida topilmadi.');store.exec('UPDATE providers SET tested_at=? WHERE id=?',now(),provider.id);return res.json({ok:true,message:'Google model ro‘yxati tekshirildi. Media studiyada haqiqiy natijani sinang.',model:value.model});}
    const reply = await complete({ provider, model: value.model, messages: [{ role: 'user', content: 'Reply with OPENSI_CONNECTED only.' }], config,
      onUsage: usage => store.usage({ id: null, user_id: req.user.id }, provider, value.model, 'connection_test', usage) });
    store.exec('UPDATE providers SET tested_at=? WHERE id=?', now(), provider.id);
    res.json({ ok: true, message: redact(reply.content, [provider.key]), model: value.model });
  });
  app.patch('/api/providers/:providerId', admin, (req, res) => {
    const value = parse(z.object({ enabled: z.boolean() }), req.body);
    const result = store.exec('UPDATE providers SET enabled=? WHERE id=?', value.enabled ? 1 : 0, req.params.providerId);
    if (!result.changes) throw new HttpError(404, 'Provider topilmadi.'); res.json({ ok: true });
  });
  app.get('/api/mcp', (req, res) => res.json(store.all('SELECT * FROM mcp_connections WHERE user_id=? ORDER BY created_at', req.user.id).map(mcpPublic)));
  app.post('/api/mcp', admin, async (req, res) => {
    const value = parse(z.object({ label: z.string().trim().min(1).max(80), url: z.string().max(2000), token: z.string().max(8000).optional() }), req.body);
    const connection = { id: id('mcp_'), label: value.label, url: await validateUrl(value.url, { allowLocal: config.localAuth }), secret: vault.encrypt(value.token || '') };
    const client = await connectMcp(connection, config, vault);
    const tools = client.tools.map(tool => ({ name: tool.name, description: tool.description || '' }));
    await client.close();
    store.exec('INSERT INTO mcp_connections(id,label,url,secret,tools,created_at,user_id) VALUES(?,?,?,?,?,?,?)', connection.id, connection.label, connection.url, connection.secret, JSON.stringify(tools), now(), req.user.id);
    res.json(mcpPublic(store.one('SELECT * FROM mcp_connections WHERE id=?', connection.id)));
  });
  app.patch('/api/mcp/:connectionId', admin, (req, res) => {
    const value = parse(z.object({ enabled: z.boolean() }), req.body);
    const result = store.exec('UPDATE mcp_connections SET enabled=? WHERE id=? AND user_id=?', value.enabled ? 1 : 0, req.params.connectionId, req.user.id);
    if (!result.changes) throw new HttpError(404, 'Ulanish topilmadi.'); res.json({ ok: true });
  });
  app.get('/api/nodes', (req, res) => res.json(nodes.list(req.user.id)));
  localAttachments({app,store,nodes,authenticated:true});
  const installers=new Map();
  app.get('/api/nodes/installer/windows/download/:key',(req,res)=>{const entry=installers.get(req.params.key);if(!entry||entry.userId!==req.user.id||entry.expires<Date.now())throw new HttpError(404,'O‘rnatgich muddati tugadi. Yangi fayl oling.');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Disposition','attachment; filename=OpenSI-Kompyuterga-Ulash.zip');res.type('application/zip').send(entry.bytes);});
  app.post('/api/nodes/installer/windows',async(req,res)=>{
    const {code}=nodes.pairCode(req.user),server=config.appUrl,profile=req.user.id;
    const quoted=value=>"'"+value.replaceAll("'","''")+"'";
    const script=`$ErrorActionPreference='Stop'; $p=Join-Path $env:TEMP 'OpenSI-Install.ps1'; Invoke-WebRequest ${quoted(server+'/downloads/Install-Windows.ps1')} -OutFile $p -UseBasicParsing; & $p -Server ${quoted(server)} -Code ${quoted(code)} -Profile ${quoted(profile)}`;
    const temporary=await mkdtemp(path.join(os.tmpdir(),'opensi-installer-'));let bytes;
    try{await writeFile(path.join(temporary,'OpenSI-Ulash.cmd'),'@echo off\r\npowershell.exe -NoProfile -STA -ExecutionPolicy Bypass -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')+'\r\npause\r\n');await writeFile(path.join(temporary,'README.txt'),'ZIPni oching. OpenSI-Ulash.cmd ni 10 daqiqa ichida ishga tushiring va loyiha papkasini tanlang. Node.js avtomatik tayyorlanadi. Bu fayl faqat sizning OpenSI hisobingiz uchun.');bytes=await projectZip(temporary);}finally{if(path.dirname(temporary)===path.resolve(os.tmpdir())&&path.basename(temporary).startsWith('opensi-installer-'))await rm(temporary,{recursive:true,force:true});}
    for(const [key,entry] of installers)if(entry.expires<Date.now()||entry.userId===req.user.id)installers.delete(key);
    if(installers.size>=300)throw new HttpError(429,'O‘rnatgich band. Keyinroq urinib ko‘ring.');const key=id('installer_');installers.set(key,{bytes,userId:req.user.id,expires:Date.now()+600000});
    res.setHeader('Cache-Control','no-store');res.json({filename:'OpenSI-Kompyuterga-Ulash.zip',url:'/api/nodes/installer/windows/download/'+key});
  });
  app.post('/api/nodes/pair-code', (req, res) => res.json({ ...nodes.pairCode(req.user), server: config.production ? config.appUrl : `http://127.0.0.1:${config.port}` }));
  app.post('/api/nodes/:nodeId/revoke', (req, res) => {
    const result = store.exec('UPDATE nodes SET revoked=1 WHERE id=? AND user_id=?', req.params.nodeId, req.user.id);
    if (!result.changes) throw new HttpError(404, 'Connector topilmadi.');
    for (const run of store.all("SELECT id FROM runs WHERE node_id=? AND user_id=? AND status IN ('queued','running','waiting_approval','waiting_input')", req.params.nodeId, req.user.id)) runner.cancel(req.user.id, run.id);
    res.json({ ok: true });
  });
  app.get('/api/agents', (req, res) => res.json(agentsFor(store, req.user.id)));
  app.post('/api/agents', (req, res) => {
    const value = parse(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300), prompt: z.string().trim().min(1).max(12000),
      tools: z.array(z.enum(['list_files','read_file','write_file','run_command','http_get','ask_user','delegate_agent','mcp'])).max(8),
      provider_id: z.string().optional(), model: z.string().max(200).optional() }), req.body);
    if (value.provider_id || value.model) runner.providerFor(value.provider_id, value.model, req.user.id);
    const agentId = id('agent_');
    store.exec('INSERT INTO agents VALUES(?,?,?,?,?,?,?,?,?)', agentId, req.user.id, value.name, value.description, value.prompt, JSON.stringify(value.tools), value.provider_id || null, value.model || null, now());
    res.json(agentsFor(store, req.user.id).find(agent => agent.id === agentId));
  });
  store.db.exec('CREATE TABLE IF NOT EXISTS project_context(project_id TEXT PRIMARY KEY REFERENCES projects(id),instructions TEXT NOT NULL,memory TEXT NOT NULL)');
  app.get('/api/projects/:projectId/context',(req,res)=>{const p=projectFor(req);res.json(store.one('SELECT instructions,memory FROM project_context WHERE project_id=?',p.id)||{instructions:'',memory:''});});
  app.get('/api/projects/:projectId/latest-run',(req,res)=>{const p=projectFor(req);const run=store.one('SELECT id FROM runs WHERE project_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1',p.id,req.user.id);if(!run)throw new HttpError(404,'Loyiha tarixi topilmadi. Papkani qayta oching.');res.json(run);});
  app.put('/api/projects/:projectId/context',async(req,res)=>{const p=projectFor(req);const v=parse(z.object({title:z.string().trim().min(1).max(100),instructions:z.string().max(12000),memory:z.string().max(12000)}),req.body);await editProject(p,async()=>{store.exec('INSERT INTO project_context VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET instructions=excluded.instructions,memory=excluded.memory',p.id,v.instructions,v.memory);store.exec('UPDATE projects SET title=?,updated_at=? WHERE id=?',v.title,now(),p.id);});res.json({ok:true});});
  app.get('/api/projects', (req, res) => res.json(store.all('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC', req.user.id)));
  app.post('/api/projects/link',(req,res)=>res.status(201).json(linkProject(store,nodes,req.user.id,req.body||{})));
  app.post('/api/projects/browse-folders',async(req,res)=>{
    const value=parse(z.object({nodeId:z.string().max(80),path:z.string().max(2000).default(''),offset:z.number().int().min(0).max(100000).default(0)}),req.body);
    res.json(await nodes.browseFolders(req.user.id,value.nodeId,{path:value.path,offset:value.offset}));
  });
  app.post('/api/projects/link-path',async(req,res)=>{
    const value=parse(z.object({path:z.string().trim().min(1).max(2000),nodeId:z.string().max(80).optional(),title:z.string().max(100).optional(),notes:z.string().max(12000).optional()}),req.body);
    const {nodeId,folder}=await nodes.linkFolderPath(req.user.id,value.nodeId,value.path);
    res.status(201).json(linkProject(store,nodes,req.user.id,{nodeId,sourceId:folder.id,title:value.title?.trim()||folder.label.slice(0,100),notes:value.notes}));
  });
  projectImportRoutes(app,{store,config,library,projectFor,parse,nodes});
  app.patch('/api/projects/:projectId', (req, res) => {
    const project = projectFor(req); const { title } = parse(z.object({ title: z.string().trim().min(1).max(120) }), req.body);
    store.exec('UPDATE projects SET title=?,updated_at=? WHERE id=?', title, now(), project.id); res.json({ ok: true });
  });
  app.get('/api/projects/:projectId/files', async (req, res) => {
    const project = projectFor(req);
    if (project.environment === 'local') {
      const result = await nodes.dispatch(project, null, 'list_files', {}, undefined); return res.json({ ...result, source: 'local' });
    }
    res.json({ files: await listFiles(projectRoot(config, project)), source: project.environment === 'local' ? 'cached' : 'cloud' });
  });
  app.get('/api/projects/:projectId/file', async (req, res) => {
    const project = projectFor(req); const name = parse(z.string().max(240), req.query.path);
    let result;
    if (project.environment === 'local') {
      result = await nodes.dispatch(project, null, 'read_file', { path: name }, undefined);
      if (!linkedProject(store,project)&&typeof result.content === 'string') await fileTool(projectRoot(config, project), 'write_file', { path: name, content: result.content });
    } else result = await fileTool(projectRoot(config, project), 'read_file', { path: name });
    res.json(result);
  });
  app.put('/api/projects/:projectId/file', async (req, res) => {
    const project = projectFor(req); const args = parse(z.object({ path: z.string().max(240), content: z.string().max(500000) }), req.body);
    res.json(await editProject(project, async () => {
      if(linkedProject(store,project))return nodes.dispatch(project,null,'write_file',args);
      const root = projectRoot(config,project); await captureVersions(store,root,project,null,'Qo‘lda tahrirdan oldin');
      if (project.environment === 'local') await nodes.dispatch(project, null, 'write_file', args, undefined);
      const result = await fileTool(root, 'write_file', args); await captureVersions(store,root,project,null,'Qo‘lda saqlash'); return result;
    }));
  });
  app.get('/api/projects/:projectId/export', async (req,res) => {
    const project = projectFor(req);
    if (project.environment === 'local') throw new HttpError(409,'Lokal loyihani connector joylashgan kompyuterdan eksport qiling.');
    await editProject(project,async()=>{res.setHeader('Content-Disposition',`attachment; filename="OpenSI-${project.id}.zip"`);res.type('application/zip');await pipeline(Readable.from(projectZipStream(projectRoot(config,project))),res);});
  });
  app.get('/api/projects/:projectId/download-manifest',async(req,res)=>{const p=projectFor(req);if(p.environment!=='cloud')throw new HttpError(409,'Lokal fayllar connector papkasida saqlanadi.');const files=await editProject(p,()=>listFiles(projectRoot(config,p),{maxFiles:5000,strict:true}));if(files.reduce((n,f)=>n+f.size,0)>2_000_000_000)throw new HttpError(413,'Natija 2 GB dan oshdi.');res.json({files});});
  app.get('/api/projects/:projectId/download-file',async(req,res)=>{const p=projectFor(req);const name=parse(z.string().max(240),req.query.path);const file=await safePath(projectRoot(config,p),name);const st=await lstat(file);if(!st.isFile()||st.size>1_000_000_000)throw new HttpError(413,'Fayl 1 GB dan katta.');res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(name))}`);res.type('application/octet-stream').sendFile(file);});
  app.get('/api/projects/:projectId/versions', (req,res) => {
    const project = projectFor(req);
    res.json(store.all('SELECT id,path,run_id,label,created_at,length(CAST(content AS BLOB)) AS bytes FROM file_versions WHERE project_id=? ORDER BY id DESC LIMIT 300',project.id));
  });
  app.get('/api/projects/:projectId/versions/:versionId', async (req,res) => {
    const project = projectFor(req); const version = store.one('SELECT * FROM file_versions WHERE project_id=? AND id=?',project.id,Number(req.params.versionId));
    if (!version) throw new HttpError(404,'Versiya topilmadi.');
    let current=''; try { current=(await fileTool(projectRoot(config,project),'read_file',{path:version.path})).content; } catch(error) { if(error.code !== 'ENOENT') throw error; }
    res.json({version,diff:lineDiff(version.content,current)});
  });
  app.post('/api/projects/:projectId/versions/:versionId/restore', async (req,res) => {
    const project = projectFor(req);
    if (project.environment === 'local') throw new HttpError(409,'Versiyani tiklash hozir bulut loyihalari uchun mavjud.');
    const version = store.one('SELECT * FROM file_versions WHERE project_id=? AND id=?',project.id,Number(req.params.versionId));
    if (!version) throw new HttpError(404,'Versiya topilmadi.');
    res.json(await editProject(project,async()=>{
      const root=projectRoot(config,project); await captureVersions(store,root,project,null,'Tiklashdan oldin');
      const result=await fileTool(root,'write_file',{path:version.path,content:version.content}); await captureVersions(store,root,project,null,'Oldingi versiya tiklandi'); return result;
    }));
  });
  app.post('/api/projects/:projectId/browser-test', async (req,res) => {
    const project=projectFor(req); if(project.environment !== 'cloud') throw new HttpError(409,'Bu tekshiruv bulut loyihalari uchun.');
    const args=parse(z.object({mobile:z.boolean().optional()}),req.body); const controller=new AbortController();
    res.on('close',()=>controller.abort());
    const result=await editProject(project,()=>browserTest(config,projectRoot(config,project),args,controller.signal));
    store.exec('INSERT INTO browser_reports(project_id,data,created_at) VALUES(?,?,?)',project.id,JSON.stringify(result),now());
    res.json(result);
  });
  app.get('/api/projects/:projectId/browser-tests',(req,res)=>{
    const project=projectFor(req);
    res.json(store.all('SELECT id,data,created_at FROM browser_reports WHERE project_id=? ORDER BY id DESC LIMIT 20',project.id).map(row=>({...JSON.parse(row.data),id:row.id,created_at:row.created_at})));
  });
  app.get('/api/projects/:projectId/artifact', async (req,res)=>{
    const project=projectFor(req); const name=parse(z.string().regex(/^artifacts\/browser-[a-f0-9-]+\.png$/),req.query.path);
    const file=await safePath(projectRoot(config,project),name); const stat=await lstat(file);
    if(!stat.isFile() || stat.size>5000000) throw new HttpError(400,'Rasm hajmi noto‘g‘ri.');
    res.setHeader('Cache-Control','no-store'); res.type('png').sendFile(file);
  });
  app.get('/api/projects/:projectId/preview', async (req, res) => {
    const project = projectFor(req); const files = linkedProject(store,project)?(await nodes.dispatch(project,null,'list_files',{limit:500})).files:await listFiles(projectRoot(config, project));
    const entry = files.find(file => file.path === 'dist/index.html') || files.find(file => file.path === 'index.html');
    if (!entry) return res.json({ url: null, message: 'Preview uchun index.html yoki dist/index.html kerak.' });
    const payload = Buffer.from(JSON.stringify({ project: project.id, expires: Date.now() + 15 * 60_000 })).toString('base64url');
    res.json({ url: `/api/previews/${payload}.${vault.sign(payload)}/${entry.path}`, entry: entry.path, cached: project.environment === 'local'&&!linkedProject(store,project) });
  });
  app.post('/api/attachments', (req, res) => {
    const value = parse(z.object({ name: z.string().min(1).max(160), mime: z.string().max(100), content: z.string().max(7_000_000) }), req.body);
    const image = ['image/png', 'image/jpeg', 'image/webp'].includes(value.mime);
    if (image) {
      const bytes = Buffer.from(value.content, 'base64');
      if (!bytes.length || bytes.length > 5_000_000) throw new HttpError(400, 'Rasm hajmi 5 MB dan oshmasligi kerak.');
      const valid = value.mime === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : value.mime === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
      if (!valid) throw new HttpError(400, 'Rasm formati mos emas.');
    } else if (value.content.length > 100000 || value.content.includes('\0') || !/\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|py|log|xml|yaml|yml|sql)$/i.test(value.name)) throw new HttpError(400, 'Hozir matn, kod, CSV yoki PNG/JPEG/WebP faylini biriktirish mumkin.');
    const attachmentId = id('att_');
    store.exec('INSERT INTO attachments VALUES(?,?,?,?,?,?)', attachmentId, req.user.id, value.name, value.mime, value.content, now());
    res.json({ id: attachmentId, name: value.name, mime: value.mime });
  });
  app.get('/api/runs', (req, res) => res.json(store.all('SELECT r.*,p.title AS project_title FROM runs r JOIN projects p ON p.id=r.project_id WHERE r.user_id=? AND r.deleted_at IS NULL ORDER BY r.created_at DESC LIMIT 200', req.user.id).map(run => ({ ...run, usage: usageFor(run.id) }))));
  app.get('/api/runs/catalog', (req, res) => {
    const query = parse(z.object({
      category: z.enum(['all','working','waiting','completed','issues','cancelled']).default('all'),
      q: z.string().trim().max(120).default(''),
      projectId: z.string().max(100).default(''),
      environment: z.enum(['all','cloud','local']).default('all'),
      sort: z.enum(['newest','oldest']).default('newest'),
      limit: z.coerce.number().int().min(1).max(100).default(40),
      cursor: z.string().max(512).default(''),
    }), req.query);
    if (query.projectId && !store.project(req.user.id, query.projectId)) throw new HttpError(404, 'Loyiha topilmadi.');
    res.json(taskCatalog(store, req.user.id, query));
  });
  function createTask(user, body, prepare) {
    const value = parse(z.object({ prompt: z.string().trim().min(1).max(30000), providerId: z.string().min(1).max(80), model: z.string().min(1).max(200),
      agentId: z.string().max(80), environment: z.enum(['cloud','local']), nodeId: z.string().nullable().optional(), projectId: z.string().nullable().optional(),
      personal:z.boolean().optional(),autonomy:z.enum(['guided','automatic']).optional(),
      attachmentIds: z.array(z.string().max(80)).max(uploadLimits.maxAttachments).optional() }), body);
    const taskProvider=runner.providerFor(value.providerId, value.model, user.id);
    if(!textModel(taskProvider,value.model))throw new HttpError(400,'Bu media modeli. Media studiyani oching.');
    if (!agentsFor(store, user.id).some(agent => agent.id === value.agentId)) throw new HttpError(400, 'Agent topilmadi.');
    if (store.one("SELECT count(*) AS count FROM runs WHERE user_id=? AND status IN ('queued','running','waiting_approval','waiting_input')", user.id).count >= 3) throw new HttpError(429, 'Bir vaqtda 3 ta vazifa ishlashi mumkin.');
    if(value.personal&&!value.projectId)value.projectId=personalState(store,user.id).projectId;
    let project = value.projectId ? store.project(user.id, value.projectId) : null;
    if (value.projectId && !project) throw new HttpError(404, 'Loyiha topilmadi.');
    if (project) ensureIdle(project);
    if (project && store.one("SELECT id FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_approval','waiting_input')", project.id)) throw new HttpError(409, 'Bu loyihada faol vazifa bor. Avval uni tugating yoki to‘xtating.');
    const nativeNode=value.providerId.startsWith('agy_')?value.providerId.slice(4):null;
    const environment = project?.environment || (nativeNode?(taskProvider.hosted?'cloud':'local'):value.environment); const nodeId = project?.node_id || nativeNode || value.nodeId;
    if(!project&&environment==='local'&&nodes.list(user.id).find(n=>n.id===nodeId)?.platform==='browser')throw new HttpError(409,'Avval Loyihalar bo‘limida brauzer papkasini ulang.');
    if(nativeNode&&environment==='local'&&nativeNode!==nodeId)throw new HttpError(400,'Bu lokal loyiha boshqa kompyuterga tegishli.');
    if (environment === 'local' && !nodes.list(user.id).some(node => node.id === nodeId && node.online)) throw new HttpError(409, 'Online lokal connectorni tanlang.');
    const attachments = [...new Set(value.attachmentIds || [])].map(attachmentId => {
      const file = store.one('SELECT * FROM attachments WHERE id=? AND user_id=?', attachmentId, user.id);
      if (!file) throw new HttpError(404, 'Biriktirilgan fayl topilmadi.'); return file;
    });
    for(const file of attachments){const local=attachmentsService.localFor(file);if(local&&(environment!=='local'||local.node_id!==nodeId))throw new HttpError(409,'Biriktirma boshqa kompyuterda. Faylni biriktirgan lokal muhitni tanlang.');}
    if(attachments.reduce((n,file)=>n+(attachmentsService.localFor(file)?.size||attachmentsService.assetFor(file)?.size||Buffer.byteLength(file.content)),0)>uploadLimits.maxRunBytes)throw new HttpError(413,'Bir vazifa fayllari 2 GB dan oshdi.');
    const timestamp = now();
    const run = { id: id('run_'), user_id: user.id, project_id: project?.id || id('prj_'), provider_id: value.providerId,
      model: value.model, agent_id: value.agentId, prompt: value.prompt, status: 'queued', environment, node_id: environment === 'local' ? nodeId : null, created_at: timestamp, updated_at: timestamp };
    let content = value.prompt;
    if (attachments.length) content = [{ type: 'text', text: value.prompt }, ...attachments.map(attachmentsService.context)];
    store.db.exec('BEGIN IMMEDIATE');
    try {
      if (!project) {
        project = { id: run.project_id, user_id: user.id, title: value.prompt.slice(0, 60), environment, node_id: run.node_id, created_at: timestamp, updated_at: timestamp };
        store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)', project.id, project.user_id, project.title, project.environment, project.node_id, timestamp, timestamp);
      }
      store.exec('INSERT INTO runs(id,user_id,project_id,provider_id,model,agent_id,prompt,status,environment,node_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        run.id, run.user_id, run.project_id, run.provider_id, run.model, run.agent_id, run.prompt, run.status, run.environment, run.node_id, timestamp, timestamp);
      store.message(run, 'user', { role: 'user', content });
      if(value.autonomy)execution.set(project.id,{autonomy:value.autonomy});
      for(const file of attachments)store.exec('INSERT INTO run_inputs VALUES(?,?)',run.id,file.id);
      if(value.personal){project.title='Davomiy suhbat';store.exec('UPDATE projects SET title=? WHERE id=?',project.title,project.id);savePersonal(store,user.id,{...personalState(store,user.id),projectId:project.id});}
      prepare?.(project,run);
      store.db.exec('COMMIT');
    } catch (error) { store.db.exec('ROLLBACK'); throw error; }
    runner.event(run.id, 'status', { status: 'queued' }); runner.queue(run.id); return {run,project};
  }
  app.post('/api/runs',async(req,res)=>{const prompt=parse(z.string().trim().min(1).max(30000),req.body?.prompt);const safePrompt=await automation.captureTelegramTokens(req.user.id,prompt,req.body.autonomy==='automatic');res.status(201).json(createTask(req.user,{...req.body,prompt:safePrompt}));});
  const flows=flowService(app,{store,runner,createTask,parse});
  attachmentsService.routes(app);jev.routes(app);
  app.get('/api/projects/:projectId/execution',(req,res)=>res.json(execution.get(projectFor(req).id)));
  app.put('/api/projects/:projectId/execution',(req,res)=>res.json(execution.set(projectFor(req).id,parse(z.object({autonomy:z.enum(['guided','automatic'])}),req.body))));
  libraryRoutes(app,{store,library,config,parse,projectFor,editProject,attachmentsService});
  const media=mediaService(app,{store,runner,library,config,parse});
  const videoStitch=videoStitchService(app,{store,library,config,parse});
  const videoStory=videoStoryService(app,{store,media,stitch:videoStitch,library,config,parse});
  runner.attachStudio(studioTools({store,library,media,config}));
  const documents=documentService(app,{store,config,library,parse,editProject});
  const automation=automationService(app,{store,config,vault,parse,editProject,nodes,fetcher:overrides.automationFetch,webhookExecute:overrides.webhookExecute,onConnected:runner.integrationConnected});runner.attachAutomation(automation);webhookReceiver=automation.webhooks.receive;
  runner.attachDocuments(documents);
  runner.attachCreative(creativeService(app,{store,config,runner,createTask,parse,projectFor,editProject,library,documents}));
  computer.routes();
  dashboardRoutes(app,{store,parse,createTask});
  dotBridge(app,{store,config,vault,auth,nodes,runner,createTask,clientMetadataFetch:overrides.dotClientMetadataFetch});

  app.get('/api/runs/:runId', (req, res) => {
    const run = runFor(req);
    const project = store.project(req.user.id, run.project_id);
    const messages = store.all('SELECT id,role,content,created_at,run_id FROM messages WHERE project_id=? AND (run_id IS NULL OR run_id IN (SELECT id FROM runs WHERE deleted_at IS NULL)) ORDER BY id', project.id)
      .map(message => ({ ...message, message: JSON.parse(message.content), content: undefined }));
    const events = store.all("SELECT * FROM events WHERE run_id=? AND type NOT IN ('delta','live','file_delta','terminal_delta') ORDER BY id DESC LIMIT 300", run.id).reverse().map(event => ({ ...event, data: JSON.parse(event.data) }));
    const approvals = store.all("SELECT * FROM approvals WHERE run_id=? AND status='pending'", run.id).map(approval => ({ ...approval, args: JSON.parse(approval.args) }));
    const live = store.one('SELECT data FROM live_runs WHERE run_id=?', run.id);
    res.json({ run, project, messages, events, approvals, parallel:runner.parallel.list(run.id),recovery:runner.recovery.public(run.id),live: live ? JSON.parse(live.data) : null, capabilities: { cloudShell: cloudAvailable(config), browser: Boolean(config.runnerUrl && config.runnerToken) }, usage: usageFor(run.id), cursor: store.one('SELECT MAX(id) AS value FROM events WHERE run_id=?', run.id).value || 0 });
  });
  app.delete('/api/runs/:runId', (req, res) => {
    const run = runFor(req);
    if (['queued','running','waiting_approval','waiting_input'].includes(run.status)) throw new HttpError(409, 'Avval ishlayotgan vazifani to‘xtating.');
    store.exec('UPDATE runs SET deleted_at=? WHERE id=? AND user_id=? AND deleted_at IS NULL', now(), run.id, req.user.id);
    res.json({ ok: true });
  });
  app.post('/api/runs/:runId/parallel',async(req,res)=>{
    const run=runFor(req),project=store.project(req.user.id,run.project_id);
    const value=parse(z.object({prompt:z.string().trim().min(1).max(30000),requestId:z.string().min(8).max(100),attachmentIds:z.array(z.string().max(80)).max(uploadLimits.maxAttachments).default([])}).strict(),req.body);
    if(!agentsFor(store,req.user.id).find(a=>a.id===run.agent_id)?.tools.includes('write_file'))throw new HttpError(400,'Parallel loyiha ishlari uchun fayl yozadigan agentni tanlang.');
    const files=[...new Set(value.attachmentIds)].map(attachmentId=>{const file=store.one('SELECT * FROM attachments WHERE id=? AND user_id=?',attachmentId,req.user.id);if(!file)throw new HttpError(404,'Biriktirilgan fayl topilmadi.');const local=attachmentsService.localFor(file);if(local&&(project.environment!=='local'||project.node_id!==local.node_id))throw new HttpError(409,'Biriktirma boshqa kompyuterda.');return file;});
    if(files.reduce((n,file)=>n+(attachmentsService.localFor(file)?.size||attachmentsService.assetFor(file)?.size||Buffer.byteLength(file.content)),0)>uploadLimits.maxRunBytes)throw new HttpError(413,'Bir vazifa fayllari 2 GB dan oshdi.');
    const prompt=await automation.captureTelegramTokens(req.user.id,value.prompt,execution.get(project.id).autonomy==='automatic');
    res.status(201).json({task:runner.parallel.add(run,project,{...value,prompt})});
  });
  app.post('/api/runs/:runId/parallel/:taskId/cancel',(req,res)=>{const run=runFor(req);runner.parallel.cancel(run,req.params.taskId);res.json({ok:true});});
  app.post('/api/runs/:runId/resume',(req,res)=>{const run=runFor(req);res.json({run:runner.resume(req.user.id,run.id),project:store.project(req.user.id,run.project_id)});});
  app.get('/api/runs/:runId/events', (req, res) => {
    const run = runFor(req);
    let cursor = Math.max(0, Number(req.get('Last-Event-ID') || req.query.after || 0));
    if (!Number.isFinite(cursor)) cursor = 0;
    res.setHeader('Content-Type', 'text/event-stream'); res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders();
    const send = event => {
      if (event.id <= cursor) return; cursor = event.id;
      res.write(`id: ${event.id}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`);
    };
    runner.bus.on(run.id, send);
    for (const event of store.all('SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id', run.id, cursor)) send({ ...event, data: JSON.parse(event.data) });
    const timer = setInterval(() => {
      const current = auth.user(req);
      if (!current || current.id !== run.user_id) { res.end(); return; }
      res.write(': heartbeat\n\n');
    }, 15_000);
    res.on('close', () => { clearInterval(timer); runner.bus.off(run.id, send); });
  });
  app.post('/api/runs/:runId/cancel', (req, res) => { runner.cancel(req.user.id, req.params.runId); res.json({ ok: true }); });
  app.post('/api/runs/:runId/drafts/recover', async (req, res) => {
    const run = runFor(req);
    if (!terminal.includes(run.status)) throw new HttpError(409, 'Agent ishlab turganda qoralamani tiklab bo‘lmaydi.');
    const { key } = parse(z.object({ key: z.string().min(1).max(180) }), req.body);
    const row = store.one('SELECT data FROM live_runs WHERE run_id=?', run.id);
    const live = row ? JSON.parse(row.data) : null;
    const draft = live?.drafts.find(item => item.key === key);
    if (!draft) throw new HttpError(404, 'Qoralama topilmadi.');
    if (draft.recoveredPath) return res.json({ path: draft.recoveredPath, originalPath: draft.path, operation: draft.operation || 'write_file' });
    if (draft.state !== 'interrupted' || !draft.content || !draft.path) throw new HttpError(409, 'Bu qoralamani tiklab bo‘lmaydi.');
    const lock = run.id + ':' + key;
    if (recoveringDrafts.has(lock)) throw new HttpError(409, 'Qoralama tiklanmoqda.');
    recoveringDrafts.add(lock);
    try {
      const project = store.project(req.user.id, run.project_id);
      const args = { path: `drafts/${run.id}/${draft.path}`, content: draft.content };
      await safePath(projectRoot(config, project), args.path);
      if (project.environment === 'local') await nodes.dispatch(project, null, 'write_file', args);
      if(!linkedProject(store,project))await fileTool(projectRoot(config, project), 'write_file', args);
      draft.recoveredPath = args.path; draft.state = 'recovered'; draft.content = '';
      store.exec('UPDATE live_runs SET data=? WHERE run_id=?', JSON.stringify(live), run.id);
      runner.event(run.id, 'draft_recovered', { path: args.path, originalPath: draft.path, key });
      runner.event(run.id, 'files_changed', {});
      res.json({ path: args.path, originalPath: draft.path, operation: draft.operation || 'write_file' });
    } finally { recoveringDrafts.delete(lock); }
  });
  app.post('/api/approvals/:approvalId', async (req, res) => {
    const value = parse(z.object({ approved: z.boolean(), answer: z.string().max(12000).optional() }), req.body);
    await runner.respond(req.user.id, req.params.approvalId, value); res.json({ ok: true });
  });

  app.get('/api/admin/settings', admin, (_req, res) => {
    const google = auth.settings();
    res.json({ google: { clientId: google.clientId, hasSecret: Boolean(google.clientSecret), adminEmails: google.adminEmails, ...auth.publicConfig() },
      deployment: { production: config.production, appUrl: config.appUrl, cloudShell: config.dockerEnabled, localMode: config.localAuth } });
  });
  app.put('/api/admin/settings/google', admin, (req, res) => {
    const value = parse(z.object({ clientId: z.string().trim().min(1).max(300), clientSecret: z.string().max(2000).optional(), adminEmails: z.array(z.email()).min(1).max(20) }), req.body);
    const current = auth.settings();
    if (!value.clientSecret && (value.clientId !== current.clientId || !current.clientSecret)) throw new HttpError(400, 'Google Client Secret kerak.');
    store.setSetting('google', { clientId: value.clientId, clientSecret: value.clientSecret || current.clientSecret, adminEmails: value.adminEmails.map(email => email.toLowerCase()) });
    res.json({ ok: true, ...auth.publicConfig() });
  });
  app.get('/api/admin/overview', admin, (_req, res) => {
    const usersCount = store.one('SELECT count(*) AS value FROM users WHERE google_sub IS NOT NULL').value;
    const runsCount = store.one('SELECT count(*) AS value FROM runs').value;
    const usage = store.one('SELECT COALESCE(SUM(input_tokens),0) AS input,COALESCE(SUM(output_tokens),0) AS output,COALESCE(SUM(known=0),0) AS unknown FROM usage');
    const providersCount = store.one('SELECT count(*) AS value FROM providers WHERE enabled=1').value;
    const daily = store.all("SELECT date(created_at,'+5 hours') AS date,SUM(input_tokens) AS input,SUM(output_tokens) AS output FROM usage WHERE created_at>=datetime('now','-7 days') GROUP BY date(created_at,'+5 hours') ORDER BY date");
    const byModel = store.all('SELECT model,provider_id,SUM(input_tokens) AS input,SUM(output_tokens) AS output,SUM(known=0) AS unknown,COUNT(*) AS requests FROM usage GROUP BY provider_id,model ORDER BY input+output DESC');
    const loginEvents = store.all('SELECT e.*,u.email,u.name FROM login_events e LEFT JOIN users u ON u.id=e.user_id ORDER BY e.created_at DESC LIMIT 100');
    const users = store.all('SELECT u.id,u.email,u.name,u.role,u.disabled,u.token_limit,u.created_at,u.last_login_at,COALESCE(SUM(t.input_tokens+t.output_tokens),0) AS tokens FROM users u LEFT JOIN usage t ON t.user_id=u.id WHERE u.google_sub IS NOT NULL GROUP BY u.id ORDER BY u.created_at DESC');
    res.json({ usersCount, runsCount, usage, providersCount, daily, byModel, loginEvents, users, capacity: runner.capacity(), google: auth.publicConfig() });
  });
  app.patch('/api/admin/users/:userId', admin, (req, res) => {
    const value = parse(z.object({ disabled: z.boolean().optional(), tokenLimit: z.number().int().min(-1).max(1000000000).optional() }), req.body);
    const user = store.one('SELECT * FROM users WHERE id=? AND google_sub IS NOT NULL', req.params.userId);
    if (!user) throw new HttpError(404, 'Foydalanuvchi topilmadi.');
    if (value.disabled && user.id === req.user.id) throw new HttpError(400, 'O‘z hisobingizni shu yerda to‘xtata olmaysiz.');
    store.exec('UPDATE users SET disabled=?,token_limit=? WHERE id=?', value.disabled === undefined ? user.disabled : value.disabled ? 1 : 0, value.tokenLimit ?? user.token_limit, user.id);
    if (value.disabled) {
      store.exec('DELETE FROM sessions WHERE user_id=?', user.id); store.exec('UPDATE nodes SET revoked=1 WHERE user_id=?', user.id);
      for (const run of store.all("SELECT id FROM runs WHERE user_id=? AND status IN ('queued','running','waiting_approval','waiting_input')", user.id)) runner.cancel(user.id, run.id);
    }
    res.json({ ok: true });
  });
  app.get('/api/usage', (req, res) => res.json(store.all('SELECT model,SUM(input_tokens) AS input,SUM(output_tokens) AS output,SUM(known=0) AS unknown FROM usage WHERE user_id=? GROUP BY model', req.user.id)));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpointi topilmadi.' }));
  const dist = path.join(rootDir, 'dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: config.production ? '1h' : 0 }));
    app.get('/{*any}', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.sendFile(path.join(dist, 'index.html')); });
  } else app.get('/', (_req, res) => res.type('text').send('OpenSI backend ishlayapti. UI: npm run dev yoki npm run build.'));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return res.end();
    const status = error instanceof HttpError ? error.status : error.code === 'ENOENT' ? 404 : error.type === 'entity.too.large' ? 413 : 500;
    const message = error instanceof HttpError ? error.message : status === 404 ? 'Fayl topilmadi.' : status === 413 ? 'So‘rov hajmi juda katta.' : 'Server so‘rovni bajara olmadi. Sozlamalarni tekshiring.';
    res.status(status).json({ error: message });
  });
  return { app, config, store, vault, auth, nodes, runner, computer, automation, skills,zcode, close: async () => { skills.close();flows.close(); await automation.webhooks.shutdown(); await videoStory.close(); await videoStitch.close(); await media.close(); await runner.close(); await zcode.close(); await documents.close(); await computer.close(); store.close(); } };
}
