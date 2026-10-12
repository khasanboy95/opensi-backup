import {textModel} from './creative-catalog.mjs';
import {modelFailure} from './model-health.mjs';
export const autoProvider={id:'auto',label:'OpenSI Avtomatik',protocol:'auto',models:['auto'],model_labels:{auto:'Avtomatik · modellar jamoasi'},enabled:true,has_key:false};
export function stageFor(prompt,history=[]){
 const tools=history.filter(m=>m.role==='tool');const last=tools.at(-1)?.content||'';
 if(/"error"|"exitCode":\s*[1-9]|failed|AssertionError/i.test(last))return 'repair';
 if(/"tool_calls"/.test(last))return 'build';
 if(tools.length)return 'build';
 return /dizayn|design|slide|slayd|clone|klon|landing|ui\b/i.test(prompt)?'design':/tahlil|research|izlan|hisob|data/i.test(prompt)?'research':'plan';
}
// Transparent preferences, not benchmark claims. Only the account's enabled catalog participates.
export function modelScore(model,stage){
 const m=model.toLowerCase();let score=0;
 const light=/(?:^|[-_. ])(?:luna|flash|mini)(?:[-_. ]|$)/.test(m);
 if(/astra|opus|pro|high/.test(m))score+=stage==='review'||stage==='repair'||stage==='plan'&&!light?6:light?0:2;
 if(/sol|sonnet|codex/.test(m))score+=stage==='build'||stage==='repair'?8:3;
 if(/gemini|sonnet/.test(m)&&stage==='design')score+=8;
 if(/mimo/.test(m)&&stage==='research')score+=7;
 if(/glm/.test(m))score+=['build','repair'].includes(stage)?6:stage==='review'?4:2;
 // Low-latency tiers get routine work first; repair/review retain specialist preferences.
 if(light)score+=['plan','build'].includes(stage)?9:1;
 else if(/(?:^|[-_. ])low(?:[-_. ]|$)/.test(m)&&stage==='plan')score+=2;
 return score;
}
export function rankModels(providers,stage,excluded=new Set(),{nativeNode=null}={}){
 return providers.filter(p=>p.enabled&&p.id!=='auto'&&(p.protocol!=='antigravity-cli'||nativeNode==='*'||(nativeNode==='hosted'&&p.hosted===true)||p.node_id===nativeNode)).flatMap(p=>(Array.isArray(p.models)?p.models:JSON.parse(p.models)).filter(m=>textModel(p,m)).map(model=>({providerId:p.id,model,protocol:p.protocol,node_id:p.node_id,score:modelScore(model,stage)-(p.protocol==='antigravity-cli'&&['plan','build'].includes(stage)?2:0)}))).filter(p=>!excluded.has(`${p.providerId}:${p.model}`)).sort((a,b)=>b.score-a.score||a.model.localeCompare(b.model));
}
export function canFallback(error){return Boolean(modelFailure(error));}
export const stageLabels={plan:'Rejalash',build:'Kod va amalga oshirish',design:'Dizayn',research:'Tahlil',repair:'Xatoni tuzatish',review:'Yakuniy tekshiruv'};

export function teamRoster(providers,prompt){
 if(!/build|create|yarat|qil|dastur|python|3d|game|o.yin|blender|video|clone|design|tahlil|analysis/i.test(prompt))return [];
 const roles=[stageFor(prompt)==='design'?'design':'build','review'],selected=[];
 for(const role of roles){const ranked=rankModels(providers,role,new Set(selected.map(m=>m.providerId+':'+m.model)));const pick=ranked.find(m=>!selected.some(s=>s.providerId===m.providerId))||ranked[0];if(pick)selected.push({...pick,role});}
 return selected.length>1?selected:[];
}

export async function teamBriefing(roster,invoke,signal){
 const outcomes=await Promise.allSettled(roster.map(member=>invoke(member)));
 signal?.throwIfAborted();
 return outcomes.map((result,i)=>({model:roster[i].model,providerId:roster[i].providerId,role:roster[i].role,...(result.status==='fulfilled'?{answer:String(result.value||'').slice(0,7000)}:{error:'Mutaxassis javob bermadi; asosiy agent davom etadi.'})}));
}
