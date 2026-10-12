import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash,createDecipheriv} from 'node:crypto';
import {platform,userInfo} from 'node:os';
import {HttpError} from './security.mjs';
import {repairToolHistory} from './history.mjs';
import {complete} from './provider.mjs';

// The official CLI owns OAuth and issues its Coding Plan API credential.
// Only the server adapter reads that credential, for the documented Z.ai API.
// No browser cookies, private desktop APIs or fabricated entitlements are used.
export function zcodeEnvironment(home, runtime) {
  const env={};
  for(const name of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[name])env[name]=process.env[name];
  return {...env,HOME:home,USERPROFILE:home,ZCODE_DATA_BASE_DIR:home,NODE_ENV:'production',
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:path.join(path.dirname(runtime),'provider/zcode-builtin.json'),
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:path.join(home,'.zcode/v2/provider_config.json')};
}

export function zcodeFailure(value) {
  const raw=JSON.stringify(value||{});let status=502,kind='transient',message='ZCode javobi olinmadi. Saqlangan ish bilan boshqa model davom etishi mumkin.';
  if(value?.status===402||/\b(?:3103|1302|1113)\b|insufficient_quota|insufficient balance|no resource package|quota.{0,60}(?:exhaust|exceed|reach)|credits?.{0,40}(?:exhaust|deplet)|balance.{0,30}(?:insufficient|exhaust)/i.test(raw)) {status=402;kind='quota';message='Z.ai model kvotasi yoki faol Coding Plan mavjud emas yoxud tugagan. Hisob tarifini tekshiring; bajarilgan ish saqlandi.';}
  else if(/\b(?:429|1303|1305)\b|rate.?limit|too many requests/i.test(raw)){status=429;kind='rate';message='Z.ai so‘rov chegarasiga yetdi. Bajarilgan ish saqlandi.';}
  else if(/\b401\b|unauthenticated|unauthorized|not logged|invalid.?token|login required|credential.*missing|no.*api.?key/i.test(raw)){status=401;kind='auth';message='Z.ai hisobiga qayta kirish kerak. Ulanishlar → ZCode orqali ulang.';}
  else if(/\b(?:403|3101)\b|forbidden|permission.?denied|not entitled|eligibility|content.?policy|safety/i.test(raw)){status=403;kind='permission';message='Z.ai hisobi bu model yoki amalga ruxsat bermadi. Hisob tarifini tekshiring.';}
  const error=new HttpError(502,message);error.providerStatus=status;error.providerFailureKind=kind;return error;
}

export class ZcodeGateway {
  constructor({runtime,home,workspace,apiBase='https://api.z.ai/api/coding/paas/v4',allowLocal=false}){Object.assign(this,{runtime,home,workspace,apiBase,allowLocal});this.controllers=new Set();}
  async channel(){
    const source=JSON.parse(await readFile(path.join(path.dirname(this.runtime),'provider/zcode-builtin.json'),'utf8'));
    const channels=(source.config?.providerConfigRules?.providerRules||[]).filter(p=>p.config?.access?.type==='zhipu-account'&&p.config.access.accountType==='zai'&&p.config.access.mode==='individual-coding-plan');
    if(channels.length!==1)throw zcodeFailure({error:'invalid official catalog'});return channels[0];
  }
  async key(){
    const channel=await this.channel();let credentials;try{credentials=JSON.parse(await readFile(path.join(this.home,'.zcode/v2/credentials.json'),'utf8'));}catch{throw zcodeFailure({error:'credentials missing'});}
    // Official CLI enc:v1 records use the same private HOME and OS user as login.
    // Decode only this channel's identity and API key, and keep both in memory.
    const decode=value=>{if(typeof value!=='string'||!value.startsWith('enc:v1:'))return value;
      try{const parts=value.slice(7).split('.');if(parts.length!==3)throw new Error();const [iv,tag,data]=parts.map(v=>Buffer.from(v,'base64url'));if(iv.length!==12||tag.length!==16)throw new Error();
        let username='unknown';try{username=userInfo().username;}catch{}
        const secret=`zcode-credential-fallback:${platform()}:${this.home}:${username}`,cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');
      }catch{throw zcodeFailure({error:'401 credentials decode failed'});}
    };
    const identity=decode(credentials[`account-provider:${channel.providerId}:identity`]);
    const key=typeof identity==='string'?decode(credentials[`account-provider:coding-plan:${channel.providerId}:account:${encodeURIComponent(identity.trim())}:api-key`]):null;
    if(typeof key!=='string'||!key.trim())throw zcodeFailure({error:'credentials missing'});return key;
  }
  async catalog(){
    await this.key();const channel=await this.channel();return(channel.config.builtinModelIds||[]).filter(m=>typeof m==='string'&&m.length<200).map(m=>({id:m.toLowerCase(),label:m}));
  }
  async generate(model,messages,tools,signal,timeout,callbacks={}){
    // GLM capability differs between protocols; never silently drop an image.
    zcodeMessages(messages);
    if(!(await this.catalog()).some(m=>m.id===model))throw zcodeFailure({error:'403 model not entitled'});
    const controller=new AbortController();this.controllers.add(controller);let usage;
    try{const reply=await complete({provider:{base_url:this.apiBase,protocol:'openai',getKey:()=>this.key()},model,messages,tools,signal:AbortSignal.any([controller.signal,...(signal?[signal]:[])]),config:{localAuth:this.allowLocal,modelTimeout:timeout||1800000},onText:callbacks.onText,onProgress:callbacks.onProgress,onUsage:value=>{usage=value;}});
      return{text:reply.content||'',toolCalls:(reply.tool_calls||[]).map(call=>({id:call.id,name:call.function.name,input:JSON.parse(call.function.arguments)})),usage:usage?{inputTokens:usage.prompt_tokens||0,outputTokens:usage.completion_tokens||0}:null};
    }catch(error){if(signal?.aborted)throw signal.reason;if(controller.signal.aborted)throw controller.signal.reason;throw zcodeFailure({status:error.providerStatus,message:error.message});}
    finally{this.controllers.delete(controller);}
  }
  async close(){for(const controller of this.controllers)controller.abort(new Error('ZCode so‘rovi to‘xtatildi.'));this.controllers.clear();}
}

export function zcodeMessages(messages){
  const names=new Map();
  return repairToolHistory(messages).map(message=>{
    if(Array.isArray(message.content)&&message.content.some(part=>part.type!=='text')){const error=new HttpError(400,'ZCode’ning bu ulanishi rasm qabul qilmaydi. Rasm tushunadigan boshqa modelni tanlang.');error.providerFailureKind='transient';throw error;}
    const content=typeof message.content==='string'?message.content:Array.isArray(message.content)?message.content.map(part=>part.text||'').join('\n'):'';
    if(message.role==='tool')return{role:'tool',content,toolCallId:message.tool_call_id,toolName:names.get(message.tool_call_id)||message.name||'tool'};
    const result={role:message.role==='developer'?'system':message.role,content};
    if(message.tool_calls?.length)result.toolCalls=message.tool_calls.map(call=>{
      names.set(call.id,call.function.name);let input;try{input=JSON.parse(call.function.arguments);}catch{throw new HttpError(400,'ZCode uchun vosita tarixi noto‘g‘ri.');}
      return{id:call.id,name:call.function.name,input};
    });return result;
  });
}

export function zcodeReply(result){
  if(!result||typeof result.text!=='string'||!result.text&&!result.toolCalls?.length)throw zcodeFailure({error:'invalid response'});
  if(['length','max_tokens'].includes(result.finishReason))throw zcodeFailure({error:'invalid response: incomplete output'});
  const calls=(result.toolCalls||[]).map(call=>{
    if(typeof call.id!=='string'||!call.id||typeof call.name!=='string'||!call.name)throw zcodeFailure({error:'invalid response: incomplete tool call'});
    const args=JSON.stringify(call.input??{});if(args.length>600_000)throw zcodeFailure({error:'invalid response size'});
    return{id:call.id,type:'function',function:{name:call.name,arguments:args}};
  });
  return{role:'assistant',content:result.text||null,...(calls.length?{tool_calls:calls}:{})};
}

export async function zcodeLogin({runtime,home,workspace,onUrl,signal,spawnProcess=spawn}){
  await Promise.all([mkdir(home,{recursive:true,mode:0o700}),mkdir(workspace,{recursive:true,mode:0o700})]);
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(process.execPath,[runtime,'login','--json','--no-browser','--no-color'],{cwd:workspace,env:zcodeEnvironment(home,runtime),windowsHide:true,stdio:['ignore','pipe','pipe']});
    let output='',errors='',urlSent=false;const timer=setTimeout(()=>child.kill(),10*60_000);
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',v=>{output+=v;if(output.length>100_000)child.kill();});
    child.stderr.on('data',v=>{errors=(errors+v.toString()).slice(-16000);if(urlSent)return;
      const url=errors.match(/https:\/\/[^\s<>"']+/)?.[0];if(!url)return;
      try{const parsed=new URL(url);if(!['zcode.z.ai','z.ai','chat.z.ai'].includes(parsed.hostname)||parsed.username||parsed.password)return;urlSent=true;onUrl(url);}catch{}
    });
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.on('error',()=>{cleanup();reject(zcodeFailure({error:'runtime start failed'}));});
    child.on('close',code=>{cleanup();if(signal?.aborted){reject(signal.reason);return;}if(code!==0){reject(zcodeFailure({error:errors}));return;}
      try{const result=JSON.parse(output);if(result.status!=='ready')throw new Error();resolve({email:typeof result.user?.email==='string'?result.user.email.slice(0,200):'',name:typeof result.user?.name==='string'?result.user.name.slice(0,100):''});}catch{reject(zcodeFailure({error:'invalid response'}));}
    });
  });
}

export async function zcodeLogout({runtime,home,workspace,spawnProcess=spawn}){
  await Promise.all([mkdir(home,{recursive:true,mode:0o700}),mkdir(workspace,{recursive:true,mode:0o700})]);
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(process.execPath,[runtime,'logout','--json','--no-color'],{cwd:workspace,env:zcodeEnvironment(home,runtime),windowsHide:true,stdio:['ignore','ignore','ignore']});
    const timer=setTimeout(()=>child.kill(),15000);
    child.once('error',()=>{clearTimeout(timer);reject(zcodeFailure({error:'logout failed'}));});
    child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(zcodeFailure({error:'logout failed'}));});
  });
}
