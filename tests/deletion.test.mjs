import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './helpers.mjs';
import {hash,now,token} from '../server/security.mjs';

const remove=route=>({method:'DELETE'});
function foreign(f){
  const session=token();
  f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','delete-other','Other','user',now());
  f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'delete-other',Date.now()+60000);
  return {'Cookie':`opensi_session=${session}`};
}
async function asset(f,name){
  const result=await f.request('/library',{method:'POST',body:{name,content:Buffer.from('test bytes').toString('base64')}});
  assert.equal(result.status,201,JSON.stringify(result.value));return result.value.id;
}

test('removing a task hides it from catalog, direct access and latest run while keeping project and usage',async()=>{
  const f=await fixture();
  try{
    const stamp=now(),headers=foreign(f);
    f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)','delete-project','local-owner','Keep files','cloud',stamp,stamp);
    f.store.exec('INSERT INTO runs(id,user_id,project_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','run_delete1','local-owner','delete-project','Finished','completed',stamp,stamp);
    f.store.exec('INSERT INTO messages(run_id,project_id,role,content,created_at) VALUES(?,?,?,?,?)','run_delete1','delete-project','user',JSON.stringify({role:'user',content:'Finished'}),stamp);
    f.store.exec('INSERT INTO usage(id,user_id,run_id,input_tokens,output_tokens,known,created_at) VALUES(?,?,?,?,?,?,?)','delete-usage','local-owner','run_delete1',4,2,1,stamp);
    assert.equal((await f.request('/runs/run_delete1',{...remove(),headers})).status,404);
    assert.equal((await f.request('/runs/run_delete1',remove())).status,200);
    assert.equal((await f.request('/runs/catalog')).value.counts.all,0);
    assert.equal((await f.request('/runs')).value.length,0);
    assert.equal((await f.request('/runs/run_delete1')).status,404);
    assert.equal((await f.request('/projects/delete-project/latest-run')).status,404);
    assert.ok(f.store.one('SELECT id FROM projects WHERE id=?','delete-project'));
    assert.equal(f.store.one('SELECT input_tokens FROM usage WHERE id=?','delete-usage').input_tokens,4);
    assert.equal((await f.request('/runs/run_delete1',remove())).status,404);
    f.store.exec('INSERT INTO runs(id,user_id,project_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','run_delete2','local-owner','delete-project','Still running','running',stamp,stamp);
    assert.equal((await f.request('/runs/run_delete2',remove())).status,409);
    assert.equal((await f.request('/runs/run_delete2')).value.messages.length,0,'removed task messages do not reappear in the project');
  }finally{await f.close();}
});

test('media and montage deletion is owner scoped, stops active jobs and trashes only their outputs',async()=>{
  const f=await fixture();
  try{
    const stamp=now(),headers=foreign(f),mediaAsset=await asset(f,'media.txt'),stitchAsset=await asset(f,'montage.mp4'),source=await asset(f,'source.mp4');
    f.store.exec('INSERT INTO media_jobs(id,user_id,request_key,provider_id,model,prompt,status,asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)','media_delete','local-owner',randomUUID(),'provider','model','Test','completed',mediaAsset,stamp,stamp);
    f.store.exec('INSERT INTO video_stitch_jobs(id,user_id,request_key,status,phase,asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)','stitch_delete','local-owner',randomUUID(),'completed','ready',stitchAsset,stamp,stamp);
    assert.equal((await f.request('/media/jobs/media_delete',{...remove(),headers})).status,404);
    assert.equal((await f.request('/video-stitch/jobs/stitch_delete',{...remove(),headers})).status,404);
    assert.equal((await f.request('/media/jobs/media_delete',remove())).status,200);
    assert.equal((await f.request('/video-stitch/jobs/stitch_delete',remove())).status,200);
    assert.equal((await f.request('/media/jobs')).value.length,0);
    assert.equal((await f.request('/video-stitch/jobs')).value.length,0);
    assert.deepEqual(new Set((await f.request('/library?trash=true')).value.map(row=>row.id)),new Set([mediaAsset,stitchAsset]));
    assert.deepEqual((await f.request('/library')).value.map(row=>row.id),[source]);
    assert.equal((await f.request(`/library/${mediaAsset}/content`)).status,404);
    assert.equal((await f.request('/media/jobs/media_delete',remove())).status,404);
    f.store.exec('INSERT INTO media_jobs(id,user_id,request_key,provider_id,model,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)','media_active','local-owner',randomUUID(),'provider','model','Busy','running',stamp,stamp);
    f.store.exec('INSERT INTO video_stitch_jobs(id,user_id,request_key,status,phase,created_at,updated_at) VALUES(?,?,?,?,?,?,?)','stitch_active','local-owner',randomUUID(),'running','checking',stamp,stamp);
    assert.equal((await f.request('/media/jobs/media_active',remove())).status,409);
    assert.equal((await f.request('/video-stitch/jobs/stitch_active',remove())).status,409);
  }finally{await f.close();}
});

test('automatic video deletion removes its child results but preserves the uploaded reference',async()=>{
  const f=await fixture();
  try{
    const stamp=now(),headers=foreign(f),reference=await asset(f,'reference.txt'),scene=await asset(f,'scene.mp4'),final=await asset(f,'final.mp4');
    f.store.exec('INSERT INTO media_jobs(id,user_id,request_key,provider_id,model,prompt,status,asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)','media_scene','local-owner',randomUUID(),'provider','model','Scene','completed',scene,stamp,stamp);
    f.store.exec('INSERT INTO video_stitch_jobs(id,user_id,request_key,status,phase,asset_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)','stitch_story','local-owner',randomUUID(),'completed','ready',final,stamp,stamp);
    f.store.exec("INSERT INTO video_story_jobs(id,user_id,request_key,provider_id,model,script,style,reference_asset_id,aspect_ratio,resolution,scenes,asset_ids,status,phase,media_job_id,stitch_job_id,asset_id,media_job_ids,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      'story_delete','local-owner',randomUUID(),'provider','model','Test video','',reference,'16:9','720p',JSON.stringify(['Test video']),JSON.stringify([scene]),'completed','ready','media_scene','stitch_story',final,JSON.stringify(['media_scene']),stamp,stamp);
    assert.equal((await f.request('/video-story/jobs/story_delete',{...remove(),headers})).status,404);
    assert.equal((await f.request('/media/jobs/media_scene',remove())).status,409);
    assert.equal((await f.request('/video-stitch/jobs/stitch_story',remove())).status,409);
    assert.equal((await f.request('/video-story/jobs/story_delete',remove())).status,200);
    assert.equal((await f.request('/video-story/jobs')).value.length,0);
    assert.equal((await f.request('/media/jobs')).value.length,0);
    assert.equal((await f.request('/video-stitch/jobs')).value.length,0);
    assert.deepEqual(new Set((await f.request('/library?trash=true')).value.map(row=>row.id)),new Set([scene,final]));
    assert.deepEqual((await f.request('/library')).value.map(row=>row.id),[reference]);
  }finally{await f.close();}
});
