import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fixture,until} from './helpers.mjs';
import {storyGroups,storyPlan,continuousPlan} from '../server/video-story.mjs';

test('text length determines scene count and long scripts are assembled in groups',()=>{
 assert.equal(storyPlan('Bir ikki uch').scenes.length,1);
 assert.equal(storyPlan(Array.from({length:21},(_,i)=>`so‘z${i}`).join(' ')).scenes.length,2);
 assert.ok(storyPlan(Array.from({length:21},(_,i)=>`so‘z${i}`).join(' ')).estimatedSeconds>15);
 assert.equal(storyPlan(Array.from({length:241},()=> 'so‘z').join(' ')).scenes.length,13);
 assert.equal(storyPlan(Array.from({length:960},()=> 'so‘z').join(' ')).scenes.length,48);
 assert.throws(()=>storyPlan(Array.from({length:961},()=> 'so‘z').join(' ')),/960 so‘z/);
 assert.deepEqual(storyGroups(Array.from({length:16},(_,i)=>i)).map(group=>group.length),[16]);
 assert.deepEqual(storyGroups(Array.from({length:17},(_,i)=>i)).map(group=>group.length),[12,5]);
 assert.deepEqual(storyGroups(Array.from({length:48},(_,i)=>i)).map(group=>group.length),[12,12,12,12]);
});

test('continuous plan splits text into at most three 10-second scenes and accepts edited cartoon scenes',()=>{
 const plan=continuousPlan(Array.from({length:45},(_,i)=>`word${i}`).join(' '));
 assert.equal(plan.scenes.length,3);assert.equal(plan.estimatedSeconds,30);
 assert.deepEqual(continuousPlan('Bola bog‘ga kiradi. Qush daraxtga uchib qo‘nadi. Bola unga qo‘l siltaydi.').scenes,['Bola bog‘ga kiradi. Qush daraxtga uchib qo‘nadi. Bola unga qo‘l siltaydi.']);
 assert.equal(continuousPlan('Birinchi sahnada ko‘k kiyimli bola bog‘da sariq qushni ko‘radi va unga yaqinlashadi. Ikkinchi sahnada qush uchib daraxtga qo‘nadi, bola esa unga tabassum qilib qo‘l siltaydi. Uchinchi sahnada ular quyosh botayotgan paytda yana uchrashadi.').scenes.length,3);
 assert.deepEqual(continuousPlan('ignored',['Qahramon uyga kiradi','O‘sha qahramon eshikni ochadi']).scenes,['Qahramon uyga kiradi','O‘sha qahramon eshikni ochadi']);
 assert.throws(()=>continuousPlan(Array.from({length:61},()=> 'word').join(' ')),/60 tagacha/);
 assert.throws(()=>continuousPlan('', ['one','','three']),/to‘ldirilgan/);
});

test('continuous video chains previous interaction, reuses image reference, resumes failed scene and keeps cumulative last MP4',async()=>{
  const f=await fixture({videoApiEnabled:true});
 const clip=path.join(f.dataDir,'continuous-source.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=yellow:s=160x90:r=24:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',clip],{timeout:20_000});
 const bytes=await readFile(clip),requests=[];
 const provider=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/v1beta/models'){res.end(JSON.stringify({models:[{name:'models/gemini-omni-1.1-flash'}]}));return;}
  if(req.url==='/v1beta/interactions'){
   let raw='';for await(const chunk of req)raw+=chunk;requests.push(JSON.parse(raw));
   res.end(JSON.stringify(requests.length===2?{status:'failed',error:{message:'temporary'}}:{status:'completed',id:`turn-${requests.length}`,output_video:{data:bytes.toString('base64')}}));return;
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const added=await f.request('/providers',{method:'POST',body:{label:'Google continuous QA',baseUrl:`http://127.0.0.1:${provider.address().port}/v1beta`,protocol:'gemini-image',apiKey:'QA_CONTINUOUS_KEY_123456',models:['gemini-omni-1.1-flash']}});
  const photo=(await f.request('/library',{method:'POST',body:{name:'hero.png',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5H8AAAAASUVORK5CYII='}})).value;
  const started=await f.request('/video-story/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:added.value.id,model:'gemini-omni-1.1-flash',mode:'continuous',script:'Qahramon shaharda yuradi',scenes:['Qahramon shaharda yuradi','O‘sha qahramon do‘konni ko‘radi','O‘sha qahramon uyga qaytadi'],referenceAssetId:photo.id,aspectRatio:'16:9'}});
  assert.equal(started.status,201,JSON.stringify(started.value));
  const failed=await until(async()=>{const row=(await f.request('/video-story/jobs')).value.find(j=>j.id===started.value.id);return row.status!=='running'&&row;},20_000);
  assert.equal(failed.status,'failed');assert.equal(failed.completedScenes,1);
  await f.request(`/video-story/jobs/${started.value.id}/resume`,{method:'POST',body:{}});
  const done=await until(async()=>{const row=(await f.request('/video-story/jobs')).value.find(j=>j.id===started.value.id);return row.status!=='running'&&row;},30_000);
  assert.equal(done.status,'completed',done.error);assert.equal(done.mode,'continuous');assert.equal(done.completedScenes,3);assert.equal(done.assetId,done.assetIds.at(-1));
  assert.equal(done.mediaJobIds.length,3);assert.equal(requests.length,4);
  assert.equal(requests[0].input[0].type,'image');assert.equal(requests[2].previous_interaction_id,'turn-1');assert.equal(requests[3].previous_interaction_id,'turn-3');
  assert.equal(requests[2].generation_config,undefined);assert.equal(typeof requests[2].input,'string');
  const mp4=await fetch(f.base+`/api/library/${done.assetId}/content?inline=true`,{headers:{'x-opensi-client':'web'}});
  assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii',4,8),'ftyp');
 }finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await f.close();}
});

test('one request creates scenes, keeps completed clips after a provider failure, resumes and renders MP4',async()=>{
  const f=await fixture({videoApiEnabled:true});
 const clip=path.join(f.dataDir,'story-source.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',clip],{timeout:20_000});
 const bytes=await readFile(clip);let requests=0;
 const provider=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/v1beta/models'){res.end(JSON.stringify({models:[{name:'models/gemini-omni-1.1-flash'}]}));return;}
  if(req.url==='/v1beta/interactions'){
   requests++;res.end(JSON.stringify(requests===2?{status:'failed',error:{message:'temporary'}}:{status:'completed',id:`interaction-${requests}`,output_video:{data:bytes.toString('base64')}}));return;
  }
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const added=await f.request('/providers',{method:'POST',body:{label:'Google story QA',baseUrl:`http://127.0.0.1:${provider.address().port}/v1beta`,protocol:'gemini-image',apiKey:'QA_STORY_KEY_123456',models:['gemini-omni-1.1-flash']}});
  assert.equal(added.status,200,JSON.stringify(added.value));
  const script=Array.from({length:25},(_,i)=>`so‘z${i+1}`).join(' ');
  const body={requestKey:randomUUID(),providerId:added.value.id,model:'gemini-omni-1.1-flash',script,style:'Izchil rang va ovoz',aspectRatio:'16:9',resolution:'720p'};
  const started=await f.request('/video-story/jobs',{method:'POST',body});assert.equal(started.status,201,JSON.stringify(started.value));
  const failed=await until(async()=>{const row=(await f.request('/video-story/jobs')).value.find(j=>j.id===started.value.id);return row.status!=='running'&&row;},20_000);
  assert.equal(failed.status,'failed');assert.equal(failed.completedScenes,1);assert.equal(requests,2);
  const duplicate=await f.request('/video-story/jobs',{method:'POST',body});assert.equal(duplicate.value.id,started.value.id);
  const resumed=await f.request(`/video-story/jobs/${started.value.id}/resume`,{method:'POST',body:{}});assert.equal(resumed.status,200);
  const done=await until(async()=>{const row=(await f.request('/video-story/jobs')).value.find(j=>j.id===started.value.id);return row.status!=='running'&&row;},35_000);
  assert.equal(done.status,'completed',done.error);assert.equal(done.completedScenes,2);assert.equal(requests,3);assert.ok(done.assetId);
  const mp4=await fetch(f.base+`/api/library/${done.assetId}/content?inline=true`,{headers:{'x-opensi-client':'web'}});
  assert.equal(mp4.status,200);assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii',4,8),'ftyp');
 }finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await f.close();}
});

test('a 17-scene script assembles multiple render groups into one downloadable MP4',async()=>{
  const f=await fixture({videoApiEnabled:true});
 const clip=path.join(f.dataDir,'story-group-source.mp4');
 execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=green:s=160x90:r=24:d=1.8','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.8','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',clip],{timeout:20_000});
 const bytes=await readFile(clip);let requests=0;
 const provider=http.createServer((req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.url==='/v1beta/models'){res.end(JSON.stringify({models:[{name:'models/gemini-omni-1.1-flash'}]}));return;}
  if(req.url==='/v1beta/interactions'){requests++;res.end(JSON.stringify({status:'completed',id:`group-${requests}`,output_video:{data:bytes.toString('base64')}}));return;}
  res.statusCode=404;res.end('{}');
 });
 await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const added=await f.request('/providers',{method:'POST',body:{label:'Google long story QA',baseUrl:`http://127.0.0.1:${provider.address().port}/v1beta`,protocol:'gemini-image',apiKey:'QA_STORY_GROUP_KEY_123456',models:['gemini-omni-1.1-flash']}});
  assert.equal(added.status,200);
  const started=await f.request('/video-story/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:added.value.id,model:'gemini-omni-1.1-flash',script:Array.from({length:321},(_,i)=>`word${i}`).join(' '),aspectRatio:'16:9',resolution:'720p'}});
  assert.equal(started.status,201,JSON.stringify(started.value));
  const done=await until(async()=>{const row=(await f.request('/video-story/jobs')).value.find(j=>j.id===started.value.id);return row.status!=='running'&&row;},120_000);
  assert.equal(done.status,'completed',done.error);assert.equal(done.completedScenes,17);assert.equal(requests,17);
  const mp4=await fetch(f.base+`/api/library/${done.assetId}/content?inline=true`,{headers:{'x-opensi-client':'web'}});
  assert.equal(mp4.status,200);assert.equal(Buffer.from(await mp4.arrayBuffer()).toString('ascii',4,8),'ftyp');
 }finally{provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));await f.close();}
});
