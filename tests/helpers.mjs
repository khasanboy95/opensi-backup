import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/app.mjs';

export async function tempDir() { return mkdtemp(path.join(os.tmpdir(), 'opensi-test-')); }
export async function removeTemp(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith('opensi-test-'));
  await rm(resolved, { recursive: true, force: true });
}
export async function fixture(overrides = {}) {
  const dataDir = await tempDir();
  const service = createApp({ dataDir, localAuth: true, production: false, encryptionKey: '', jevKey:'',appUrl: 'http://127.0.0.1:4581', approvalTimeout: 10_000, connectorTimeout: 20_000, ...overrides });
  const server = service.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(base + '/api' + route, { method, headers: { 'x-opensi-client': 'web', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const value = await response.json().catch(() => null); return { response, status: response.status, value };
  };
  return { ...service, base, request, dataDir, async close() { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await removeTemp(dataDir); } };
}
export async function until(fn, timeout = 12_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(60); }
  throw new Error('Test holatini kutish uchun vaqt tugadi.');
}

export async function mockProvider() {
  const requests = []; const secret = 'QA_ONLY_NOT_A_REAL_PROVIDER_KEY';
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type','application/json'); res.end(JSON.stringify({ data: [{ id: 'qa-model' }] })); return; }
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    const userMessages = body.messages.filter(message => message.role === 'user');
    const raw = userMessages.at(-1)?.content;
    const prompt = typeof raw === 'string' ? raw : raw?.[0]?.text || '';
    const last = body.messages.at(-1);
    if (prompt.includes('_HTTP_ERROR_')) { res.writeHead(402, { 'content-type':'application/json' }); res.end(JSON.stringify({ error: `balance exhausted ${secret}` })); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
    if (prompt.includes('_SLOW_')) { const timer = setTimeout(() => { res.end('data: [DONE]\n\n'); }, 30000); res.on('close', () => clearTimeout(timer)); return; }
    let message;
    if(prompt.includes('_WEBHOOK_FLOW_'))message=last.role==='user'?{tool_calls:[{id:'hook-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'bot.mjs',content:"export default(q,r)=>{if(q.headers['x-telegram-bot-api-secret-token']!==process.env.TELEGRAM_WEBHOOK_SECRET)return r.status(403).end();r.json({method:'sendMessage',chat_id:q.body.message.chat.id,text:'OK'});}"})}},{id:'hook-test',type:'function',function:{name:'webhook_test',arguments:JSON.stringify({entry:'bot.mjs'})}}]}:{content:'HTTP handler checked; real Telegram not tested.'};
    else if(prompt.includes('_DEPLOY_FLOW_'))message=last.role==='user'?{tool_calls:[{id:'deploy-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'index.html',content:'<h1>Actual tool deployment</h1>'})}},{id:'deploy-call',type:'function',function:{name:'deploy_vercel',arguments:JSON.stringify({connectionId:prompt.match(/int_[a-f0-9]{24}/)[0],requestId:'agent-deploy',framework:'static'})}}]}:{content:'Deployment submitted, build not verified.'};
    else if(prompt.includes('_WAIT_INTEGRATION_'))message=last.role==='user'?{tool_calls:[{id:'wait-vercel',type:'function',function:{name:'await_integration',arguments:JSON.stringify({kind:'vercel'})}}]}:{content:'Vercel hisobiga ulanish tayyor; loyiha davom ettirildi.'};
    else if(prompt.includes('_CREATE_AGENT_'))message=last.role==='user'?{tool_calls:[{id:'create-agent',type:'function',function:{name:'create_agent',arguments:JSON.stringify({name:'QA Helper',description:'Read only helper',instructions:'Read only the supplied project files.',tools:['read_file','list_files']})}}]}:{content:'Agent created.'};
    else if (prompt.includes('_ARTIFACT_FLOW_')) message=last.role==='user'?{tool_calls:[{id:'artifact',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'opensi-artifact.json',content:JSON.stringify({version:1,kind:'slides',title:'QA slides',pages:[{title:'Birinchi',body:'Content'},{title:'Ikkinchi',body:'More content'}]})})}}]}:{content:'Manba saqlandi.'};
    else if (prompt.includes('_PLAN_FLOW_')) {
      const step=body.messages.filter(item=>item.role==='tool').length;
      message=step<2?{tool_calls:[{id:'plan-'+step,type:'function',function:{name:'update_plan',arguments:JSON.stringify({steps:[{title:'Fayllarni tekshirish',status:step?'completed':'in_progress'},{title:'Natijani tekshirish',status:step?'in_progress':'pending'}]})}}]}:{content:'Reja yangilandi; tekshirish hali bajarilmoqda.'};
    }
    else if (last.role === 'user' && prompt.includes('_CAPTURE_')) message={tool_calls:[{id:'computer-capture',type:'function',function:{name:'computer_capture',arguments:JSON.stringify({url:'https://example.com',mobile:true,maxScreens:2})}}]};
    else if (last.role === 'user' && prompt.includes('_COMPUTER_APPROVAL_')) message={tool_calls:[{id:'computer-click',type:'function',function:{name:'computer_action',arguments:JSON.stringify({action:'click',target:1,revision:'rev-1',reason:'Open the public information link'})}}]};
    else if (prompt.includes('_LONG_FILE_FLOW_')) {
      const step = body.messages.filter(item => item.role === 'tool').length;
      message = step < 20 ? { tool_calls:[{ id:'long-'+step,type:'function',function:{name:step===0?'write_file':'append_file',arguments:JSON.stringify({path:'index.html',content:step===0?'<html>':step===19?'</html>':`<p>Section ${step}</p>`})}}] } : {content:'All sections saved.'};
    }
    else if (prompt.includes('_UNSUPPORTED_')) message = { tool_calls: [{ id:'qa-call', type:'function', function:{ name:'not_allowed', arguments:'{}' } }] };
    else if (last.role === 'user' && prompt.includes('_LARGE_WRITE_')) message = { tool_calls:[
      { id:'large-write',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'index.html',content:'<!doctype html><html><body>'+ 'A'.repeat(27000) +'</body></html>'})} },
    ] };
    else if (last.role === 'user' && prompt.includes('_EDIT_FLOW_')) message = { tool_calls: [
      { id:'edit-create',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'draft.html',content:'<html>OLD'})} },
      { id:'edit-copy',type:'function',function:{name:'copy_file',arguments:JSON.stringify({from:'draft.html',path:'index.html'})} },
      { id:'edit-append',type:'function',function:{name:'append_file',arguments:JSON.stringify({path:'index.html',content:'</html>'})} },
      { id:'edit-replace',type:'function',function:{name:'edit_file',arguments:JSON.stringify({path:'index.html',search:'OLD',replace:'FIXED'})} },
    ] };
    else if (last.role === 'user' && prompt.includes('_STATIC_')) message = { tool_calls: [
      { id:'qa-write', type:'function', function:{ name:'write_file', arguments:JSON.stringify({ path:'index.html', content:'<!doctype html><html lang="uz"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="style.css"><title>QA Portfolio</title></head><body><header>Portfolio.</header><main><h1>Raqamli tajribalar yarataman.</h1><p>OpenSI agent vositalari bilan yaratilgan test sahifasi.</p><button onclick="document.getElementById(\'result\').textContent=\'CLICK_OK\'">Bog‘lanish</button><p id="result"></p></main></body></html>' }) } },
      { id:'qa-style', type:'function', function:{ name:'write_file', arguments:JSON.stringify({ path:'style.css', content:'*{box-sizing:border-box}body{margin:0;background:#f6f5f0;color:#111;font-family:Arial,sans-serif}header{padding:24px 30px;border-bottom:1px solid #ddd;font-weight:bold}main{padding:65px 30px}h1{font-size:clamp(30px,6vw,58px);letter-spacing:-2px}p{color:#666;line-height:1.8}button{background:#111;color:white;border:0;padding:16px 25px;border-radius:6px;cursor:pointer}' }) } },
    ] };
    else if (last.role === 'user' && prompt.includes('_ASK_')) message = { tool_calls:[{ id:'qa-ask',type:'function',function:{ name:'ask_user',arguments:JSON.stringify({question:'Qaysi rangni tanlaysiz?'}) } }] };
    else if (last.role === 'user' && prompt.includes('_MCP_')) message = { tool_calls:[{id:'qa-mcp',type:'function',function:{name:body.tools.find(tool=>tool.function.name.startsWith('mcp_'))?.function.name || 'mcp_unavailable',arguments:JSON.stringify({text:'MCP_RESULT_OK'})}}] };
    else if (last.role === 'user' && prompt.includes('_COMMAND_')) message = { tool_calls:[{id:'qa-command',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:prompt.includes('_STREAM_COMMAND_') ? 'node -e "console.log(\'FIRST_CHUNK\');setTimeout(()=>console.log(\'LAST_CHUNK\'),2200)"' : 'node -e "process.stdout.write(\'LOCAL_COMMAND_OK\')"',timeout:15})}}] };
    else if (last.role === 'user' && prompt.includes('_DELEGATE_')) message = { tool_calls:[{id:'qa-delegate',type:'function',function:{name:'delegate_agent',arguments:JSON.stringify({agent:'designer',task:'_CHILD_'})}}] };
    else if (last.role === 'user' && prompt.includes('_CHILD_')) message = { tool_calls:[{id:'qa-child',type:'function',function:{name:'write_file',arguments:JSON.stringify({path:'child.css',content:'body{color:#223344}'})}}] };
    else message = { content: prompt.includes('OPENSI_CONNECTED') ? 'OPENSI_CONNECTED' : last.role === 'tool' ? 'Vazifa yakunlandi. Natija vositalar orqali saqlandi.' : 'OpenSI test javobi.' };
    const toolCalls = message.tool_calls?.map((call, index) => ({ ...call, index }));
    const event = { choices:[{delta:{...message,...(toolCalls ? {tool_calls:toolCalls} : {})},finish_reason:toolCalls ? 'tool_calls' : prompt.includes('_BROKEN_STREAM_') ? null : 'stop'}] };
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (!prompt.includes('_MISSING_USAGE_')) res.write(`data: ${JSON.stringify({choices:[],usage:{prompt_tokens:23,completion_tokens:11,total_tokens:34}})}\n\n`);
    if (!prompt.includes('_BROKEN_STREAM_')) res.write('data: [DONE]\n\n');
    res.end();
  });
  server.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  return { base:`http://127.0.0.1:${server.address().port}/v1`, secret, requests, close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
export async function addProvider(f, mock) {
  const result = await f.request('/providers',{method:'POST',body:{label:'QA compatible provider',baseUrl:mock.base,apiKey:mock.secret}});
  assert.equal(result.status,200,JSON.stringify(result.value)); return result.value;
}
export async function createRun(f, provider, prompt, extra = {}) {
  const result = await f.request('/runs',{method:'POST',body:{prompt,providerId:provider.id,model:'qa-model',agentId:'developer',environment:'cloud',...extra}});
  assert.equal(result.status,201,JSON.stringify(result.value)); return result.value;
}
export async function runState(f, runId, state) {
  return until(async () => { const result = await f.request('/runs/'+runId); return result.value?.run.status === state ? result.value : null; });
}
