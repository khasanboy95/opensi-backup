import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {studioTools} from '../server/studio-tools.mjs';

test('transcribe tool extracts requested segment and saves actual ASR output; missing provider and extraction failure stop',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'opensi-asr-'));
 const project={id:'prj_'+'b'.repeat(24),user_id:'usr_'+'a'.repeat(24),environment:'cloud'},run={id:'run_test',user_id:project.user_id};
 const root=path.join(dir,'workspaces',project.user_id,project.id);await mkdir(root,{recursive:true});await writeFile(path.join(root,'input.mp4'),'fixture');
 let enabled=true,fail=false,started=0,command='';
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const job=JSON.parse(body);command=job.command;
  if(!fail){const audio=job.command.match(/'([^']+\.mp3)'$/)[1];await mkdir(path.dirname(path.join(root,audio)),{recursive:true});await writeFile(path.join(root,audio),'fixture audio');}
  res.end(JSON.stringify({type:'result',exitCode:fail?1:0,timedOut:false,output:fail?'invalid input':''})+'\n');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const config={dataDir:dir,runnerUrl:'http://127.0.0.1:'+server.address().port,runnerToken:'test'};
 const store={all:()=>enabled?[{id:'asr',protocol:'openai',models:'["mimo-v2.5-asr"]'}]:[],one:()=>({id:run.user_id})};
 const library={add:(user,name,bytes)=>{assert.equal(bytes.toString(),'fixture audio');return {id:'audio'};},get:()=>({id:'text'}),copy:async(asset,target)=>writeFile(target,'Actual transcript from ASR')};
 const media={start:(user,args,runId)=>{started++;assert.equal(args.assetId,'audio');assert.equal(runId,run.id);return {id:'job'};},wait:async()=>({assetId:'text',status:'completed'})};
 const tools=studioTools({store,library,media,config});
 try{
  const out=await tools.tool('transcribe_media',{path:'input.mp4',start:30,duration:60},run,project);
  assert.match(command,/-ss 30 /);assert.match(command,/-t 60 /);assert.match(out.path,/^transcripts\/.*\.txt$/);assert.equal(await readFile(path.join(root,out.path),'utf8'),'Actual transcript from ASR');assert.equal(out.start,30);assert.match(out.scope,/segment only/);assert.equal(started,1);
  fail=true;await assert.rejects(()=>tools.tool('transcribe_media',{path:'input.mp4',start:0,duration:30},run,project),/Audio ajratilmadi/);assert.equal(started,1);
  enabled=false;await assert.rejects(()=>tools.tool('transcribe_media',{path:'input.mp4',start:0,duration:30},run,project),/modeli ulanmagan/);
 }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
