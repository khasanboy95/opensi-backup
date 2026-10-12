import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {observeBrowser,browserAction,trackPage,captureBrowser,navigatePage} from '../connector/browser-engine.mjs';
import {computerAction} from '../server/computer.mjs';

const chrome=[process.env.CHROME_PATH,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));

test('navigation waits for a JavaScript page to render after the document loads', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext();
  await context.route('https://app.example.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<div id="root"></div><script>setTimeout(()=>document.querySelector("#root").textContent="Login ready",350)</script>'}));
  const page=await context.newPage();
  await navigatePage(page,'https://app.example.test/login');
  assert.match(await page.locator('body').innerText(),/Login ready/);
  await context.close();
 }finally{await browser.close();}
});

test('real public login capture redacts typed values without signing in or clicking tabs', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});try{
  const context=await browser.newContext({viewport:{width:1280,height:800}}),s={context,pages:new Map(),blocked:[],assets:new Map(),assetBytes:0,revision:'initial'};
  context.on('page',page=>trackPage(s,page));const page=await context.newPage();
  await page.setContent(`<h1>Public sign in</h1><form onsubmit="event.preventDefault();window.submits=(window.submits||0)+1"><input value="PRIVATE_USER" aria-label="Phone"><input type="password" value="PRIVATE_PASSWORD"><textarea style="width:200px;height:40px">PRIVATE_NOTE</textarea><div contenteditable="true" style="width:200px;height:40px">PRIVATE_EDIT</div><button>Sign in</button></form><button role="tab" type="button" onclick="window.tabClicks=(window.tabClicks||0)+1">Other tab</button>`);
  assert.equal((await captureBrowser(s,{maxScreens:1})).handoffRequired,true);
  const result=await captureBrowser(s,{maxScreens:1,publicPage:true});assert.equal(result.publicPage,true);assert.equal(result.frames.length,1);assert.equal(result.handoffRequired,undefined);
  for(const secret of ['PRIVATE_USER','PRIVATE_PASSWORD','PRIVATE_NOTE','PRIVATE_EDIT'])assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(await page.evaluate(()=>(window.submits||0)+(window.tabClicks||0)),0);assert.equal(await page.locator('input[type=password]').inputValue(),'PRIVATE_PASSWORD');
  await page.evaluate(()=>{for(const e of document.querySelectorAll('input,textarea'))e.value='';document.querySelector('[contenteditable]').textContent='';});
  const empty=await captureBrowser(s,{maxScreens:1,publicPage:true});assert.equal(result.frames[0].image,empty.frames[0].image,'redacted pixels must be identical regardless of typed field values');
  await context.close();
 }finally{await browser.close();}
});

test('computer action schema accepts coordinate, keyboard and tab actions with bounded arguments',()=>{
 assert.equal(computerAction.parse({action:'type_text',revision:'r1',value:'Salom'}).value,'Salom');
 assert.equal(computerAction.parse({action:'submit',target:1,revision:'r1'}).action,'submit');
 assert.equal(computerAction.parse({action:'check',target:1,revision:'r1'}).action,'check');
 assert.equal(computerAction.parse({action:'wheel',revision:'r1',deltaX:0,deltaY:500}).deltaY,500);
 assert.throws(()=>computerAction.parse({action:'wheel',deltaY:9000}));
 assert.throws(()=>computerAction.parse({action:'drag',x:99999}));
});

test('agent may navigate away from an unrelated login page to the requested public site', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:800,height:600}}),s={context,pages:new Map(),blocked:[],revision:'initial'};
  context.on('page',page=>trackPage(s,page));
  await context.route('https://public.example.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Public page</h1>'}));
  const page=await context.newPage();await page.setContent('<h1>Login</h1><input type="password">');
  assert.ok((await observeBrowser(s)).authRequired);
  const result=await browserAction(s,{action:'navigate',url:'https://public.example.test/news',actor:'agent'});
  assert.equal(result.url,'https://public.example.test/news');assert.match(result.text,/Public page/);
  await context.close();
 }finally{await browser.close();}
});

test('agent reads associated form labels, chooses options and submits once', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:800,height:600}}),s={context,pages:new Map(),blocked:[],revision:'initial'};
  context.on('page',page=>trackPage(s,page));
  let submits=0,posted='';
  await context.route('https://forms.example.test/**',async route=>{
   if(route.request().method()==='POST'){submits++;posted=route.request().postData()||'';await route.fulfill({status:200,contentType:'text/html',body:'<h1>Saved</h1>'});return;}
   await route.fulfill({status:200,contentType:'text/html',body:'<form method="post" action="/save"><label for="full-name">Full name</label><input id="full-name" name="name" required><label><input type="checkbox" name="agree" value="yes">Terms accepted</label><label for="plan">Plan</label><select id="plan" name="plan"><option value="a">Basic</option><option value="b">Business</option></select><button type="submit">Save form</button></form>'});
  });
  const page=await context.newPage();await page.goto('https://forms.example.test/form');
  let screen=await observeBrowser(s);
  const name=screen.elements.find(el=>el.label==='Full name');assert.equal(name?.required,true);
  screen=await browserAction(s,{action:'fill',target:name.id,revision:screen.revision,value:'Aziza',actor:'agent'});
  const terms=screen.elements.find(el=>el.label==='Terms accepted');assert.equal(terms?.checked,false);
  screen=await browserAction(s,{action:'check',target:terms.id,revision:screen.revision,actor:'agent'});
  assert.equal(screen.elements.find(el=>el.label==='Terms accepted').checked,true);
  const plan=screen.elements.find(el=>el.label==='Plan');assert.deepEqual(plan.options.map(o=>o.value),['a','b']);
  screen=await browserAction(s,{action:'select',target:plan.id,revision:screen.revision,value:'b',actor:'agent'});
  const submit=screen.elements.find(el=>el.label==='Save form');
  screen=await browserAction(s,{action:'submit',target:submit.id,revision:screen.revision,actor:'agent'});
  assert.equal(submits,1);assert.match(posted,/name=Aziza/);assert.match(posted,/agree=yes/);assert.match(posted,/plan=b/);assert.match(screen.text,/Saved/);
  await context.close();
 }finally{await browser.close();}
});

test('agent can submit a JavaScript form button but refuses destructive buttons', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:800,height:600}}),s={context,pages:new Map(),blocked:[],revision:'initial'};
  context.on('page',page=>trackPage(s,page));let submitted=0;
  await context.route('https://forms.example.test/**',async route=>{
   if(route.request().method()==='POST'){submitted++;await route.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'});return;}
   await route.fulfill({status:200,contentType:'text/html',body:'<label for="note">Note</label><input id="note"><button type="button" onclick="fetch(\'/save\',{method:\'POST\',body:document.querySelector(\'#note\').value}).then(() => document.querySelector(\'#status\').textContent=\'Saved\')">Save</button><button type="button">Delete</button><p id="status"></p>'});
  });
  const page=await context.newPage();await page.goto('https://forms.example.test/form');let screen=await observeBrowser(s);
  const note=screen.elements.find(el=>el.label==='Note');screen=await browserAction(s,{action:'fill',target:note.id,revision:screen.revision,value:'Text',actor:'agent'});
  const save=screen.elements.find(el=>el.label==='Save');screen=await browserAction(s,{action:'submit',target:save.id,revision:screen.revision,actor:'agent'});
  assert.equal(submitted,1);assert.match(screen.text,/Saved/);
  const remove=screen.elements.find(el=>el.label==='Delete');await assert.rejects(browserAction(s,{action:'submit',target:remove.id,revision:screen.revision,actor:'agent'}),/yuborish tugmasini/);
  await context.close();
 }finally{await browser.close();}
});

test('submit waits for the network write before reporting the result', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:800,height:600}}),s={context,pages:new Map(),blocked:[],revision:'initial'};
  context.on('page',page=>trackPage(s,page));let release,started;
  const pending=new Promise(resolve=>{started=resolve;});const hold=new Promise(resolve=>{release=resolve;});
  await context.route('https://forms.example.test/**',async route=>{
   if(route.request().method()==='POST'){s.waitingWrites=(s.waitingWrites||0)+1;started();try{await hold;await route.fulfill({status:200,contentType:'text/html',body:'<h1>Saved after approval</h1>'});}finally{s.waitingWrites--;}return;}
   await route.fulfill({status:200,contentType:'text/html',body:'<form method="post" action="/save"><button type="submit">Send</button></form>'});
  });
  const page=await context.newPage();await page.goto('https://forms.example.test/form');const screen=await observeBrowser(s);
  let done=false;const action=browserAction(s,{action:'submit',target:screen.elements.find(el=>el.label==='Send').id,revision:screen.revision,actor:'agent'}).then(value=>{done=true;return value;});
  await pending;await new Promise(resolve=>setTimeout(resolve,1100));try{assert.equal(done,false);}finally{release();}
  assert.match((await action).text,/Saved after approval/);
  await context.close();
 }finally{await browser.close();}
});

test('real browser supports pointer, keyboard, wheel, drag and tab handoff', {skip:!chrome},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true});
 try{
  const context=await browser.newContext({viewport:{width:500,height:400}});
  const s={context,pages:new Map(),blocked:[],revision:'initial'};
  context.on('page',page=>trackPage(s,page));
  const page=await context.newPage();
  await page.setContent(`<form onsubmit="event.preventDefault();document.querySelector('#status').textContent='sent:'+document.querySelector('#name').value"><input id="name" aria-label="Name"><button>Send</button></form><p id="status"></p><div id="box" style="height:100px;width:160px;overflow:auto"><div style="height:650px">Scroll me</div></div><div id="drag" style="width:80px;height:50px;background:teal" onpointerup="document.querySelector('#status').textContent='dragged'"></div>`);
  let screen=await observeBrowser(s);const input=screen.elements.find(el=>el.label==='Name');assert.ok(input?.inViewport);assert.ok(input.rect.width>0);
  screen=await browserAction(s,{action:'click_at',revision:screen.revision,x:input.rect.x+8,y:input.rect.y+8,actor:'user'});
  screen=await browserAction(s,{action:'type_text',revision:screen.revision,value:'Salom',actor:'user'});
  assert.equal(await page.locator('#name').inputValue(),'Salom');
  screen=await browserAction(s,{action:'key',revision:screen.revision,value:'Enter',actor:'user'});
  assert.match(screen.text,/sent:Salom/);
  const box=await page.locator('#box').boundingBox();assert.ok(box);
  screen=await browserAction(s,{action:'wheel',revision:screen.revision,x:Math.round(box.x+20),y:Math.round(box.y+20),deltaX:0,deltaY:300,actor:'user'});
  assert.ok(await page.locator('#box').evaluate(el=>el.scrollTop)>0);
  const drag=await page.locator('#drag').boundingBox();assert.ok(drag);
  screen=await browserAction(s,{action:'drag',revision:screen.revision,x:Math.round(drag.x+10),y:Math.round(drag.y+10),toX:Math.round(drag.x+35),toY:Math.round(drag.y+20),actor:'user'});
  assert.match(screen.text,/dragged/);
  const previousRevision=screen.revision;
  screen=await browserAction(s,{action:'new_tab',actor:'user'});assert.equal(screen.tabs.length,2);
  await assert.rejects(browserAction(s,{action:'click_at',revision:previousRevision,x:10,y:10,actor:'user'}),/eskirgan/);
  const first=screen.tabs.find(tab=>!tab.active),second=screen.tabs.find(tab=>tab.active);assert.ok(first&&second);
  screen=await browserAction(s,{action:'switch_tab',tab:first.id,actor:'user'});assert.match(screen.text,/dragged/);
  screen=await browserAction(s,{action:'close_tab',tab:second.id,actor:'user'});assert.equal(screen.tabs.length,1);
  await assert.rejects(browserAction(s,{action:'close_tab',actor:'user'}),/Oxirgi tab/);
  await context.close();
 }finally{await browser.close();}
});
