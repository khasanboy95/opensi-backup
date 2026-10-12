import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './helpers.mjs';
import {token,hash,now,id} from '../server/security.mjs';

const CLIENT_SECRET='qa-vercel-client-secret-only';
const USER_TOKEN='qa-user-a-vercel-access-token';

function user(f,userId,role='user'){
 f.store.exec('INSERT INTO users(id,google_sub,email,name,role,created_at) VALUES(?,?,?,?,?,?)',userId,`google-${userId}`,`${userId}@example.test`,userId,role,now());
 const session=token();f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),userId,Date.now()+60000);
 return {cookie:`opensi_session=${session}`};
}

test('Vercel browser authorization is single-use, scoped to the Google user, and deploys with that account',async()=>{
 const calls=[];
 const fetcher=async(input,options)=>{
  const url=new URL(input);calls.push({url:url.toString(),headers:options.headers,body:options.body});
  if(url.pathname==='/v2/oauth/access_token'){
   const form=new URLSearchParams(options.body);
   assert.equal(form.get('client_id'),'qa-client');assert.equal(form.get('client_secret'),CLIENT_SECRET);
   assert.equal(form.get('redirect_uri'),'http://127.0.0.1:4581/api/integrations/vercel/callback');
   return Response.json({access_token:USER_TOKEN,team_id:'team_abc'});
  }
  assert.equal(options.headers.authorization,`Bearer ${USER_TOKEN}`);
  assert.equal(url.searchParams.get('teamId'),'team_abc');
  if(url.pathname==='/v9/projects')return Response.json({projects:[]});
  if(url.pathname==='/v11/projects')return Response.json({id:'prj_vercel_oauth'});
  if(url.pathname==='/v2/files')return Response.json({});
  if(url.pathname==='/v13/deployments')return Response.json({id:'dpl_vercel_oauth',url:'oauth-qa.vercel.app',readyState:'BUILDING'});
  throw new Error('Unexpected Vercel endpoint');
 };
 const f=await fixture({localAuth:false,vercelClientId:'qa-client',vercelClientSecret:CLIENT_SECRET,vercelIntegrationSlug:'opensi-qa',automationFetch:fetcher});
 try{
  const a=user(f,'oauth-a'),b=user(f,'oauth-b');
  const status=await f.request('/integrations/vercel/status',{headers:a});assert.equal(status.value.configured,true);
  const start=await f.request('/integrations/vercel/connect',{method:'POST',body:{},headers:a});assert.equal(start.status,200);
  const state=new URL(start.value.url).searchParams.get('state');assert.match(state,/^[A-Za-z0-9_-]{43}$/);
  const callback=`/integrations/vercel/callback?state=${state}&code=valid-code-123&source=external&configurationId=icfg_abc&teamId=team_abc`;
  assert.equal((await f.request(callback,{headers:b})).status,400);
  const result=await f.request(callback,{headers:a});assert.equal(result.status,303);
  assert.equal((await f.request(callback,{headers:a})).status,400);
  const listed=(await f.request('/integrations',{headers:a})).value.connections;
  assert.equal(listed.length,1);assert.equal(listed[0].kind,'vercel');assert.equal(listed[0].automatic,true);
  assert.equal(listed[0].teamId,'team_abc');assert.ok(!JSON.stringify(listed).includes(USER_TOKEN));
  assert.equal((await f.request('/integrations',{headers:b})).value.connections.length,0);
  assert.ok(!f.store.one('SELECT secret FROM integrations WHERE id=?',listed[0].id).secret.includes(USER_TOKEN));
  assert.equal(calls.filter(call=>call.url.includes('/v2/oauth/access_token')).length,1);
  const restart=await f.request('/integrations/vercel/connect',{method:'POST',body:{},headers:a});
  const state2=new URL(restart.value.url).searchParams.get('state');
  const again=await f.request(`/integrations/vercel/callback?state=${state2}&code=valid-code-456&source=external&configurationId=icfg_abc&teamId=team_abc`,{headers:a});
  assert.equal(again.status,303);assert.equal((await f.request('/integrations',{headers:a})).value.connections.length,1);
  const project={id:id('prj_'),user_id:'oauth-a',title:'OAuth deployment',environment:'cloud',node_id:null};
  f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',project.id,project.user_id,project.title,project.environment,null,now(),now());
  f.store.exec('INSERT INTO project_execution VALUES(?,?)',project.id,'automatic');
  const root=path.join(f.dataDir,'workspaces',project.user_id,project.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'index.html'),'<h1>OAuth deployment</h1>');
  const deployed=await f.automation.tool('deploy_vercel',{connectionId:listed[0].id,requestId:'oauth-deploy',framework:'static'}, {id:id('run_'),user_id:project.user_id,project_id:project.id},project,AbortSignal.timeout(30000));
  assert.equal(deployed.status,'BUILDING');assert.equal(deployed.url,'https://oauth-qa.vercel.app');
  assert.ok(calls.some(call=>call.url.includes('/v13/deployments')));
 }finally{await f.close();}
});

test('Vercel connection is unavailable without server integration and rejects forged callback',async()=>{
 const f=await fixture({localAuth:false});
 try{
  const a=user(f,'oauth-empty');
  assert.equal((await f.request('/integrations/vercel/status',{headers:a})).value.configured,false);
  assert.equal((await f.request('/integrations/vercel/connect',{method:'POST',body:{},headers:a})).status,503);
  assert.equal((await f.request('/integrations/vercel/callback?state=forged&code=anything',{headers:a})).status,400);
 }finally{await f.close();}
});

test('only admin can save OAuth settings, secret stays encrypted, and users can connect without token entry',async()=>{
 const calls=[];
 const f=await fixture({localAuth:false,automationFetch:async(input,options)=>{
  const url=new URL(input);calls.push(url.pathname);
  if(url.pathname==='/v2/oauth/access_token'){
   const form=new URLSearchParams(options.body);
   assert.equal(form.get('client_id'),'qa-admin-client');
   assert.equal(form.get('client_secret'),CLIENT_SECRET);
   return Response.json({access_token:USER_TOKEN});
  }
  if(url.pathname==='/v9/projects'){
   assert.equal(options.headers.authorization,`Bearer ${USER_TOKEN}`);
   return Response.json({projects:[]});
  }
  throw new Error('Unexpected Vercel endpoint');
 }});
 try{
  const admin=user(f,'oauth-admin','admin'),ordinary=user(f,'oauth-ordinary');
  assert.equal((await f.request('/integrations/vercel/admin-settings',{headers:ordinary})).status,403);
  assert.equal((await f.request('/integrations/vercel/admin-settings',{method:'PUT',headers:ordinary,body:{clientId:'qa-admin-client',clientSecret:CLIENT_SECRET,slug:'opensi-qa'}})).status,403);
  assert.equal((await f.request('/integrations/vercel/status',{headers:ordinary})).value.configured,false);
  const saved=await f.request('/integrations/vercel/admin-settings',{method:'PUT',headers:admin,body:{clientId:'qa-admin-client',clientSecret:CLIENT_SECRET,slug:'opensi-qa'}});
  assert.equal(saved.status,200);assert.equal(saved.value.configured,true);
  const raw=f.store.one('SELECT value FROM settings WHERE key=?','vercel-oauth').value;
  assert.ok(!raw.includes(CLIENT_SECRET));
  const settings=await f.request('/integrations/vercel/admin-settings',{headers:admin});
  assert.equal(settings.value.hasSecret,true);assert.equal(settings.value.clientId,'qa-admin-client');
  assert.ok(!JSON.stringify(settings.value).includes(CLIENT_SECRET));
  assert.equal((await f.request('/integrations/vercel/status',{headers:ordinary})).value.configured,true);
  assert.equal((await f.request('/integrations/vercel/admin-settings',{method:'PUT',headers:admin,body:{clientId:'qa-admin-client',slug:'opensi-qa'}})).status,200);
  const start=await f.request('/integrations/vercel/connect',{method:'POST',headers:ordinary,body:{}});
  assert.equal(start.status,200);
  assert.equal(new URL(start.value.url).pathname,'/integrations/opensi-qa/new');
  const state=new URL(start.value.url).searchParams.get('state');
  const callback=await f.request(`/integrations/vercel/callback?state=${state}&code=valid-code-123&source=external`,{headers:ordinary});
  assert.equal(callback.status,303);
  assert.deepEqual(calls,['/v2/oauth/access_token','/v9/projects']);
  assert.equal((await f.request('/integrations',{headers:ordinary})).value.connections.length,1);
  assert.equal((await f.request('/integrations',{headers:admin})).value.connections.length,0);
 }finally{await f.close();}
});
