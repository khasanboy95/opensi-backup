import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {projectRoot,safePath} from './files.mjs';
import {supportsMedia} from './image-media.mjs';
import {mediaModels} from './media.mjs';
import {cloudCommand} from './commands.mjs';
export function studioTools({store,library,media,config}) {
 return {async tool(name,args,run,project,signal) {
  if(name==='transcribe_media'){
   if(project.environment!=='cloud'||!config.runnerUrl)throw Error('Audio transkripsiya uchun bulut terminali kerak.');
   const provider=store.all('SELECT id,models,protocol FROM providers WHERE enabled=1').find(p=>JSON.parse(p.models).includes('mimo-v2.5-asr')&&supportsMedia(p,'mimo-v2.5-asr',mediaModels));if(!provider)throw Error('Audio transkripsiya modeli ulanmagan.');
   const root=projectRoot(config,project);await safePath(root,args.path);const stamp=randomUUID(),audio='transcripts/'+stamp+'.mp3',output='transcripts/'+stamp+'.txt';await mkdir(path.dirname(await safePath(root,audio)),{recursive:true});
   const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
   const extraction=await cloudCommand(config,root,{command:`ffmpeg -nostdin -hide_banner -loglevel error -threads 1 -ss ${args.start} -i ${quote(args.path)} -t ${args.duration} -vn -ac 1 -ar 16000 -c:a libmp3lame -b:a 48k -y ${quote(audio)}`,timeout:100},signal);
   if(extraction.exitCode!==0||extraction.timedOut)throw Error('Audio ajratilmadi: '+extraction.output.slice(-1500));
   const file=await safePath(root,audio);if((await stat(file)).size>7_000_000)throw Error('Audio bo‘lagi 7 MB dan katta.');const asset=library.add(run.user_id,path.basename(audio),await readFile(file),'Transkripsiya',`project:${project.id}`);
   const user=store.one('SELECT * FROM users WHERE id=? AND disabled=0',run.user_id);if(!user)throw Error('Hisob faol emas.');const job=media.start(user,{providerId:provider.id,model:'mimo-v2.5-asr',assetId:asset.id,language:'auto',requestKey:randomUUID()},run.id);const done=await media.wait(job.id,signal);const target=await safePath(root,output);await library.copy(library.get(run.user_id,done.assetId),target,true);
   return {...done,path:output,text:(await readFile(target,'utf8')).slice(0,60000),start:args.start,duration:args.duration,scope:'Requested segment only; call again with the next start offset for longer media.'};
  }
  if(name==='library_search')return {assets:store.all('SELECT id,name,mime,size,folder FROM library_assets WHERE user_id=? AND deleted_at IS NULL ORDER BY created_at DESC',run.user_id).filter(a=>a.name.toLowerCase().includes(args.query.toLowerCase())).slice(0,80)};
  if(name==='media_catalog')return {models:store.all('SELECT id,label,models,protocol FROM providers WHERE enabled=1').flatMap(p=>JSON.parse(p.models).filter(m=>supportsMedia(p,m,mediaModels)&&m!=='mimo-v2.5-tts-voiceclone'&&(config.videoApiEnabled||mediaModels[m]!=='video')).map(model=>({providerId:p.id,provider:p.label,model,kind:mediaModels[model]})))};
  if(name==='create_media'){const user=store.one('SELECT * FROM users WHERE id=? AND disabled=0',run.user_id);if(!user)throw new Error('Hisob faol emas.');const job=media.start(user,{...args,requestKey:randomUUID()},run.id);return media.wait(job.id,signal);}
  const root=projectRoot(config,project);const file=await safePath(root,args.path);
  if(name==='library_import'){const asset=library.get(run.user_id,args.assetId);await mkdir(path.dirname(file),{recursive:true});await library.copy(asset,file,true);return {saved:true,path:args.path,bytes:asset.size};}
  if(name==='library_save'){if((await stat(file)).size>10_000_000)throw new Error('Fayl 10 MB dan katta.');return library.add(run.user_id,path.basename(args.path),await readFile(file),args.folder,`project:${project.id}`);}
 }};
}
