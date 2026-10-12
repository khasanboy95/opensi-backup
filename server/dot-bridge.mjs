import { createHash, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import express from 'express';
import { z } from 'zod';
import { hash, token, id, now, HttpError, guardedFetch } from './security.mjs';
import { projectRoot, fileTool } from './files.mjs';

const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect';
const READ = 'projects:read';
const WRITE = 'projects:write';
const SCOPES = [READ, WRITE];
const oauthError = (res, status, error) => res.status(status).set('Cache-Control', 'no-store').json({ error });
const html = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const result = value => ({ content: [{ type:'text', text:JSON.stringify(value) }], structuredContent:value });

function parseAuthorization(query, appUrl) {
  const { response_type, client_id, redirect_uri, code_challenge, code_challenge_method, state } = query;
  const resource = query.resource || '';
  const requested = typeof query.scope === 'string' && query.scope.trim() ? [...new Set(query.scope.trim().split(/\s+/))] : SCOPES;
  if (response_type !== 'code' || client_id !== CLIENT_ID || redirect_uri !== CALLBACK || resource !== `${appUrl}/mcp` ||
      code_challenge_method !== 'S256' || typeof code_challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code_challenge) ||
      typeof state !== 'string' || !state || state.length > 1000 || requested.some(scope => !SCOPES.includes(scope)) || !requested.includes(READ)) {
    throw new HttpError(400, 'Dot OAuth so‘rovi noto‘g‘ri.');
  }
  return { client_id, redirect_uri, resource, code_challenge, scope:requested.join(' '), state };
}

export function dotBridge(app, { store, config, vault, auth, nodes, runner, createTask, clientMetadataFetch = guardedFetch }) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS dot_oauth_codes (
      code_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL,
      redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, challenge TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dot_oauth_tokens (
      token_hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, resource TEXT NOT NULL,
      scope TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dot_tokens_grant ON dot_oauth_tokens(grant_id);
    CREATE INDEX IF NOT EXISTS dot_tokens_user ON dot_oauth_tokens(user_id);
  `);
  const resource = `${config.appUrl}/mcp`;
  const issuer = config.appUrl;
  const cleanup = () => {
    store.exec('DELETE FROM dot_oauth_codes WHERE expires_at<?', Date.now());
    store.exec('DELETE FROM dot_oauth_tokens WHERE expires_at<?', Date.now());
  };
  const issue = (userId, clientId, scope, grantId = id('dotgrant_')) => {
    const access = token(), refresh = token(), timestamp = now();
    store.exec('INSERT INTO dot_oauth_tokens VALUES(?,?,?,?,?,?,?, ?,?)', hash(access), grantId, 'access', userId, clientId, resource, scope, Date.now()+3600_000, timestamp);
    store.exec('INSERT INTO dot_oauth_tokens VALUES(?,?,?,?,?,?,?, ?,?)', hash(refresh), grantId, 'refresh', userId, clientId, resource, scope, Date.now()+30*86400_000, timestamp);
    return { access_token:access, token_type:'Bearer', expires_in:3600, refresh_token:refresh, scope, resource };
  };
  const limiter = rateLimit({ windowMs:60_000, limit:60, standardHeaders:'draft-8', legacyHeaders:false });
  const mcpLimiter = rateLimit({ windowMs:60_000, limit:600, standardHeaders:'draft-8', legacyHeaders:false,
    keyGenerator:req=>/^Bearer [A-Za-z0-9_-]{43}$/.test(req.get('authorization')||'')?`grant:${hash(req.get('authorization'))}`:`ip:${ipKeyGenerator(req.ip)}` });
  app.get(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'], (_req,res) =>
    res.json({ resource, authorization_servers:[issuer], scopes_supported:SCOPES, bearer_methods_supported:['header'] }));
  app.get('/.well-known/oauth-authorization-server', (_req,res) => res.json({
    issuer, authorization_endpoint:`${issuer}/oauth/authorize`, token_endpoint:`${issuer}/oauth/token`,
    revocation_endpoint:`${issuer}/oauth/revoke`, response_types_supported:['code'],
    grant_types_supported:['authorization_code','refresh_token'], code_challenge_methods_supported:['S256'],
    token_endpoint_auth_methods_supported:['none'], client_id_metadata_document_supported:true,
    authorization_response_iss_parameter_supported:true, scopes_supported:SCOPES,
  }));

  async function verifyClient() {
    const response = await clientMetadataFetch(CLIENT_ID, { signal:AbortSignal.timeout(10_000) });
    if (!response.ok) throw new HttpError(503, 'ChatGPT OAuth klienti tekshirilmadi.');
    const document = await response.json();
    if (document.client_id !== CLIENT_ID || !document.redirect_uris?.includes(CALLBACK) ||
        !document.token_endpoint_auth_methods_supported?.includes('none')) {
      throw new HttpError(503, 'ChatGPT OAuth klient ma’lumotlari mos emas.');
    }
  }
  app.get('/oauth/authorize', limiter, async (req,res) => {
    const parameters = parseAuthorization(req.query, config.appUrl);
    await verifyClient();
    const user = auth.user(req);
    if (!user) return res.redirect(`/api/auth/google?next=${encodeURIComponent(req.originalUrl)}`);
    const csrf = token();
    res.cookie('opensi_dot_consent', vault.encrypt(JSON.stringify({ parameters, csrf, userId:user.id, expires:Date.now()+10*60_000 })),
      { httpOnly:true, secure:config.production, sameSite:'lax', path:'/oauth', maxAge:10*60_000 });
    res.set('Cache-Control','no-store').type('html').send(`<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenSI · Dot ulanishi</title><style>body{font:16px system-ui;background:#101013;color:#eee;max-width:560px;margin:8vh auto;padding:24px}main{background:#1c1c20;border:1px solid #39393f;border-radius:18px;padding:28px}h1{font-size:26px}p{line-height:1.5;color:#ccc}code{color:#b9ef83}button{border:0;border-radius:9px;padding:13px 18px;font:inherit;cursor:pointer}button[name=decision][value=allow]{background:#b9ef83;color:#111}button[name=decision][value=deny]{background:#36363c;color:white}form{display:flex;gap:12px;margin-top:25px;flex-wrap:wrap}</style><main><h1>Dotni OpenSI’ga ulash</h1><p><strong>${html(user.email || user.name)}</strong> hisobidagi loyihalar uchun ChatGPT’ga ruxsat beriladi.</p><p>Ruxsatlar: loyihalar va matnli fayllarni o‘qish${parameters.scope.includes(WRITE)?', yangi vazifa boshlash va vazifani davom ettirish':''}. Har bir amal OpenSI hisobingiz chegarasida ishlaydi.</p><p>Ulanishni OpenSI → Ulanishlar bo‘limidan uzishingiz mumkin.</p><form method="post" action="/oauth/authorize?continue=manual"><input type="hidden" name="csrf" value="${html(csrf)}"><button name="decision" value="allow">Ruxsat berish</button><button name="decision" value="deny">Rad etish</button></form></main></html>`);
  });
  app.post('/oauth/authorize', limiter, express.urlencoded({extended:false,limit:'4kb'}), (req,res) => {
    res.set('Cache-Control','no-store');
    let pending;
    try { pending = JSON.parse(vault.decrypt(req.cookies?.opensi_dot_consent || '')); } catch { throw new HttpError(400, 'Ulanish oynasi muddati tugagan. Qaytadan boshlang.'); }
    res.clearCookie('opensi_dot_consent', {path:'/oauth',secure:config.production,sameSite:'lax'});
    const user = auth.user(req);
    if (!user || pending.userId !== user.id || pending.expires < Date.now() ||
        typeof req.body.csrf !== 'string' || req.body.csrf !== pending.csrf) throw new HttpError(403,'Dot ulanishi tasdiqlanmadi.');
    const redirect = new URL(pending.parameters.redirect_uri);
    redirect.searchParams.set('state',pending.parameters.state);
    redirect.searchParams.set('iss',issuer);
    if (req.body.decision !== 'allow') { redirect.searchParams.set('error','access_denied'); return res.redirect(redirect.toString()); }
    cleanup();
    const code = token();
    store.exec('INSERT INTO dot_oauth_codes VALUES(?,?,?,?,?,?,?,?)',hash(code),user.id,pending.parameters.client_id,
      pending.parameters.redirect_uri,pending.parameters.resource,pending.parameters.scope,pending.parameters.code_challenge,Date.now()+5*60_000);
    redirect.searchParams.set('code',code);
    if (req.query.continue === 'manual') {
      res.set('Referrer-Policy','no-referrer');
      res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
      return res.status(200).type('html').send(`<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenSI · Ulanish tasdiqlandi</title><style>body{font:16px system-ui;background:#101013;color:#eee;max-width:560px;margin:8vh auto;padding:24px}main{background:#1c1c20;border:1px solid #39393f;border-radius:18px;padding:28px}a{display:inline-block;background:#b9ef83;color:#111;padding:13px 18px;border-radius:9px;text-decoration:none;margin-top:12px}</style><main><h1>Ruxsat berildi</h1><p>Ulanishni yakunlash uchun ChatGPT’ga qayting. Havola 5 daqiqa amal qiladi.</p><a href="${html(redirect.toString())}" rel="noreferrer">ChatGPT’ga qaytish</a></main></html>`);
    }
    res.redirect(redirect.toString());
  });
  app.post('/oauth/token', limiter, express.urlencoded({extended:false,limit:'8kb'}), (req,res) => {
    res.set('Cache-Control','no-store');
    const body=req.body || {};
    if (body.client_id !== CLIENT_ID || req.get('authorization')) return oauthError(res,401,'invalid_client');
    if (body.grant_type === 'authorization_code') {
      if (body.redirect_uri !== CALLBACK || body.resource !== resource || !/^[A-Za-z0-9_-]{43,128}$/.test(body.code_verifier || '') ||
          typeof body.code !== 'string') return oauthError(res,400,'invalid_grant');
      const row=store.one('SELECT * FROM dot_oauth_codes WHERE code_hash=?',hash(body.code));
      const challenge=createHash('sha256').update(body.code_verifier).digest('base64url');
      const expected=Buffer.from(row?.challenge || '');
      const actual=Buffer.from(challenge);
      if(!row || row.expires_at<Date.now() || row.client_id!==CLIENT_ID || row.redirect_uri!==body.redirect_uri || row.resource!==body.resource ||
         expected.length!==actual.length || !timingSafeEqual(expected,actual)) return oauthError(res,400,'invalid_grant');
      const consumed=store.exec('DELETE FROM dot_oauth_codes WHERE code_hash=?',hash(body.code));
      if(!consumed.changes)return oauthError(res,400,'invalid_grant');
      return res.json(issue(row.user_id,row.client_id,row.scope));
    }
    if (body.grant_type === 'refresh_token') {
      if(typeof body.refresh_token!=='string' || body.resource!==resource)return oauthError(res,400,'invalid_grant');
      const row=store.one("SELECT t.* FROM dot_oauth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='refresh' AND t.expires_at>? AND u.disabled=0",hash(body.refresh_token),Date.now());
      if(!row || row.client_id!==CLIENT_ID || row.resource!==body.resource)return oauthError(res,400,'invalid_grant');
      const consumed=store.exec('DELETE FROM dot_oauth_tokens WHERE token_hash=?',hash(body.refresh_token));
      if(!consumed.changes)return oauthError(res,400,'invalid_grant');
      return res.json(issue(row.user_id,row.client_id,row.scope,row.grant_id));
    }
    return oauthError(res,400,'unsupported_grant_type');
  });
  app.post('/oauth/revoke', limiter, express.urlencoded({extended:false,limit:'4kb'}), (req,res) => {
    if (req.body?.client_id !== CLIENT_ID || typeof req.body?.token !== 'string') return oauthError(res,401,'invalid_client');
    const row=store.one('SELECT grant_id FROM dot_oauth_tokens WHERE token_hash=?',hash(req.body.token));
    if(row)store.exec('DELETE FROM dot_oauth_tokens WHERE grant_id=?',row.grant_id);
    res.status(200).end();
  });

  app.get('/api/dot/connection',(req,res)=>res.json({ connected:Boolean(store.one("SELECT 1 FROM dot_oauth_tokens WHERE user_id=? AND kind='refresh' AND expires_at>?",req.user.id,Date.now())), mcpUrl:resource }));
  app.delete('/api/dot/connection',(req,res)=>{store.exec('DELETE FROM dot_oauth_tokens WHERE user_id=?',req.user.id);store.exec('DELETE FROM dot_oauth_codes WHERE user_id=?',req.user.id);res.json({ok:true});});

  const authenticate = (req,res,next) => {
    const authorization=req.get('authorization') || '';
    const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    const row=match?store.one("SELECT t.*,u.name,u.email,u.disabled FROM dot_oauth_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=? AND t.kind='access' AND t.expires_at>? AND u.disabled=0",hash(match[1]),Date.now()):null;
    if(!row){res.set('WWW-Authenticate',`Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="${READ}"`);return oauthError(res,401,'invalid_token');}
    if(row.resource!==resource || row.client_id!==CLIENT_ID)return oauthError(res,401,'invalid_token');
    req.dotGrant=row;next();
  };
  async function handleMcp(req,res) {
    const grant=req.dotGrant;
    const user=store.one('SELECT * FROM users WHERE id=? AND disabled=0',grant.user_id);
    if(!user)return oauthError(res,401,'invalid_token');
    const mcp=new McpServer({name:'OpenSI Projects',version:'1.0.0'},
      {instructions:'Use OpenSI project tools only for the linked user. Read project context before starting a new task. A started task is asynchronous; poll get_task_status for completion. Local projects need an online connector. Do not claim a task is finished until status is completed and its result is inspected.'});
    const ownProject=projectId=>{const project=store.project(user.id,projectId);if(!project)throw new HttpError(404,'Loyiha topilmadi.');return project;};
    const ownRun=runId=>{const run=store.one('SELECT * FROM runs WHERE id=? AND user_id=? AND deleted_at IS NULL',runId,user.id);if(!run)throw new HttpError(404,'Vazifa topilmadi.');return run;};
    const safe=fn=>async args=>{try{return result(await fn(args));}catch(error){return {isError:true,content:[{type:'text',text:error instanceof HttpError?error.message:'OpenSI amalni bajara olmadi.'}]};}};
    mcp.registerTool('get_profile',{description:'Identify the linked OpenSI account.',annotations:{readOnlyHint:true},_meta:{'openai/profile':true}},safe(async()=>({id:user.id,name:user.name,email:user.email})));
    mcp.registerTool('list_projects',{description:'List projects owned by the linked OpenSI account.',annotations:{readOnlyHint:true},inputSchema:{limit:z.number().int().min(1).max(100).default(30)}},safe(async({limit})=>({projects:store.all('SELECT id,title,environment,node_id,created_at,updated_at FROM projects WHERE user_id=? ORDER BY updated_at DESC LIMIT ?',user.id,limit).map(p=>({...p,url:`${issuer}/#/workspace/project:${p.id}`}))})));
    mcp.registerTool('get_project',{description:'Get one OpenSI project, its instructions, and latest task.',annotations:{readOnlyHint:true},inputSchema:{projectId:z.string().min(1).max(100)}},safe(async({projectId})=>{const project=ownProject(projectId);return {project,context:store.one('SELECT instructions,memory FROM project_context WHERE project_id=?',project.id)||null,latestRun:store.one('SELECT id,status,prompt,error,updated_at FROM runs WHERE project_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at DESC,rowid DESC LIMIT 1',project.id,user.id)||null,url:`${issuer}/#/workspace/project:${project.id}`};}));
    mcp.registerTool('list_project_files',{description:'List visible workspace files for a linked OpenSI project.',annotations:{readOnlyHint:true},inputSchema:{projectId:z.string().min(1).max(100)}},safe(async({projectId})=>{const p=ownProject(projectId);const data=p.environment==='local'?await nodes.dispatch(p,null,'list_files',{limit:200}):await fileTool(projectRoot(config,p),'list_files',{limit:200});return {projectId,source:p.environment,...data};}));
    mcp.registerTool('read_project_file',{description:'Read a short section of a text file in a linked OpenSI project.',annotations:{readOnlyHint:true},inputSchema:{projectId:z.string().min(1).max(100),path:z.string().min(1).max(240),offset:z.number().int().min(0).default(0)}},safe(async({projectId,path,offset})=>{const p=ownProject(projectId);const args={path,offset,limit:12000};const data=p.environment==='local'?await nodes.dispatch(p,null,'read_file',args):await fileTool(projectRoot(config,p),'read_file',args);return {projectId,...data};}));
    mcp.registerTool('get_task_status',{description:'Get status, recent progress, and answer of an OpenSI task.',annotations:{readOnlyHint:true},inputSchema:{runId:z.string().min(1).max(100)}},safe(async({runId})=>{const run=ownRun(runId);const events=store.all("SELECT id,type,data,created_at FROM events WHERE run_id=? AND type NOT IN ('delta','live','file_delta','terminal_delta') ORDER BY id DESC LIMIT 20",run.id).reverse().map(e=>({...e,data:JSON.parse(e.data)}));const answer=store.one("SELECT content FROM messages WHERE run_id=? AND role='assistant' ORDER BY id DESC LIMIT 1",run.id);return {run:{id:run.id,project_id:run.project_id,status:run.status,prompt:run.prompt,error:run.error,updated_at:run.updated_at},events,answer:answer?JSON.parse(answer.content):null,url:`${issuer}/#/workspace/${run.id}`};}));
    if(grant.scope.split(' ').includes(WRITE)){
      mcp.registerTool('create_project_task',{description:'Create a new cloud OpenSI project and start an asynchronous developer task.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},inputSchema:{prompt:z.string().trim().min(1).max(30000)}},safe(async({prompt})=>{const created=createTask(user,{prompt,providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',nodeId:null,projectId:null,autonomy:'automatic'});return {runId:created.run.id,projectId:created.project.id,status:created.run.status,url:`${issuer}/#/workspace/${created.run.id}`};}));
      mcp.registerTool('start_project_task',{description:'Start an asynchronous OpenSI developer task in an existing project. Use get_task_status to follow progress.',annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},inputSchema:{projectId:z.string().min(1).max(100),prompt:z.string().trim().min(1).max(30000)}},safe(async({projectId,prompt})=>{const p=ownProject(projectId);const created=createTask(user,{prompt,providerId:'auto',model:'auto',agentId:'developer',environment:p.environment,nodeId:p.node_id,projectId:p.id,autonomy:'automatic'});return {runId:created.run.id,projectId:p.id,status:created.run.status,url:`${issuer}/#/workspace/${created.run.id}`};}));
      mcp.registerTool('resume_project_task',{description:'Resume a failed or interrupted OpenSI task from its saved state.',annotations:{readOnlyHint:false,destructiveHint:false},inputSchema:{runId:z.string().min(1).max(100)}},safe(async({runId})=>{const run=ownRun(runId);const resumed=runner.resume(user.id,run.id);return {runId:resumed.id,status:resumed.status,url:`${issuer}/#/workspace/${resumed.id}`};}));
      mcp.registerTool('cancel_project_task',{description:'Stop a running OpenSI task. Saved project files remain.',annotations:{readOnlyHint:false,destructiveHint:true},inputSchema:{runId:z.string().min(1).max(100)}},safe(async({runId})=>{const run=ownRun(runId);runner.cancel(user.id,run.id);return {runId:run.id,stopped:true};}));
    }
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:128_000});
    res.on('close',()=>{void transport.close();void mcp.close();});
    await mcp.connect(transport);
    await transport.handleRequest(req,res,req.body);
  }
  app.post('/mcp',mcpLimiter,authenticate,handleMcp);
  app.get('/mcp',mcpLimiter,authenticate,handleMcp);
  app.delete('/mcp',(_req,res)=>res.sendStatus(405));
  return {resource};
}
