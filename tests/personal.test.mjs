import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,mockProvider,addProvider,createRun,runState} from './helpers.mjs';
import {personalState,personalContext,savePersonal,memoryText} from '../server/personal.mjs';
import {token,hash,now} from '../server/security.mjs';
import {chromeExecutable} from '../connector/chrome.mjs';
import {connectorLock} from '../connector/instance-lock.mjs';

test('personal conversation reuses project and prior context with automatic bounded memory',async()=>{
 const f=await fixture(),mock=await mockProvider();try{
  const provider=await addProvider(f,mock);
  assert.equal((await f.request('/personal',{method:'PUT',body:{enabled:true,notes:'Javoblar o‘zbek tilida bo‘lsin.'}})).status,200);
  const first=await createRun(f,provider,'Persistent QA first turn',{personal:true});await runState(f,first.run.id,'completed');
  const second=await createRun(f,provider,'Continue second turn',{personal:true});await runState(f,second.run.id,'completed');
  assert.equal(first.project.id,second.project.id);
  const state=(await f.request('/personal')).value;assert.equal(state.lastRun.id,second.run.id);assert.equal(state.episodes.length,2);
  const model=mock.requests.at(-1);assert.ok(JSON.stringify(model.messages).includes('Persistent QA first turn'));assert.ok(model.messages[0].content.includes('Javoblar o‘zbek tilida'));
  assert.ok(model.tools.some(t=>t.function.name==='conversation_search'));
  const other=await createRun(f,provider,'A separate project');await runState(f,other.run.id,'completed');assert.notEqual(other.project.id,first.project.id);
  assert.equal((await f.request('/personal/memory/'+first.run.id,{method:'DELETE'})).status,200);
  assert.ok(!(await f.request('/personal')).value.episodes.some(e=>e.runId===first.run.id));
  await f.request('/personal/memory',{method:'DELETE'});assert.equal(personalContext(f.store,'local-owner',first.project.id),'');
  const third=await createRun(f,provider,'After forgetting',{personal:true});await runState(f,third.run.id,'completed');
  assert.equal(personalState(f.store,'local-owner').episodes.length,0);assert.equal(third.project.id,first.project.id);
 }finally{await mock.close();await f.close();}
});

test('personal memory is owner scoped, rejects credentials and preserves disabled memory state',async()=>{
 const f=await fixture({localAuth:false});try{
  const auth=user=>{f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)',user,user,'user',now());const s=token();f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(s),user,Date.now()+60000);return {cookie:'opensi_session='+s};};
  const a=auth('memory-a'),b=auth('memory-b');
  assert.equal((await f.request('/personal')).status,401);
  assert.equal((await f.request('/personal',{method:'PUT',headers:a,body:{enabled:true,notes:'Only account A'}})).status,200);
  assert.equal((await f.request('/personal',{headers:b})).value.notes,'');
  await f.request('/personal/memory',{method:'DELETE',headers:b});assert.equal((await f.request('/personal',{headers:a})).value.notes,'Only account A');
  assert.equal((await f.request('/personal',{method:'PUT',headers:a,body:{enabled:true,notes:'password: PRIVATE_QA_VALUE'}})).status,400);
  assert.ok(!memoryText('safe\npassword: PRIVATE_QA_VALUE\nhttps://example.com/?token=PRIVATE').includes('PRIVATE'));
  savePersonal(f.store,'memory-a',{enabled:true,notes:'Only account A',projectId:null,episodes:Array.from({length:40},(_,i)=>({runId:String(i),projectId:'p',request:'context '+i,outcome:'result'}))});
  const context=personalContext(f.store,'memory-a','p');assert.ok(context.length<16000);assert.equal((context.match(/runId/g)||[]).length,6);assert.ok(!personalContext(f.store,'memory-b','p').includes('Only account A'));
 }finally{await f.close();}
});

test('local computer opens Chrome and never silently chooses Edge',()=>{
 const args={platform:'win32',env:{PROGRAMFILES:'C:/Programs',LOCALAPPDATA:'C:/Local'},exists:p=>p.includes('Google')};
 assert.ok(chromeExecutable(args).includes('Google'));
 assert.throws(()=>chromeExecutable({...args,exists:p=>p.includes('Edge')}),/Chrome/);
});

test('connector instance lock rejects competing worker and releases for restart',async()=>{
 const key='instance-lock-qa-'+process.pid;const release=await connectorLock(key);
 try{await assert.rejects(connectorLock(key),/Ikkinchi nusxa/);}finally{await release();}
 const second=await connectorLock(key);await second();
});
