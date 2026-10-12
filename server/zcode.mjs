import path from 'node:path';
import {existsSync} from 'node:fs';
import {HttpError,id,now} from './security.mjs';
import {ZcodeGateway,zcodeLogin,zcodeLogout,zcodeReply} from './zcode-runtime.mjs';
import {createModelHealth,modelFailure} from './model-health.mjs';
import {WorkPool} from './work-pool.mjs';

export function zcodeService(config,store,{gatewayFactory=options=>new ZcodeGateway({...options,...(config.localAuth&&config.zcodeApiBase?{apiBase:config.zcodeApiBase,allowLocal:true}:{})}),login=zcodeLogin,logout=zcodeLogout}={}){
  const runtime=config.zcodeRuntime||path.join(config.dataDir,'zcode/runtime/zcode.cjs');
  const home=path.join(config.dataDir,'zcode/account'),workspace=path.join(config.dataDir,'zcode/gateway');
  const ready=()=>existsSync(runtime)&&existsSync(path.join(path.dirname(runtime),'provider/zcode-builtin.json'));
  let gatewayInstance,pending,health=createModelHealth();const pool=new WorkPool(3,3);
  const metadata=()=>store.setting('zcode-account')||{},save=value=>store.setSetting('zcode-account',value);
  const owner=userId=>{const user=store.one('SELECT * FROM users WHERE id=?',userId);return Boolean(user&&!user.disabled&&user.role==='admin'&&(config.localAuth&&userId==='local-owner'||user.email?.toLowerCase()===(config.astraOwnerEmail||'khasandjemilov@gmail.com').toLowerCase()));};
  const assertOwner=userId=>{if(!owner(userId))throw new HttpError(403,'ZCode ulanishini faqat OpenSI egasi boshqaradi.');};
  const allowed=userId=>{const meta=metadata(),user=store.one('SELECT google_sub,disabled FROM users WHERE id=?',userId),accountOwner=store.one('SELECT disabled,role FROM users WHERE id=?',meta.owner||'');return Boolean(user&&!user.disabled&&accountOwner&&!accountOwner.disabled&&accountOwner.role==='admin'&&(meta.owner===userId||meta.shared&&user.google_sub));};
  const gateway=()=>gatewayInstance||=gatewayFactory({runtime,home,workspace});
  const publicProvider=(meta,userId,models)=>({id:meta.id,label:'ZCode · Z.ai hisobi',base_url:'Z.ai Coding API · rasmiy CLI hisobi',protocol:'zcode-account',models:models.map(m=>m.id),model_labels:Object.fromEntries(models.map(m=>[m.id,m.label])),shared:Boolean(meta.shared),can_manage:meta.owner===userId,enabled:true,has_key:false,verified_at:meta.updated||null,tested_at:meta.tested_at||null});
  const verified=meta=>meta.models?.filter(m=>(meta.verified_models||(!meta.connected?[]:meta.models.map(item=>item.id))).includes(m.id))||[];
  const available=(providerId,model)=>health.available('shared',[{providerId,model}]).length;
  const cooling=()=>{const error=new HttpError(429,'Z.ai umumiy hisobining kvotasi tiklanishi kutilmoqda.');error.providerStatus=429;return error;};
  async function invoke(userId,model,{messages,tools=[],signal,onText=()=>{},onToolCall=()=>{},onProgress=()=>{},onUsage=()=>{},config:requestConfig=config},validation=false){
    const meta=metadata();if(!ready()||!(meta.authenticated||meta.connected)||!allowed(userId)||!meta.models?.some(m=>m.id===model)||!validation&&(!meta.connected||!verified(meta).some(m=>m.id===model)))throw new HttpError(403,'Bu ZCode modeli hisobingizga ulanmagan yoki ruxsat yopilgan.');
    if(!validation&&!available(meta.id,model))throw cooling();
    const release=await pool.acquire(userId,signal);let pulse;try{
      if(!allowed(userId)||!(metadata().authenticated||metadata().connected)||!validation&&(!metadata().connected||!verified(metadata()).some(m=>m.id===model)))throw new HttpError(403,'ZCode ulanishi bekor qilindi.');
      if(!validation&&!available(meta.id,model))throw cooling();
      onProgress({phase:'connected'});pulse=setInterval(()=>onProgress({phase:'preparing'}),5000);
      let streamed=false;const result=await gateway().generate(model,messages,tools,signal,validation?30000:requestConfig.modelTimeout||1800000,{onText:value=>{streamed=true;onText(value);},onProgress}),reply=zcodeReply(result);
      onUsage(result.usage?{prompt_tokens:result.usage.inputTokens||0,completion_tokens:result.usage.outputTokens||0}:null);
      if(reply.content&&!streamed)onText(reply.content);for(const call of reply.tool_calls||[])onToolCall(call);
      save({...metadata(),tested_at:now(),error:null});return reply;
    }catch(error){if(!signal?.aborted)health.fail('shared',{providerId:meta.id,model},error);throw error;}finally{clearInterval(pulse);release();}
  }
  const service={
    status(userId){const meta=metadata(),manage=owner(userId);if(!manage&&!allowed(userId))return{configured:ready(),connected:false,can_manage:false,models:[]};
      return{configured:ready(),authenticated:Boolean(meta.authenticated||meta.connected),connected:Boolean(meta.connected&&ready()),usable:Boolean(meta.connected&&verified(meta).some(m=>available(meta.id,m.id))),can_manage:manage,shared:Boolean(meta.shared),models:manage?meta.models||[]:verified(meta),tested_at:meta.tested_at||null,...(manage?{email:meta.email||'',can_restore:ready()&&existsSync(path.join(home,'.zcode/v2/credentials.json')),pending:Boolean(pending),error:meta.error||null,authorizeUrl:pending?.url||null}:{})};
    },
    list(userId){const meta=metadata();if(!ready()||!meta.connected||!allowed(userId))return[];const models=verified(meta).filter(m=>available(meta.id,m.id));return models.length?[publicProvider(meta,userId,models)]:[];},
    async connect(userId,{shared=true}={}){
      assertOwner(userId);if(!ready())throw new HttpError(409,'Rasmiy ZCode runtime serverga hali o‘rnatilmagan.');if(pending)throw new HttpError(409,'Z.ai kirish oynasi allaqachon ochilgan. O‘sha oynada davom eting.');
      const meta=metadata();save({...meta,id:meta.id||id('zc_'),owner:userId,shared,authenticated:false,connected:false,error:null});
      save({...metadata(),verified_models:[]});const controller=new AbortController(),attempt={controller,url:null};pending=attempt;await gatewayInstance?.close();gatewayInstance=null;
      let deliver,rejectUrl;const urlReady=new Promise((resolve,reject)=>{deliver=resolve;rejectUrl=reject;});
      const urlTimer=setTimeout(()=>{controller.abort(new Error('Z.ai kirish oynasi vaqtida ochilmadi.'));rejectUrl(new HttpError(504,'Z.ai kirish oynasi ochilmadi. Qayta urinib ko‘ring.'));},30000);
      attempt.done=login({runtime,home,workspace,signal:controller.signal,onUrl:url=>{attempt.url=url;clearTimeout(urlTimer);deliver(url);}}).then(async identity=>{
        save({...metadata(),authenticated:true,email:identity.email,error:null});await service.refresh(userId);
      }).catch(error=>{const message=error instanceof HttpError?error.message:'Z.ai kirish yakunlanmadi. Qayta urinib ko‘ring.';save({...metadata(),connected:false,error:message});rejectUrl(new HttpError(error.status||502,message));}).finally(()=>{clearTimeout(urlTimer);if(pending===attempt)pending=null;});
      return{authorizeUrl:await urlReady,expiresIn:300};
    },
    async refresh(userId){assertOwner(userId);if(!ready())throw new HttpError(409,'Rasmiy ZCode runtime serverga hali o‘rnatilmagan.');await gatewayInstance?.close();gatewayInstance=null;const models=await gateway().catalog();if(!models.length)throw new HttpError(403,'Z.ai hisobida CLI kodlash modeli topilmadi. Hisobni qayta ulang.');
      const meta=metadata();save({...meta,id:meta.id||id('zc_'),owner:userId,authenticated:true,connected:false,models,verified_models:[],updated:now(),error:null});let failure;
      for(const model of [...models].sort((a,b)=>Number(/flash/i.test(b.id))-Number(/flash/i.test(a.id)))){try{await service.test(userId,model.id);}catch(error){failure=error;if(['quota','auth'].includes(error.providerFailureKind))break;}}
      if(!metadata().connected)throw failure||new HttpError(502,'Z.ai model javobi tekshirilmadi.');return service.status(userId);
    },
    async test(userId,model){assertOwner(userId);const meta=metadata();try{
      const provider=publicProvider(meta,userId,meta.models||[]),reply=await invoke(userId,model,{messages:[{role:'user',content:'Reply with OPENSI_CONNECTED only. Do not use tools.'}],onUsage:usage=>store.usage({id:null,user_id:userId},provider,model,'connection_test',usage)},true);
      health=createModelHealth();save({...metadata(),verified_models:[...new Set([...verified(metadata()).map(m=>m.id),model])],connected:true,tested_at:now(),error:null});return{ok:true,message:reply.content,model};
    }catch(error){const models=modelFailure(error)?.scope==='provider'?[]:verified(metadata()).filter(m=>m.id!==model).map(m=>m.id);save({...metadata(),verified_models:models,connected:models.length>0,error:error.message});throw error;}},
    share(userId,shared){assertOwner(userId);save({...metadata(),shared});return service.status(userId);},
    provider(userId,providerId,model){const meta=metadata();if(meta.id!==providerId||!meta.connected||!allowed(userId)||!verified(meta).some(m=>m.id===model))throw new HttpError(403,'Bu ZCode modeli hisobingizga ulanmagan yoki ruxsat yopilgan.');return{...publicProvider(meta,userId,verified(meta)),complete:request=>invoke(userId,model,request)};},
    async disconnect(userId){assertOwner(userId);save({...metadata(),authenticated:false,connected:false,email:'',models:[],error:null,tested_at:null,shared:false});pending?.controller.abort(new Error('Z.ai ulanishi bekor qilindi.'));await pending?.done;await gatewayInstance?.close();gatewayInstance=null;
      if(ready())await logout({runtime,home,workspace});save({...metadata(),authenticated:false,connected:false,email:'',models:[],error:null,tested_at:null,shared:false});return service.status(userId);
    },
    async close(){pending?.controller.abort(new Error('Server qayta ishga tushmoqda.'));await pending?.done;await gatewayInstance?.close();gatewayInstance=null;}
  };return service;
}
