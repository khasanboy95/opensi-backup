import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixture} from './helpers.mjs';
import {saveBrowserEvidence,evidenceType} from '../server/browser-evidence.mjs';
import {id,now} from '../server/security.mjs';
import {projectRoot} from '../server/files.mjs';
import {computerCapture} from '../server/computer.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0e8AAAAASUVORK5CYII=','base64');
test('browser evidence preserves screenshots/assets, source mapping, continuation and local connector bytes',async()=>{
 const f=await fixture();try{
  const user=(await f.request('/me')).value.user;const p={id:id('prj_'),user_id:user.id,environment:'cloud'};
  f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)',p.id,user.id,'Capture QA','cloud',now(),now());
  const result={url:'https://example.com/',mobile:false,viewport:{width:1280,height:800},atBottom:false,truncated:true,continuation:{reset:false},frames:[0,600,1200,1800].map(scrollY=>({image:png.toString('base64'),title:'QA',scrollY,width:1280,height:800,text:'Untrusted page',design:{styles:[{fontSize:'24px',color:'rgb(0, 0, 0)'}]}})),assets:[{url:'https://example.com/image.png',body:png.toString('base64')},{url:'https://example.com/code.svg',body:Buffer.from('<svg onload="alert(1)"/>').toString('base64')}],missingAssets:[]};
  const saved=await saveBrowserEvidence({config:f.config,project:p,run:{id:'qa'},result});
  assert.equal(saved.frames.length,4);assert.equal(saved.assets.length,1);assert.equal(saved._images.length,3);assert.equal(saved.truncated,true);assert.deepEqual(saved.continuation,{reset:false});
  const base=projectRoot(f.config,p);assert.deepEqual(await readFile(`${base}/${saved.assets[0].path}`),png);
  const manifest=JSON.parse(await readFile(`${base}/${saved.manifestPath}`,'utf8'));assert.equal(manifest.source,'untrusted_browser_content');assert.equal(manifest.assets[0].url,'https://example.com/image.png');assert.equal(manifest.missingAssets.length,1);assert.ok(!JSON.stringify(manifest).includes(png.toString('base64')));
  const details=JSON.parse(await readFile(`${base}/${saved.frames[0].details}`,'utf8'));assert.equal(details.design.styles[0].fontSize,'24px');assert.equal(details.image,undefined);
  const dispatched=[];const localSaved=await saveBrowserEvidence({config:f.config,project:{...p,environment:'local'},run:{id:'qa'},result:{...result,frames:result.frames.slice(0,1)},nodes:{dispatch:async(_p,_r,tool,args)=>dispatched.push({tool,...args})}});
  await assert.rejects(readFile(`${base}/${localSaved.frames[0].screenshot}`),{code:'ENOENT'});
  assert.ok(dispatched.every(d=>d.tool==='upload_chunk'&&d.path.startsWith('inputs/att_')));assert.ok(dispatched.some(d=>Buffer.from(d.base64,'base64').equals(png)));
  await assert.rejects(saveBrowserEvidence({config:f.config,project:p,run:{id:'qa'},result:{frames:[{image:Buffer.from('<html>').toString('base64')}]}}),/screenshot/);
 }finally{await f.close();}
});
test('capture tools constrain source scan sizes and reject active content as raster assets',()=>{
 assert.equal(evidenceType(png).mime,'image/png');assert.equal(evidenceType(Buffer.from('<svg/>')),null);
 assert.equal(computerCapture.parse({}).maxScreens,8);assert.throws(()=>computerCapture.parse({maxScreens:1000}));assert.throws(()=>computerCapture.parse({script:'arbitrary JS'}));
});

test('empty connector reservations do not fill the server evidence quota; stored collections still do',async()=>{
 const f=await fixture();try{
  const user=(await f.request('/me')).value.user,p={id:id('prj_'),user_id:user.id,environment:'cloud'},root=projectRoot(f.config,p);
  for(let i=0;i<30;i++)await mkdir(`${root}/inputs/att_capture_empty${i}`,{recursive:true});
  const result={url:'https://example.com/login',publicPage:true,frames:[{image:png.toString('base64')}],assets:[]};
  const saved=await saveBrowserEvidence({config:f.config,project:p,run:{id:'qa'},result});
  assert.equal(JSON.parse(await readFile(`${root}/${saved.manifestPath}`)).publicPage,true);
  for(let i=0;i<29;i++)await writeFile(`${root}/inputs/att_capture_empty${i}/manifest.json`,'{}');
  await assert.rejects(saveBrowserEvidence({config:f.config,project:p,run:{id:'qa'},result}),/30/);
 }finally{await f.close();}
});
