import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,until} from './helpers.mjs';
import {videoRequest,videoOutput,retrieveVideo} from '../server/gemini-video.mjs';

const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(48)]);

test('Gemini Omni payload supports text, image, uploaded MP4 and prior video context',()=>{
 const v={model:'gemini-omni-1.1-flash',text:'O‘zbekcha dars',style:'8 soniya',aspectRatio:'9:16',resolution:'720p'};
 assert.equal(videoRequest(v,null,null).input,'O‘zbekcha dars\n\n8 soniya');
 assert.equal(videoRequest(v,null,null).response_format.delivery,'uri');
 assert.equal(videoRequest(v,null,null).store,true);
 assert.equal(videoRequest(v,null,null).background,false);
 const image=videoRequest(v,{mime:'image/png',bytes:Buffer.from('img')},null);
 assert.equal(image.input[0].type,'image');assert.equal(image.input[0].data,'aW1n');
 const video=videoRequest(v,{mime:'video/mp4',bytes:mp4},null);
 assert.equal(video.input[0].type,'video');assert.equal(video.input[1].type,'text');
 assert.equal(videoRequest(v,null,'v1_prior').previous_interaction_id,'v1_prior');
 const extended=videoRequest({...v,operation:'extend',text:'Keyingi sahna'}, {mime:'image/png',bytes:Buffer.from('img')},'v1_prior');
 assert.equal(extended.previous_interaction_id,'v1_prior');
 assert.equal(extended.generation_config,undefined);
 assert.equal(extended.input[0].type,'image');
 assert.match(extended.input[1].text,/same characters/);
 assert.equal(videoOutput({status:'completed',id:'v1_top',output_video:{uri:'files/mock1'}}).uri,'files/mock1');
 assert.throws(()=>videoOutput({status:'failed',error:{message:'blocked'}}),/blocked/);
});

test('Gemini video job polls Google file, saves MP4, edits previous output and rejects bad output',async()=>{
  const f=await fixture({videoApiEnabled:true});const requests=[];
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1beta/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'models/gemini-omni-1.1-flash'}]}));return;}
  if(req.url==='/v1beta/files/mock1'){requests.push({path:req.url,key:req.headers['x-goog-api-key']});res.setHeader('content-type','application/json');res.end(JSON.stringify({state:'ACTIVE'}));return;}
  if(req.url==='/v1beta/files/mock1:download?alt=media'){requests.push({path:req.url,key:req.headers['x-goog-api-key']});res.setHeader('content-type','video/mp4');res.end(mp4);return;}
  if(req.url==='/v1beta/interactions'){
   let raw='';for await(const chunk of req)raw+=chunk;
   const body=JSON.parse(raw);requests.push({path:req.url,key:req.headers['x-goog-api-key'],body});
   res.setHeader('content-type','application/json');
   if(body.generation_config?.video_config?.task || (Array.isArray(body.input)&&body.input[0]?.type==='user_input')){res.statusCode=400;res.end(JSON.stringify({error:{message:'Only user input is allowed when video task is set.',code:'invalid_request'}}));return;}
   res.end(JSON.stringify(body.input==='blocked'?{status:'failed',error:{message:'SAFETY'}}:body.previous_interaction_id?{status:'completed',id:'v1_edit',output_video:{uri:'files/mock1'}}:{status:'completed',id:'v1_first',steps:[{type:'model_output',content:[{type:'video',mime_type:'video/mp4',uri:`http://127.0.0.1:${server.address().port}/v1beta/files/mock1:download?alt=media`}]}]}));return;
  }
  res.statusCode=404;res.end();
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const provider=(await f.request('/providers',{method:'POST',body:{label:'Google video test',baseUrl:`http://127.0.0.1:${server.address().port}/v1beta`,protocol:'gemini-image',apiKey:'QA_GOOGLE_VIDEO_KEY',models:['gemini-omni-1.1-flash']}})).value;
  assert.equal((await f.request('/media/models')).value[0].kind,'video');
  assert.equal((await f.request(`/providers/${provider.id}/test`,{method:'POST',body:{model:'gemini-omni-1.1-flash'}})).status,200);
  const create=async(body)=>{const result=await f.request('/media/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:provider.id,model:'gemini-omni-1.1-flash',aspectRatio:'16:9',...body}});assert.equal(result.status,201,JSON.stringify(result.value));return until(async()=>{const j=(await f.request('/media/jobs')).value.find(row=>row.id===result.value.id);return j.status!=='running'&&j;});};
  const first=await create({text:'O‘zbekcha dars'});assert.equal(first.status,'completed',first.error);assert.equal(first.interaction_id,'v1_first');
  const bytes=Buffer.from(await (await fetch(`${f.base}/api/library/${first.asset_id}/content`)).arrayBuffer());assert.deepEqual(bytes,mp4);
  const edited=await create({text:'Panel rangini ko‘k qiling',previousJobId:first.id});assert.equal(edited.status,'completed',edited.error);
  assert.equal(requests.filter(r=>r.body).at(-1).body.previous_interaction_id,'v1_first');
  const source=(await f.request('/library',{method:'POST',body:{name:'sample.mp4',content:mp4.toString('base64')}})).value;
  const fromVideo=await create({text:'Shu kadrni tahrirlang',assetId:source.id});assert.equal(fromVideo.status,'completed',fromVideo.error);
  assert.equal(requests.filter(r=>r.body).at(-1).body.input[0].type,'video');
  const photo=(await f.request('/library',{method:'POST',body:{name:'cover.png',content:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5H8AAAAASUVORK5CYII='}})).value;
  const fromImage=await create({text:'Rasmni jonlantiring',assetId:photo.id});assert.equal(fromImage.status,'completed',fromImage.error);
  assert.equal(requests.filter(r=>r.body).at(-1).body.input[0].type,'image');
  const continued=await create({text:'O‘sha qahramon yurishda davom etadi',assetId:photo.id,previousJobId:first.id,operation:'extend'});
  assert.equal(continued.status,'completed',continued.error);
  assert.equal(requests.filter(r=>r.body).at(-1).body.generation_config,undefined);
  assert.equal(requests.filter(r=>r.body).at(-1).body.input[0].type,'image');
  assert.equal((await f.request('/media/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:provider.id,model:'gemini-omni-1.1-flash',text:'Bad',aspectRatio:'16:9',assetId:source.id,previousJobId:first.id}})).status,400);
  assert.equal((await f.request('/media/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:provider.id,model:'gemini-omni-1.1-flash',text:'Bad',aspectRatio:'1:1'}})).status,400);
  const failed=await create({text:'blocked'});assert.equal(failed.status,'failed');assert.match(failed.error,/SAFETY/);assert.equal(failed.asset_id,null);
  assert.ok(requests.every(r=>r.key==='QA_GOOGLE_VIDEO_KEY'));
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.close();}
});

test('Google file URI cannot make the server fetch another host',async()=>{
 await assert.rejects(()=>retrieveVideo({base_url:'https://generativelanguage.googleapis.com/v1beta',key:'secret'},{uri:'https://example.com/v1beta/files/abc:download?alt=media'},new AbortController().signal),/mos emas/);
});
