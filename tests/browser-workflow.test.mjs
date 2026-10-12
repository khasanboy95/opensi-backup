import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,mockProvider,addProvider,createRun,runState,until} from './helpers.mjs';
import {id,now} from '../server/security.mjs';
import {browserWriteAllowed,ordinaryFormWriteAllowed,formSubmissionIntent,sensitiveBrowserScreen,vercelDeploymentIntent,safeBrowserUrl,browserTelemetry,publicLoginCaptureIntent} from '../server/browser-workflow.mjs';

test('automatic form writes require an explicit human write instruction',()=>{
 for(const prompt of ['Submit the contact form','Saytga ma’lumotni qo‘sh','Mahsulotni saqla','Fill out and send the application'])assert.equal(formSubmissionIntent(prompt),true,prompt);
 for(const prompt of ['Read the contact form','Faqat ko‘r va ayt','Do not submit anything','Only inspect the website'])assert.equal(formSubmissionIntent(prompt),false,prompt);
});

test('one form action permits a single ordinary write only to its own origin',()=>{
 const scope={mode:'agent',formWrite:{origin:'https://forms.example',remaining:1,expiresAt:Date.now()+5000}};
 assert.equal(ordinaryFormWriteAllowed(scope,{method:'POST',url:'https://forms.example/save'},true),true);
 for(const request of [
  {method:'POST',url:'https://api.forms.example/save'},
  {method:'POST',url:'https://forms.example/checkout'},
  {method:'DELETE',url:'https://forms.example/save'},
  {method:'POST',url:'https://forms.example.evil.test/save'}
 ])assert.equal(ordinaryFormWriteAllowed(scope,request,true),false);
 assert.equal(ordinaryFormWriteAllowed(scope,{method:'POST',url:'https://forms.example/save'},false),false);
 scope.formWrite.remaining=0;assert.equal(ordinaryFormWriteAllowed(scope,{method:'POST',url:'https://forms.example/save'},true),false);
 scope.formWrite.remaining=1;scope.formWrite.expiresAt=Date.now()-1;assert.equal(ordinaryFormWriteAllowed(scope,{method:'POST',url:'https://forms.example/save'},true),false);
});

test('public login capture is chosen only for an explicit login-only task',()=>{
 for(const prompt of ['faqat login pageni clone qil','https://example.com/login clone only the login page','faqat kirish sahifasi kerak','https://example.com/login — faqat login sahifasini clone qil. Hisobga kirish kerak emas. Mavjud fayllardan davom et.'])assert.equal(publicLoginCaptureIntent(prompt),true);
 for(const prompt of ['clone https://example.com/login fully','clone not only login but also dashboard','faqat login emas, ichki bo‘limlari ham kerak'])assert.equal(publicLoginCaptureIntent(prompt),false);
});

test('browser deploy grants are task-scoped and exclude unrelated hosts, account changes and expired tasks',()=>{
 assert.equal(vercelDeploymentIntent('Vercelga deploy qil'),true);
 assert.equal(vercelDeploymentIntent('vercel deploy qil'),true);assert.equal(vercelDeploymentIntent('Vercel login och, deploy qilma'),false);assert.equal(vercelDeploymentIntent('Explain how to deploy to Vercel'),false);
 const scope={mode:'agent',deploymentRun:'run'};
 for(const url of ['https://api.vercel.com/v13/deployments','https://vercel.com/api/v2/files','https://api.vercel.com/v9/projects'])assert.equal(browserWriteAllowed(scope,{method:'POST',url},true),true,url);
 for(const url of ['https://evil.vercel.com/v13/deployments','https://vercel.com.evil.test/v13/deployments','https://api.vercel.com/v1/billing','https://api.vercel.com/v1/tokens'])assert.equal(browserWriteAllowed(scope,{method:'POST',url},true),false,url);
 assert.equal(browserWriteAllowed(scope,{method:'DELETE',url:'https://api.vercel.com/v13/deployments'},true),false);
 assert.equal(browserWriteAllowed(scope,{method:'POST',url:'https://api.vercel.com/v13/deployments'},false),false);
 assert.equal(browserWriteAllowed({mode:'user',manualOrigin:'https://vercel.com',manualUntil:Date.now()+1000},{method:'POST',url:'https://accounts.google.com/signin'},false),true);
 assert.equal(safeBrowserUrl('https://vercel.com/login?code=PRIVATE'),'https://vercel.com/login');
 assert.equal(safeBrowserUrl('about:blank'),'about:blank');
 assert.equal(sensitiveBrowserScreen({url:'about:blank',elements:[]}),null);
 assert.ok(sensitiveBrowserScreen({url:'https://vercel.com',title:'Vercel Security Checkpoint',elements:[]}));
 assert.equal(browserTelemetry('https://o123.ingest.sentry.io/api/42/envelope/'),true);
 assert.equal(browserTelemetry('https://api.vercel.com/v13/deployments'),false);
 assert.ok(sensitiveBrowserScreen({url:'https://vercel.com/login',elements:[]}));
 assert.ok(sensitiveBrowserScreen({url:'https://x.com/i/flow/login',elements:[]}));
 assert.ok(sensitiveBrowserScreen({url:'https://x.com/i/jf/onboarding/web?mode=login',elements:[]}));
 assert.ok(sensitiveBrowserScreen({url:'https://x.com/',text:'Email or username\nContinue',elements:[{tag:'input',label:'Email or username'}]}));
 assert.ok(sensitiveBrowserScreen({url:'https://x.com/',text:'Continue with phone\nEmail or username',elements:[{tag:'input',type:'text',label:''}]}));
 assert.equal(sensitiveBrowserScreen({url:'https://x.com/home',text:'Latest posts',elements:[{tag:'input',label:'Search'}]}),null);
 assert.ok(sensitiveBrowserScreen({url:'https://example.com',elements:[{type:'password'}]}));
 assert.equal(sensitiveBrowserScreen({url:'https://vercel.com/dashboard',elements:[]}),null);
 assert.equal(browserWriteAllowed({mode:'user',manualOrigin:'https://x.com',manualUntil:Date.now()+1000},{method:'POST',url:'https://api.x.com/login'},false),true);
 assert.equal(browserWriteAllowed({mode:'user',manualOrigin:'https://x.com',manualUntil:Date.now()+1000},{method:'POST',url:'https://evil.x.com.attacker.test/login'},false),false);
});

test('agent pauses at login, releases control, rejects early resume and continues same tool without replay or credential history',async()=>{
 let login=false;const commands=[];
 const runtime=http.createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);commands.push({route:req.url,body});if(req.url==='/action')login=body.actor==='agent';res.setHeader('content-type','application/json');res.end(JSON.stringify({url:login?'https://vercel.com/login?code=PRIVATE':'https://vercel.com/dashboard',title:'Browser',text:login?'LOGIN_PRIVATE':'Dashboard',revision:'rev-1',elements:login?[{id:1,type:'password',label:'Password'}]:[{id:1,tag:'button',label:'Deploy'}],image:'aW1hZ2U=',blocked:[]}));});runtime.listen(0,'127.0.0.1');await new Promise(r=>runtime.once('listening',r));
 const f=await fixture({computerUrl:`http://127.0.0.1:${runtime.address().port}`,runnerToken:'qa-browser-workflow'}),mock=await mockProvider();try{
  const provider=await addProvider(f,mock);const {run,project}=await createRun(f,provider,'_COMPUTER_APPROVAL_ vercel deploy qil',{autonomy:'automatic'});
  const waiting=await runState(f,run.id,'waiting_input');const approval=waiting.approvals[0];assert.equal(approval.tool,'computer_login');assert.ok(!JSON.stringify(waiting).includes('LOGIN_PRIVATE'));assert.ok(!JSON.stringify(waiting).includes('code=PRIVATE'));
  const p=project||f.store.one('SELECT * FROM projects WHERE id=?',run.project_id);
  const state=(await f.request(`/projects/${p.id}/computer`)).value.session;assert.equal(state.mode,'user');assert.equal(state.handoff.approvalId,approval.id);
  assert.equal((await f.request(`/projects/${p.id}/computer/resume`,{method:'POST',body:{}})).status,409);
  assert.equal((await f.request('/approvals/'+approval.id,{method:'POST',body:{approved:true}})).status,409);
  const stillWaiting=await runState(f,run.id,'waiting_input');assert.equal(stillWaiting.approvals.filter(a=>a.status==='pending').length,1);assert.equal(stillWaiting.approvals.find(a=>a.status==='pending').id,approval.id);
  assert.equal(f.store.one('SELECT COUNT(*) AS count FROM approvals WHERE run_id=?',run.id).count,1,'early continue must not churn login approvals');
  const action=await f.request(`/projects/${p.id}/computer/action`,{method:'POST',body:{action:'fill',target:1,revision:'rev-1',value:'QA_PASSWORD_NOT_REAL'}});assert.equal(action.status,200);
  assert.equal((await f.request(`/projects/${p.id}/computer/resume`,{method:'POST',body:{}})).status,200);
  assert.equal((await f.request(`/projects/${p.id}/computer`)).value.session.mode,'user','readiness check alone must not release the agent');
  assert.equal((await f.request(`/projects/${p.id}/computer/control`,{method:'POST',body:{mode:'agent'}})).status,409);
  assert.equal((await f.request('/approvals/'+approval.id,{method:'POST',body:{approved:true}})).status,200);const done=await runState(f,run.id,'completed');
  assert.equal(commands.filter(c=>c.route==='/action'&&c.body.actor==='agent').length,1,'submitted click must not be replayed');
  assert.equal(f.store.one("SELECT COUNT(*) AS count FROM computer_audit WHERE project_id=? AND action='login_resumed'",p.id).count,1);
  assert.ok(!JSON.stringify(done).includes('QA_PASSWORD_NOT_REAL'));assert.ok(!JSON.stringify(mock.requests).includes('LOGIN_PRIVATE'));assert.ok(!JSON.stringify(f.store.all('SELECT * FROM computer_audit')).includes('QA_PASSWORD_NOT_REAL'));
 }finally{await mock.close();await f.close();runtime.closeAllConnections();await new Promise(r=>runtime.close(r));}
});

test('manual control cannot return to the agent while an X login form remains open',async()=>{
 const runtime=http.createServer(async(req,res)=>{
  for await(const _ of req){}
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({url:'https://x.com/',title:'X',text:'Continue with phone\nEmail or username',revision:'rev-x',elements:[{id:1,tag:'input',type:'text',label:''}],image:'aW1hZ2U=',blocked:[]}));
 });
 runtime.listen(0,'127.0.0.1');await new Promise(r=>runtime.once('listening',r));
 const f=await fixture({computerUrl:`http://127.0.0.1:${runtime.address().port}`,runnerToken:'qa-x-login'});
 try{
  const user=(await f.request('/me')).value.user,project=id('prj_');
  f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',project,user.id,'X login','cloud',now(),now());
  await f.computer.ensureAgent(user.id,project);
  assert.equal((await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'user'}})).status,200);
  assert.equal((await f.request(`/projects/${project}/computer/control`,{method:'POST',body:{mode:'agent'}})).status,409);
  assert.equal((await f.request(`/projects/${project}/computer`)).value.session.mode,'user');
 }finally{await f.close();runtime.closeAllConnections();await new Promise(r=>runtime.close(r));}
});

test('two simultaneous login continue requests resolve one approval and never release it twice',async()=>{
 const f=await fixture({computerUrl:'http://127.0.0.1:1',runnerToken:'qa'}),mock=await mockProvider();let release;
 try{
  let finishCalls=0;f.computer.ensureAgent=async()=>{};f.computer.beginHandoff=()=>{};
  f.computer.tool=async name=>name==='computer_action'?{handoffRequired:true,reason:'Login'}:{url:'https://example.com/dashboard',pending:[]};
  f.computer.finishHandoff=async()=>{finishCalls++;if(finishCalls===1)await new Promise(r=>{release=r;});};
  const provider=await addProvider(f,mock);const {run}=await createRun(f,provider,'_COMPUTER_APPROVAL_',{autonomy:'automatic'});
  const waiting=await runState(f,run.id,'waiting_input'),approval=waiting.approvals[0];
  const first=f.request('/approvals/'+approval.id,{method:'POST',body:{approved:true}});await until(()=>release);
  assert.equal((await f.request('/approvals/'+approval.id,{method:'POST',body:{approved:true}})).status,409);
  assert.equal(f.store.one('SELECT status FROM approvals WHERE id=?',approval.id).status,'pending');
  release();assert.equal((await first).status,200);await runState(f,run.id,'completed');
  assert.equal(f.store.all("SELECT id FROM events WHERE run_id=? AND type='approval_resolved'",run.id).length,1);
 }finally{release?.();await mock.close();await f.close();}
});

test('local browser command values and screenshots never persist in command rows',async()=>{
 const f=await fixture();try{
  const pair=(await f.request('/nodes/pair-code',{method:'POST',body:{}})).value;
  const paired=(await f.request('/connector/pair',{method:'POST',body:{code:pair.code,name:'Browser QA',platform:'win32',workspace:'QA'}})).value;
  const node=f.nodes.authenticate({get:()=>`Bearer ${paired.token}`});f.nodes.heartbeat(node,['computer_browser_v1']);
  const p={id:id('prj_'),user_id:node.user_id,node_id:node.id,environment:'local'};f.store.exec('INSERT INTO projects VALUES(?,?,?,?,?,?,?)',p.id,p.user_id,'Local browser','local',node.id,now(),now());
  const pending=f.nodes.dispatch(p,null,'computer_browser',{route:'/action',body:{value:'PRIVATE_TYPED_VALUE'}});
  const command=await until(()=>f.nodes.poll(node).command);assert.equal(command.args.body.value,'PRIVATE_TYPED_VALUE');
  assert.equal(f.store.one('SELECT args FROM commands WHERE id=?',command.id).args,'{}');
  f.nodes.result(node,command.id,{text:'PRIVATE_SCREEN',image:'PRIVATE_IMAGE'});assert.equal(f.store.one('SELECT result FROM commands WHERE id=?',command.id).result,null);
  assert.equal((await pending).text,'PRIVATE_SCREEN');assert.equal(f.store.one('SELECT args FROM commands WHERE id=?',command.id).args,'{}');
 }finally{await f.close();}
});
