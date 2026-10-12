import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fixture,until} from './helpers.mjs';
import {hash,token,now} from '../server/security.mjs';
import {timeline,editedTimeline,filterGraph} from '../server/video-stitch.mjs';

const post=body=>({method:'POST',body});

test('30-second edit plan trims only the last clip and normalizes mixed audio',()=>{
 const plan=timeline([10,10,9,3]);
 assert.equal(plan.duration,30);
 assert.equal(plan.durations.at(-1),2.05);
 const graph=filterGraph([{width:1920,height:1080,audio:true},{width:640,height:360,audio:false}],timeline([4,4]));
 assert.match(graph.graph,/xfade=transition=fade:duration=0\.35:offset=3\.65/);
 assert.match(graph.graph,/anullsrc=channel_layout=stereo/);
 assert.equal(graph.width,1280);assert.equal(graph.height,720);
 assert.throws(()=>timeline([29,29,4]),/30 soniyaga sig‘madi/);
 assert.equal(timeline([8,8,8,8],120).duration,30.95);
});

test('manual edit uses explicit trim, cut, and mute while keeping automatic plan intact',()=>{
 const plan=editedTimeline([8,9],[{start:1,end:5,mute:false},{start:2,end:6,mute:true}],'cut');
 plan.mutes=[false,true];
 assert.equal(plan.duration,8);
 const graph=filterGraph([{width:640,height:360,audio:true},{width:640,height:360,audio:true}],plan);
 assert.match(graph.graph,/trim=start=1:duration=4/);
 assert.match(graph.graph,/concat=n=2:v=1:a=1/);
 assert.match(graph.graph,/anullsrc=channel_layout=stereo/);
 assert.doesNotMatch(graph.graph,/xfade/);
 assert.equal(editedTimeline([4],[{start:1,end:3,mute:false}]).duration,2);
 assert.throws(()=>editedTimeline([4],[{start:3,end:4,mute:false}]),/1.5 soniyadan kam/);
 assert.throws(()=>editedTimeline([20,20],[{start:0,end:20},{start:0,end:20}],'cut'),/30 soniyadan oshdi/);
});

test('each clip boundary can snap flush or crossfade independently',()=>{
 const plan=editedTimeline([5,5,5],[{start:0,end:5,overlap:0},{start:0,end:5,overlap:.8},{start:0,end:5,overlap:0}],'cut');
 assert.equal(plan.duration,14.2);
 assert.deepEqual(plan.overlaps,[0,.8,0]);
 const graph=filterGraph(Array.from({length:3},()=>({width:320,height:180,audio:false})),plan);
 assert.match(graph.graph,/xfade=transition=fade:duration=0\.8:offset=4\.2/);
 assert.match(graph.graph,/\[vx1\]\[ax1\]\[v2\]\[a2\]concat=n=2:v=1:a=1/);
 assert.throws(()=>editedTimeline([2,2,2],[{start:0,end:2},{start:0,end:2,overlap:1.5},{start:0,end:2,overlap:1.5}],'cut'),/ustma-ust qismi/);
 assert.throws(()=>editedTimeline([3,3],[{start:0,end:3,overlap:.2},{start:0,end:3,overlap:0}],'cut'),/Birinchi klip/);
});

test('real MP4 clips produce playable H.264/AAC and enforce the 30s cap with owner isolation',async()=>{
 const f=await fixture();
 try{
  const first=path.join(f.dataDir,'first.mp4'),second=path.join(f.dataDir,'second.mp4');
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=red:s=320x180:r=24:d=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',first],{timeout:20_000});
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x180:r=24:d=2','-c:v','libx264','-pix_fmt','yuv420p',second],{timeout:20_000});
  const upload=async(file,name)=>{
   const response=await fetch(f.base+'/api/uploads',{method:'POST',headers:{'x-opensi-client':'web','x-file-name':name,'content-type':'application/octet-stream'},body:await readFile(file)});
   assert.equal(response.status,201,await response.text());
   return (await f.request('/library')).value.find(asset=>asset.name===name);
  };
  const a=await upload(first,'first.mp4'),b=await upload(second,'second.mp4');
  assert.equal((await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),assetIds:[a.id,a.id]}))).status,400);
  const requestKey=randomUUID();const started=await f.request('/video-stitch/jobs',post({requestKey,assetIds:[a.id,b.id]}));
  assert.equal(started.status,201,JSON.stringify(started.value));
  assert.equal((await f.request('/video-stitch/jobs',post({requestKey,assetIds:[a.id,b.id]}))).value.id,started.value.id);
  const completed=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===started.value.id);return job.status!=='running'&&job;},25_000);
  assert.equal(completed.status,'completed',completed.error);
  assert.ok(completed.duration>3.5&&completed.duration<=4);
  const response=await fetch(f.base+`/api/library/${completed.asset_id}/content?inline=true`,{headers:{'x-opensi-client':'web'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'video/mp4');
  const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.toString('ascii',4,8),'ftyp');
  const manual=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),mode:'manual',transition:'cut',assetIds:[a.id,b.id],edits:[{start:.2,end:1.9,mute:false},{start:.1,end:1.8,mute:true}]}));
  assert.equal(manual.status,201,JSON.stringify(manual.value));
  const manualDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===manual.value.id);return job.status!=='running'&&job;},25_000);
  assert.equal(manualDone.status,'completed',manualDone.error);
  assert.ok(manualDone.duration>=3.2&&manualDone.duration<=3.5);
  const overlapped=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),mode:'manual',transition:'cut',assetIds:[a.id,b.id,a.id],edits:[{start:0,end:2,mute:false,overlap:0},{start:0,end:2,mute:false,overlap:.6},{start:0,end:2,mute:false,overlap:0}]}));
  assert.equal(overlapped.status,201,JSON.stringify(overlapped.value));
  const overlappedDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===overlapped.value.id);return job.status!=='running'&&job;},25_000);
  assert.equal(overlappedDone.status,'completed',overlappedDone.error);
  assert.ok(overlappedDone.duration>=5.3&&overlappedDone.duration<=5.5,`Overlap result ${overlappedDone.duration}s`);
  const trimmed=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),mode:'manual',assetIds:[manualDone.asset_id],edits:[{start:.3,end:2.1,mute:false}]}));
  assert.equal(trimmed.status,201,JSON.stringify(trimmed.value));
  const trimmedDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===trimmed.value.id);return job.status!=='running'&&job;},25_000);
  assert.equal(trimmedDone.status,'completed',trimmedDone.error);
  assert.ok(trimmedDone.duration>=1.7&&trimmedDone.duration<=1.9);
  const session=token();f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','stitch-other','Other','user',now());f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'stitch-other',Date.now()+60_000);
  const foreign={cookie:`opensi_session=${session}`};
  assert.deepEqual((await f.request('/video-stitch/jobs',{headers:foreign})).value,[]);
  assert.equal((await f.request('/video-stitch/jobs',{...post({requestKey:randomUUID(),assetIds:[a.id,b.id]}),headers:foreign})).status,404);
  const long=[];
  for(const [index,color] of ['red','green','blue','yellow'].entries()){
   const file=path.join(f.dataDir,`long-${index}.mp4`);
   execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=24:d=8`,'-c:v','libx264','-pix_fmt','yuv420p',file],{timeout:20_000});
   long.push((await upload(file,`long-${index}.mp4`)).id);
  }
  const split=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),mode:'manual',transition:'cut',assetIds:[long[0],long[0]],edits:[{start:0,end:3,mute:false},{start:3,end:6,mute:true}]}));
  assert.equal(split.status,201,JSON.stringify(split.value));
  const splitDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===split.value.id);return job.status!=='running'&&job;},25_000);
  assert.equal(splitDone.status,'completed',splitDone.error);
  assert.ok(splitDone.duration>=5.9&&splitDone.duration<=6.1,`Split result ${splitDone.duration}s`);
  assert.equal((await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),assetIds:[long[0],long[0]]}))).status,400);
  const capped=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),assetIds:long}));
  assert.equal(capped.status,201,JSON.stringify(capped.value));
  const cappedDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===capped.value.id);return job.status!=='running'&&job;},40_000);
  assert.equal(cappedDone.status,'completed',cappedDone.error);
  assert.ok(cappedDone.duration>=29.8&&cappedDone.duration<=30.06,`Got ${cappedDone.duration}s`);
  const extended=await f.request('/video-stitch/jobs',post({requestKey:randomUUID(),assetIds:long,maxSeconds:120}));
  assert.equal(extended.status,201,JSON.stringify(extended.value));
  const extendedDone=await until(async()=>{const job=(await f.request('/video-stitch/jobs')).value.find(item=>item.id===extended.value.id);return job.status!=='running'&&job;},40_000);
  assert.equal(extendedDone.status,'completed',extendedDone.error);
  assert.ok(extendedDone.duration>30.5&&extendedDone.duration<31.2,`Got ${extendedDone.duration}s`);
 }finally{await f.close();}
});
