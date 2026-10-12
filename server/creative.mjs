import {z} from 'zod';
import {readFile,stat,writeFile} from 'node:fs/promises';
import {creativeCatalog,creativePresets,textModel,manifestGuide} from './creative-catalog.mjs';
import {renderArtifact,artifactSchema} from './artifacts.mjs';
import {projectRoot,safePath} from './files.mjs';
import {HttpError,now} from './security.mjs';
import {captureVersions} from './versions.mjs';
export function creativeService(app,{store,config,runner,createTask,parse,projectFor,editProject,library,documents}){
 store.db.exec('CREATE TABLE IF NOT EXISTS creative_projects(project_id TEXT PRIMARY KEY,preset TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL)');
 app.get('/api/creative/catalog',(_req,res)=>res.json(creativeCatalog));
 app.post('/api/creative/runs',(req,res)=>{
  const v=parse(z.object({preset:z.string().max(80),brief:z.string().trim().min(3).max(15000),providerId:z.string().max(80),model:z.string().max(200),theme:z.enum(['midnight','paper','forest','sunset']).default('midnight'),count:z.number().int().min(1).max(20).default(8),attachmentIds:z.array(z.string().max(80)).max(50).default([])}).strict(),req.body);
  const preset=creativePresets.find(p=>p.id===v.preset);if(!preset)throw new HttpError(400,'Vosita topilmadi.');
  if(['image','audio','unavailable'].includes(preset.engine))throw new HttpError(400,'Ushbu vositani Media studiyada mos API bilan oching.');
  const provider=runner.providerFor(v.providerId,v.model,req.user.id);if(!textModel(provider,v.model))throw new HttpError(400,'Dizaynni rejalash uchun matn yoki kod modeli tanlang.');
  const artifact=['slides','design','document','sheet'].includes(preset.engine);
  const prompt=`${preset.name}: ${v.brief}${artifact?`\n\nUslub: ${v.theme}. Sahifa / bo‘lim soni: ${v.count}.`:''}`;
  const local=v.providerId.startsWith('agy_');
  const result=createTask(req.user,{prompt,providerId:v.providerId,model:v.model,agentId:preset.engine==='agent'?'researcher':preset.name==='Saytni klonlash'?'cloner':preset.engine==='web'?'developer':'designer',environment:local?'local':'cloud',nodeId:local?v.providerId.slice(4):null,autonomy:'automatic',attachmentIds:v.attachmentIds},project=>{if(artifact){store.exec('INSERT INTO creative_projects VALUES(?,?,?,?)',project.id,preset.id,preset.engine,now());store.setSetting(`creative:${project.id}`,{theme:v.theme,count:v.count});}});
  store.exec('UPDATE projects SET title=? WHERE id=?',`${preset.name} · ${v.brief.slice(0,50)}`,result.project.id);

  res.status(201).json(result);
 });
 async function render(project,input,runId){
  const result=await renderArtifact(projectRoot(config,project),input);
  await captureVersions(store,projectRoot(config,project),project,runId,'Ijod studiyasi');
  return result;
 }
 app.get('/api/projects/:projectId/creative-artifact',async(req,res)=>{
  const project=projectFor(req);const file=await safePath(projectRoot(config,project),'opensi-artifact.json');
  if((await stat(file)).size>500000)throw new HttpError(413,'Dizayn manbasi juda katta.');res.json(artifactSchema.parse(JSON.parse(await readFile(file,'utf8'))));
 });
 app.put('/api/projects/:projectId/creative-artifact',async(req,res)=>{
  const input=parse(artifactSchema,req.body);const project=projectFor(req);
  if(project.environment!=='cloud')throw new HttpError(409,'Lokal dizaynni agentga yangi xabar yuborib tahrirlang.');
  const result=await editProject(project,async()=>{const result=await render(project,input,null);await writeFile(await safePath(projectRoot(config,project),'opensi-artifact.json'),JSON.stringify(input,null,2));return result;});res.json(result);
 });
 return {instructions(project){const c=store.one('SELECT kind FROM creative_projects WHERE project_id=?',project.id);if(!c)return '';const options=store.setting(`creative:${project.id}`)||{};return `${manifestGuide}\nRequired kind: ${c.kind}; theme: ${options.theme||'midnight'}; initial requested page count: ${options.count||8}. Follow the latest user revision if the requested page count changes. Save the complete manifest using write_file, then finish. The platform exports it. Do not install export tools.`;},async finalize(run,project,signal){
  const creative=store.one('SELECT * FROM creative_projects WHERE project_id=?',project.id);if(!creative)return;
  signal.throwIfAborted();runner.event(run.id,'tool_start',{tool:'artifact_export',args:{kind:creative.kind},agent:'Ijod studiyasi'});
  const file=await safePath(projectRoot(config,project),'opensi-artifact.json');let input;
  try{if((await stat(file)).size>500000)throw new Error('Manba 500 KB dan katta.');input=artifactSchema.parse(JSON.parse(await readFile(file,'utf8')));}catch(e){throw new Error(`Dizayn manbasi yaroqsiz yoki agent fayl yaratmagan. Saqlangan fayllardan davom eting: ${e.message.slice(0,300)}`);}
  if(input.kind!==creative.kind)throw new Error(`Natija turi ${creative.kind} bo‘lishi kerak.`);
  const result=await render(project,input,run.id);signal.throwIfAborted();
  if(documents&&config.runnerUrl){try{const source=result.files.find(f=>/\.(docx|pptx|xlsx)$/.test(f))||'index.html';const pdf=await documents.convert(project,{path:source,format:'pdf'},signal);result.files.push(pdf.path);}catch(e){signal.throwIfAborted();runner.event(run.id,'warning',{message:`Asl hujjat tayyor. PDF eksporti bajarilmadi: ${e.message}. Hujjatlar bo‘limida qayta aylantiring.`});}}
  // Binary exports are kept in the owned project and library; native source remains on the PC.
  const assets=[];for(const name of result.files.filter(f=>f.startsWith('exports/'))){const bytes=await readFile(await safePath(projectRoot(config,project),name));if(bytes.length<=10_000_000)assets.push(library.add(run.user_id,name.split('/').at(-1),bytes,'Ijod studiyasi',`project:${project.id}`).id);}
  runner.event(run.id,'tool_result',{tool:'artifact_export',result:{...result,assets,localSource:project.environment==='local',exportsLocation:'OpenSI loyiha va kutubxona'},agent:'Ijod studiyasi'});runner.event(run.id,'files_changed',{});
 }};
}
