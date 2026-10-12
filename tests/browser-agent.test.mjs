import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {browserAgentTool} from '../server/browser-agent.mjs';
import {fixture} from './helpers.mjs';
import {id,now} from '../server/security.mjs';
import {projectRoot} from '../server/files.mjs';
const signal=()=>new AbortController().signal;
const input=computer=>({computer,name:'computer_capture',args:{url:'https://example.com/login'},run:{id:'qa',user_id:'owner'},project:{id:'project'},signal:signal(),approval:async()=>({approved:true})});

test('login-only tasks capture the public form rather than crawling behind it or asking to authenticate',async()=>{
 let call;const computer={tool:async(name,args)=>{call={name,args};return {publicPage:true,frames:[]};},beginHandoff(){throw Error('must not request login');}};
 const result=await browserAgentTool({...input(computer),name:'computer_explore',args:{url:'https://example.com/login',maxPages:4,maxDepth:3,mobile:true,maxScreens:2},publicPage:true});
 assert.equal(call.name,'computer_capture');assert.deepEqual(call.args,{url:'https://example.com/login',mobile:true,maxScreens:2,publicPage:true});assert.equal(result.publicPage,true);
});

test('login handoff waits for real completion then resumes the requested capture rather than losing it',async()=>{
 const calls=[],recovered=[];let finishes=0,approvals=0;
 const computer={tool:async(name,args)=>{calls.push({name,args});return calls.length===1?{handoffRequired:true,resumeCurrentPage:true,reason:'Login',url:'https://example.com/login'}:{manifestPath:'inputs/actual/manifest.json',frames:[{screenshot:'inputs/actual/1.png'}]};},beginHandoff(){},finishHandoff:async()=>{if(!finishes++)throw Object.assign(Error('Kirish hali ochiq'),{status:409});}};
 const result=await browserAgentTool({...input(computer),approval:async()=>{approvals++;return {approved:true};},onRecovery:r=>recovered.push(r)});
 assert.equal(approvals,2);assert.equal(calls.length,2);assert.equal(calls[1].name,'computer_capture');assert.equal(calls[1].args.url,undefined);assert.ok(result.manifestPath);assert.equal(recovered[0].kind,'browser_resumed');
});
test('an unrelated existing login does not replace the original requested destination',async()=>{
 const urls=[];const computer={tool:async(name,args)=>{urls.push(args.url);return urls.length===1?{handoffRequired:true,reason:'Existing login'}:{ok:true};},beginHandoff(){},finishHandoff:async()=>{}};
 await browserAgentTool(input(computer));assert.deepEqual(urls,['https://example.com/login','https://example.com/login']);
});
test('declined login and cancelled reads never launch another operation',async()=>{
 let calls=0;const computer={tool:async()=>{calls++;return {handoffRequired:true};},beginHandoff(){},finishHandoff(){throw Error('must not resume');}};
 assert.equal((await browserAgentTool({...input(computer),approval:async()=>({approved:false})})).denied,true);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(browserAgentTool({...input(computer),signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);
});
test('only transient read errors get one retry; external actions and access denials are never replayed',async()=>{
 let calls=0;const computer={tool:async()=>{if(!calls++)throw Object.assign(Error('Browser unavailable'),{status:503});return {ok:true};}};
 assert.equal((await browserAgentTool(input(computer))).ok,true);assert.equal(calls,2);
 for(const [name,status,message] of [['computer_action',503,'Browser unavailable'],['computer_capture',403,'Forbidden'],['computer_capture',503,'permission denied']]){
  calls=0;computer.tool=async()=>{calls++;throw Object.assign(Error(message),{status});};await assert.rejects(browserAgentTool({...input(computer),name}));assert.equal(calls,1);
 }
 calls=0;computer.tool=async()=>{calls++;throw Object.assign(Error('Unavailable'),{status:503});};await assert.rejects(browserAgentTool(input(computer)));assert.equal(calls,2);
});

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII=';
async function browserFixture({nestedLogin=false,startOnLogin=false}={}){
 let url=startOnLogin?'https://example.com/login':'about:blank',authenticated=false,secondLogin=false;const captures=[];
 const runtime=http.createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);res.setHeader('content-type','application/json');
  if(req.url==='/capture'){
   captures.push(body.url||'CURRENT');url=body.url||url;
   if(url.endsWith('/login')&&!authenticated||nestedLogin&&url.endsWith('/category')&&!secondLogin){url='https://example.com/login';return res.end(JSON.stringify({handoffRequired:true,reason:'Login',url}));}
   const links=url.endsWith('/dashboard')?[{url:'https://example.com/category',text:'Category'},{url:'https://example.com/other',text:'Other'},{url:'https://example.com/logout',text:'Logout'}]:[];
   return res.end(JSON.stringify({url,atBottom:true,frames:[{image:png,design:{links,styles:[]}}],assets:[]}));
  }
  res.end(JSON.stringify({url,title:'Browser',elements:[],revision:'r1',blocked:[]}));
 });
 await new Promise(r=>runtime.listen(0,'127.0.0.1',r));
 const f=await fixture({computerUrl:`http://127.0.0.1:${runtime.address().port}`,runnerToken:'qa-login'});await f.request('/me');
 const project={id:id('prj_'),user_id:'local-owner',environment:'cloud'};f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',project.id,project.user_id,'Browser recovery QA','cloud',now(),now());
 return {f,project,captures,authenticate(){if(authenticated){secondLogin=true;url='https://example.com/category';}else{authenticated=true;url='https://example.com/dashboard';}},close:async()=>{await f.close();runtime.closeAllConnections();await new Promise(r=>runtime.close(r));}};
}
test('a login source opens for the user and then captures authenticated pages and their actual files in the same project',async()=>{
 const x=await browserFixture();try{
  let approvals=0;const result=await browserAgentTool({computer:x.f.computer,name:'computer_explore',args:{url:' example.com/login ',maxPages:4,maxScreens:1},run:{id:'qa',user_id:'local-owner'},project:x.project,signal:signal(),automatic:true,approval:async()=>{approvals++;x.authenticate();return {approved:true};}});
  assert.equal(approvals,1);assert.deepEqual(result.visited.map(p=>p.url),['https://example.com/dashboard','https://example.com/category','https://example.com/other']);assert.equal(result.complete,true);
  assert.equal(x.captures.filter(u=>u.trim().endsWith('/login')).length,1);assert.ok(!x.captures.some(u=>u.endsWith('/logout')));
  const manifest=JSON.parse(await readFile(path.join(projectRoot(x.f.config,x.project),result.index),'utf8'));assert.equal(manifest.pages.length,3);
  const screenshot=await readFile(path.join(projectRoot(x.f.config,x.project),manifest.pages[0].frames[0].screenshot));assert.equal(screenshot.toString('base64'),png);
 }finally{await x.close();}
});
test('an authentication interruption inside exploration preserves previously visited pages and the remaining queue',async()=>{
 const x=await browserFixture({nestedLogin:true});try{
  x.authenticate();const result=await browserAgentTool({computer:x.f.computer,name:'computer_explore',args:{url:'https://example.com/dashboard',maxPages:4,maxScreens:1},run:{id:'qa',user_id:'local-owner'},project:x.project,signal:signal(),automatic:true,approval:async()=>{x.authenticate();return {approved:true};}});
  assert.equal(result.complete,true);assert.deepEqual(result.visited.map(p=>p.url),['https://example.com/dashboard','https://example.com/category','https://example.com/other']);assert.equal(x.captures.filter(u=>u.endsWith('/dashboard')).length,1);
 }finally{await x.close();}
});
test('an already-open login page resumes without navigating back to the login route',async()=>{
 const x=await browserFixture({startOnLogin:true});try{
  let approvals=0;const result=await browserAgentTool({computer:x.f.computer,name:'computer_explore',args:{url:'https://example.com/login',maxPages:4,maxScreens:1},run:{id:'qa',user_id:'local-owner'},project:x.project,signal:signal(),automatic:true,approval:async()=>{approvals++;x.authenticate();return {approved:true};}});
  assert.equal(approvals,1);assert.equal(result.complete,true);assert.equal(result.visited[0].url,'https://example.com/dashboard');assert.equal(x.captures[0],'CURRENT');assert.ok(!x.captures.some(u=>u.endsWith('/login')));
 }finally{await x.close();}
});
