import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, mockProvider, addProvider, runState } from './helpers.mjs';
import { now } from '../server/security.mjs';

const clientMetadataFetch=async()=>({ok:true,json:async()=>({client_id:'https://chatgpt.com/oauth/client.json',redirect_uris:['https://chatgpt.com/connector_platform_oauth_redirect'],token_endpoint_auth_methods_supported:['none']})});
const form=(body)=>new URLSearchParams(body);

async function authorize(f,scope='projects:read projects:write') {
  const verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  const query=new URLSearchParams({response_type:'code',client_id:'https://chatgpt.com/oauth/client.json',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:'http://127.0.0.1:4581/mcp',code_challenge:challenge,code_challenge_method:'S256',state:'qa-state',scope});
  const consent=await fetch(f.base+'/oauth/authorize?'+query,{redirect:'manual'});
  assert.equal(consent.status,200);
  const page=await consent.text();
  const csrf=page.match(/name="csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);
  const action=page.match(/<form method="post" action="([^"]+)"/)?.[1];
  assert.equal(action,'/oauth/authorize?continue=manual');
  const cookie=consent.headers.get('set-cookie').split(';')[0];
  const approval=await fetch(f.base+action,{method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded'},body:form({csrf,decision:'allow'}),redirect:'manual'});
  assert.equal(approval.status,200);
  assert.equal(approval.headers.get('referrer-policy'),'no-referrer');
  assert.equal(approval.headers.get('cache-control'),'no-store');
  const approvedPage=await approval.text();
  assert.match(approvedPage,/rel="noreferrer"/);
  const redirect=new URL(approvedPage.match(/<a href="([^"]+)"/)?.[1].replaceAll('&amp;','&'));
  assert.equal(redirect.searchParams.get('iss'),'http://127.0.0.1:4581');
  const code=redirect.searchParams.get('code');
  assert.ok(code);
  const exchange=async()=>fetch(f.base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'authorization_code',client_id:'https://chatgpt.com/oauth/client.json',redirect_uri:'https://chatgpt.com/connector_platform_oauth_redirect',resource:'http://127.0.0.1:4581/mcp',code,code_verifier:verifier})});
  const granted=await exchange();assert.equal(granted.status,200);
  assert.equal((await exchange()).status,400,'OAuth code is single use');
  return granted.json();
}

test('Dot OAuth connects one account and MCP controls only its projects',async()=>{
  const f=await fixture({dotClientMetadataFetch:clientMetadataFetch});const mock=await mockProvider();
  try{
    const metadata=await fetch(f.base+'/.well-known/oauth-protected-resource/mcp').then(r=>r.json());
    assert.equal(metadata.resource,'http://127.0.0.1:4581/mcp');
    assert.equal((await fetch(f.base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
    await addProvider(f,mock);
    const projectId='prj_dot_qa';
    f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',projectId,'local-owner','Dot QA project','cloud',null,now(),now());
    f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','other-dot-owner','Other','user',now());
    f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)','prj_other_dot','other-dot-owner','Hidden','cloud',null,now(),now());
    const tokens=await authorize(f);
    assert.equal((await f.request('/dot/connection')).value.connected,true);
    const client=new Client({name:'dot-test',version:'1.0.0'});
    const transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}});
    await client.connect(transport);
    const tools=await client.listTools();
    assert.ok(tools.tools.some(tool=>tool.name==='start_project_task'));
    const list=await client.callTool({name:'list_projects',arguments:{}});
    assert.equal(list.structuredContent.projects.length,1);
    const denied=await client.callTool({name:'get_project',arguments:{projectId:'prj_other_dot'}});
    assert.equal(denied.isError,true);
    const started=await client.callTool({name:'start_project_task',arguments:{projectId,prompt:'Dot QA task'}});
    assert.ok(started.structuredContent.runId);
    await runState(f,started.structuredContent.runId,'completed');
    const status=await client.callTool({name:'get_task_status',arguments:{runId:started.structuredContent.runId}});
    assert.equal(status.structuredContent.run.status,'completed');
    await f.request('/dot/connection',{method:'DELETE'});
    assert.equal((await f.request('/dot/connection')).value.connected,false);
    await assert.rejects(()=>client.callTool({name:'list_projects',arguments:{}}));
    await client.close();
  }finally{await f.close();await mock.close();}
});

test('Dot read-only grant cannot start work and refresh tokens rotate',async()=>{
  const f=await fixture({dotClientMetadataFetch:clientMetadataFetch});
  try{
    const tokens=await authorize(f,'projects:read');
    const client=new Client({name:'dot-read-only',version:'1.0.0'});
    const transport=new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${tokens.access_token}`}}});
    await client.connect(transport);
    const names=(await client.listTools()).tools.map(tool=>tool.name);
    assert.ok(names.includes('list_projects'));
    assert.ok(!names.includes('start_project_task'));
    await client.close();
    const refresh=async value=>fetch(f.base+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form({grant_type:'refresh_token',client_id:'https://chatgpt.com/oauth/client.json',resource:'http://127.0.0.1:4581/mcp',refresh_token:value})});
    const next=await refresh(tokens.refresh_token);
    assert.equal(next.status,200);
    assert.equal((await next.json()).scope,'projects:read');
    assert.equal((await refresh(tokens.refresh_token)).status,400);
  }finally{await f.close();}
});
