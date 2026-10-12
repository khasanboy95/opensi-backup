import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {safePath} from '../server/files.mjs';

export function serviceManager() {
 const services=new Map();
 const scrub=(text,env)=>{for(const value of Object.values(env||{}))if(value.length>=8)for(const secret of [value,encodeURIComponent(value),Buffer.from(value).toString('base64')])text=text.split(secret).join('[maxfiy]');return text;};
 const snapshot=s=>s?{name:s.name,status:s.status,pid:s.child.pid||null,exitCode:s.exitCode,startedAt:s.startedAt,output:scrub(s.output,s.env).slice(-16000)}:{status:'not_running',output:''};
 async function stop(s){if(!s||s.status!=='running')return; s.status='stopping';
  if(process.platform==='win32')await new Promise(resolve=>{const killer=spawn('taskkill',['/pid',String(s.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.once('error',resolve);killer.once('close',resolve);});
  else {try{process.kill(-s.child.pid,'SIGTERM');}catch{s.child.kill('SIGTERM');}await Promise.race([s.closed,delay(1500)]);if(s.child.exitCode===null)try{process.kill(-s.child.pid,'SIGKILL');}catch{s.child.kill('SIGKILL');}}
  await Promise.race([s.closed,delay(3000)]);if(s.status==='stopping')s.status='stop_unconfirmed';
 }
 return {
  async execute(root,args,signal){
   if(!/^[a-zA-Z0-9_-]{1,60}$/.test(args.name)||!['start','status','stop'].includes(args.operation))throw new Error('Xizmat parametrlari noto‘g‘ri.');
   const key=path.resolve(root)+'\0'+args.name,previous=services.get(key);
   if(args.operation==='status')return snapshot(previous);
   if(args.operation==='stop'){await stop(previous);return snapshot(previous);}
   if(previous&&['running','stopping','stop_unconfirmed'].includes(previous.status))return {...snapshot(previous),alreadyRunning:true};
   if(args.environment?.TELEGRAM_BOT_TOKEN&&[...services.values()].some(s=>s.status==='running'&&s.env.TELEGRAM_BOT_TOKEN===args.environment.TELEGRAM_BOT_TOKEN))throw new Error('Bu bot shu connectorda ishlayapti. Avval mavjud xizmatni to‘xtating.');
   if(!['node','python','python3'].includes(args.runtime)||typeof args.entry!=='string'||!Array.isArray(args.args)||args.args.length>40||args.args.some(a=>typeof a!=='string'||a.length>2000))throw new Error('Runtime parametrlari noto‘g‘ri.');
   const entry=await safePath(root,args.entry);await mkdir(root,{recursive:true});
   const env={};for(const name of ['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','TEMP','TMP'])if(process.env[name])env[name]=process.env[name];
   for(const [name,value] of Object.entries(args.environment||{})){if(!/^[A-Z_][A-Z0-9_]{0,79}$/.test(name)||typeof value!=='string'||value.length>8000)throw new Error('Environment noto‘g‘ri.');env[name]=value;}
   const localHome=path.join(root,'.runtime-home');await mkdir(localHome,{recursive:true});Object.assign(env,{HOME:localHome,USERPROFILE:localHome,PYTHONUNBUFFERED:'1',FORCE_COLOR:'0'});
   signal?.throwIfAborted();
   const child=spawn(args.runtime==='node'?process.execPath:args.runtime,[entry,...args.args],{cwd:root,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
   const service={name:args.name,child,status:'running',exitCode:null,startedAt:new Date().toISOString(),output:'',env:args.environment||{}};services.set(key,service);
   const capture=chunk=>{service.output=(service.output+chunk.toString()).slice(-24000);};child.stdout.on('data',capture);child.stderr.on('data',capture);
   service.closed=new Promise(resolve=>{child.once('error',error=>{service.status='failed';capture(error.message);resolve();});child.once('close',code=>{service.exitCode=code;service.status=service.status==='stopping'?'stopped':code===0?'exited':'failed';resolve();});});
   const abort=()=>{void stop(service);};signal?.addEventListener('abort',abort,{once:true});
   try{await Promise.race([service.closed,delay(800,undefined,{signal})]);signal?.throwIfAborted();return {...snapshot(service),note:'Jarayon holati tekshirildi. Telegram foydalanuvchi bilan to‘liq sinov alohida bajariladi. Connector yopilsa xizmat to‘xtaydi.'};}
   catch(error){await stop(service);throw error;}finally{signal?.removeEventListener('abort',abort);}
  },
  async close(){await Promise.all([...services.values()].map(stop));services.clear();}
 };
}
