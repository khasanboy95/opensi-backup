import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers.mjs';
import {makeConfig} from '../server/config.mjs';
import {videoAccountPreferences} from '../server/video-account-preferences.mjs';

test('legacy environment flag cannot enable paid video API calls',()=>{
 const previous=process.env.OPENSI_VIDEO_API_ENABLED;
 try{
  process.env.OPENSI_VIDEO_API_ENABLED='true';
  assert.equal(makeConfig().videoApiEnabled,false);
 }finally{
  if(previous===undefined)delete process.env.OPENSI_VIDEO_API_ENABLED;
  else process.env.OPENSI_VIDEO_API_ENABLED=previous;
 }
});

test('Flow account email persists for the owner without changing video billing',async()=>{
 const f=await fixture();
 try{
  const initial=await f.request('/video/account-preferences');
  assert.deepEqual(initial.value,{flowEmail:'',veoflowEmail:''});
  const updated=await f.request('/video/account-preferences',{method:'PATCH',body:{source:'flow',email:'EsmeGlobal289@Gmail.com'}});
  assert.equal(updated.status,200);
  assert.equal(updated.value.flowEmail,'esmeglobal289@gmail.com');
  assert.deepEqual((await f.request('/video/account-preferences')).value,updated.value);
  assert.deepEqual(videoAccountPreferences(f.store,'another-user'),{flowEmail:'',veoflowEmail:''});
  assert.equal((await f.request('/video/account-preferences',{method:'PATCH',body:{source:'flow',email:'bad address'}})).status,400);
  assert.equal((await f.request('/video/account-preferences',{method:'PATCH',body:{source:'api',email:'test@example.com'}})).status,400);
  assert.equal(f.config.videoApiEnabled,false);
 }finally{await f.close();}
});

test('Flow billing policy hides video API models and blocks both video creation routes',async()=>{
 const f=await fixture();
 try{
  assert.equal(f.config.videoApiEnabled,false);
  const provider=await f.request('/providers',{method:'POST',body:{label:'Google media test',baseUrl:'https://generativelanguage.googleapis.com/v1beta',protocol:'gemini-image',apiKey:'QA_FAKE_KEY_DO_NOT_SEND',models:['gemini-omni-1.1-flash','gemini-2.5-flash-image']}});
  assert.equal(provider.status,200,JSON.stringify(provider.value));
  const models=await f.request('/media/models');
  assert.equal(models.status,200);
  assert.ok(models.value.every(model=>model.kind!=='video'));
  const body={requestKey:randomUUID(),providerId:provider.value.id,model:'gemini-omni-1.1-flash',text:'Test video',aspectRatio:'16:9'};
  const media=await f.request('/media/jobs',{method:'POST',body});
  assert.equal(media.status,403);
  assert.match(media.value.error,/Video API o‘chirilgan/);
  const story=await f.request('/video-story/jobs',{method:'POST',body:{requestKey:randomUUID(),providerId:provider.value.id,model:'gemini-omni-1.1-flash',script:'Test sahna',aspectRatio:'16:9'}});
  assert.equal(story.status,403);
  assert.equal(f.store.one('SELECT COUNT(*) AS count FROM media_jobs').count,0);
  assert.equal(f.store.one('SELECT COUNT(*) AS count FROM video_story_jobs').count,0);
 }finally{await f.close();}
});
