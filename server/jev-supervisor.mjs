import {modelKey, recoverableToolFailure} from './adaptive-team.mjs';

export const supervisionLabels = {continue:'Ishni davom ettirish',repair:'Xatoni tuzatish',switch:'Boshqa modelga topshirish',inspect:'Natijani tekshirish'};

// Deliberately omit prompts, paths, code, commands, outputs, credentials and user IDs.
export function supervisionState({phase,history=[],failedSteps=0,candidates=[],current='',native=false}) {
  const calls=new Map(history.flatMap(m=>(m.tool_calls||[]).map(c=>[c.id,c.function.name])));
  const recent=history.filter(m=>m.role==='tool').slice(-6).map(m=>{
    let value={};try{value=JSON.parse(m.content);}catch{}
    const raw=calls.get(m.tool_call_id)||'unknown';
    const tool=/^[a-z_]{1,40}$/.test(raw)&&!raw.startsWith('mcp_')?raw:'external_tool';
    return {tool,outcome:value.denied?'denied':recoverableToolFailure(value)?'failed':'returned',exitCode:Number.isInteger(value.exitCode)?value.exitCode:null};
  });
  return {phase,failedSteps,native,recent,current,
    candidates:candidates.slice(0,8).map((m,i)=>({option:'c'+i,model:m.model,priority:Number.isFinite(m.priority)?m.priority:m.score||0,active:m.load?.active||0}))};
}

function choice(answer,allowed) {
  return answer?.type==='choice'&&allowed.includes(answer.choice)&&Number.isFinite(answer.confidence)&&answer.confidence>=.7&&answer.confidence<=1&&
    Number.isFinite(answer.probabilities?.[answer.choice])&&answer.probabilities[answer.choice]>=.7&&answer.probabilities[answer.choice]<=1?answer.choice:null;
}

export function createJevSupervisor({jev,run,signal,emit,budgetMs=700,maxCalls=6}) {
  const cache=new Map();let calls=0,failures=0,lastHealthy=null;
  return {async assess(input) {
    if(!jev?.enabled)return null;
    signal.throwIfAborted();
    const state=supervisionState(input),key=JSON.stringify(state);
    if(cache.has(key))return cache.get(key);
    const observations=(input.history||[]).filter(m=>m.role==='tool').length;
    const healthy=!input.failedSteps&&!state.recent.some(r=>r.outcome==='failed'||r.outcome==='denied');
    // Reuse the current executor between milestones. Load counters changing are not new work.
    if(healthy&&lastHealthy&&lastHealthy.phase===input.phase&&lastHealthy.current===input.current&&observations-lastHealthy.observations<4)return null;
    if(calls>=maxCalls||failures>=2)return null;
    calls++;const abort=new AbortController();let timer;
    const started=Date.now();
    try {
      const criteria=Object.fromEntries(state.candidates.map(c=>[c.option,`${c.model}; application priority ${c.priority}; active calls ${c.active}`]));
      const questions={action:{type:'choice',instructions:'Select a useful NEXT step from execution metadata only. Do not claim code is correct. Denials require respecting existing permissions. Switch only after technical failures; healthy progress should continue. Inspect after changes when verification is needed.',criteria:{continue:'Healthy progress or insufficient evidence; keep current workflow.',repair:'A technical tool or test failed; diagnose and repair.',switch:'Repeated technical failures; another eligible model may help.',inspect:'Inspect existing files or run a focused verification, without restarting work.'}}};
      if(state.candidates.length>1)questions.route={type:'choice',instructions:'Choose the best candidate for the current phase using application priority and active load. Higher priority already accounts for phase fit and recent token usage. Avoid unnecessary switches.',criteria};
      const result=await Promise.race([
        jev.decide({state,questions},run.user_id,run.id,AbortSignal.any([signal,abort.signal])),
        new Promise((_,reject)=>{timer=setTimeout(()=>{abort.abort();reject(Error('supervisor_timeout'));},budgetMs);}),
      ]);
      signal.throwIfAborted();
      const action=choice(result.answers?.action,Object.keys(supervisionLabels));
      const selected=choice(result.answers?.route,state.candidates.map(c=>c.option));
      const candidate=selected?input.candidates[Number(selected.slice(1))]:null;
      const route=candidate?modelKey(candidate):null;
      // JEV never changes permissions, skips verification, or invents candidates.
      const decision={action:action==='switch'&&(!input.failedSteps||input.native)?'continue':action||'continue',route,durationMs:result.durationMs??Date.now()-started};
      cache.set(key,decision);failures=0;
      if(healthy)lastHealthy={phase:input.phase,current:input.current,observations};
      emit('jev_supervision',{status:action?'evaluated':'uncertain',action:decision.action,label:supervisionLabels[decision.action],durationMs:decision.durationMs,model:result.model,calls});
      if(result.usage)emit('usage',{known:Number.isFinite(result.usage.input_tokens)&&Number.isFinite(result.usage.output_tokens),input:result.usage.input_tokens??null,output:result.usage.output_tokens??null,model:result.model,agent:'JEV nazoratchi'});
      return decision;
    }catch(error){
      signal.throwIfAborted();failures++;
      emit('jev_supervision',{status:'unavailable',label:'JEV kutilmadi; asosiy agent davom etadi',durationMs:Date.now()-started,calls});
      return null;
    }finally{clearTimeout(timer);abort.abort();}
  }};
}
