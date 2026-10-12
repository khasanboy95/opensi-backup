import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {fixture,until} from './helpers.mjs';
import {mediaRetryAt} from '../server/media-retry.mjs';

const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(48)]);

test('Google retry delay uses the provider deadline and bounds missing hints',()=>{
  const from=Date.UTC(2026,9,12,6);
  assert.equal(mediaRetryAt('Please retry in 17h38m59s',null,from),new Date(from+((17*3600+38*60+59)*1000)+60_000).toISOString());
  assert.equal(mediaRetryAt('',null,from),new Date(from+3600_000).toISOString());
});

test('video continuation survives a daily 429 and resumes from the same previous interaction',async()=>{
  const f=await fixture({videoApiEnabled:true,mediaRetryIntervalMs:30});
  let attempts=0;const inputs=[];
  const server=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/v1beta/models'){res.end(JSON.stringify({models:[{name:'models/gemini-omni-1.1-flash'}]}));return;}
    if(req.url==='/v1beta/interactions'){
      let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw);inputs.push(body);
      if(body.previous_interaction_id&&++attempts===1){res.statusCode=429;res.end(JSON.stringify({error:{message:'Rate limit exceeded. Please retry in 17h38m59s.',code:'too_many_requests'}}));return;}
      res.end(JSON.stringify({status:'completed',id:body.previous_interaction_id?'second':'first',output_video:{data:mp4.toString('base64')}}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const provider=(await f.request('/providers',{method:'POST',body:{label:'Google retry test',baseUrl:`http://127.0.0.1:${server.address().port}/v1beta`,protocol:'gemini-image',apiKey:'QA_GOOGLE_VIDEO_KEY',models:['gemini-omni-1.1-flash']}})).value;
    const post=async(body)=>f.request('/media/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:provider.id,model:'gemini-omni-1.1-flash',aspectRatio:'16:9',...body}});
    const first=await post({text:'First scene'});
    const finished=await until(async()=>{const j=(await f.request('/media/jobs')).value.find(x=>x.id===first.value.id);return j.status==='completed'&&j;});
    assert.equal(finished.interaction_id,'first');
    const second=await post({text:'Continue the lesson',previousJobId:finished.id,operation:'extend'});
    const queued=await until(async()=>{const j=(await f.request('/media/jobs')).value.find(x=>x.id===second.value.id);return j.status==='queued'&&j;});
    assert.ok(Date.parse(queued.retry_at)>Date.now());
    assert.equal(queued.attempts,1);
    assert.equal(inputs.at(-1).previous_interaction_id,'first');
    assert.equal(inputs.at(-1).generation_config,undefined);
    f.store.exec('UPDATE media_cooldowns SET retry_at=? WHERE provider_id=? AND model=?',new Date(0).toISOString(),provider.id,'gemini-omni-1.1-flash');
    f.store.exec('UPDATE media_jobs SET retry_at=? WHERE id=?',new Date(0).toISOString(),queued.id);
    const resumed=await until(async()=>{const j=(await f.request('/media/jobs')).value.find(x=>x.id===second.value.id);return j.status==='completed'&&j;});
    assert.equal(resumed.attempts,2);
    assert.equal(resumed.interaction_id,'second');
    assert.equal(inputs.at(-1).previous_interaction_id,'first');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.close();}
});
