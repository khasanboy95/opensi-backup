import {z} from 'zod';
import {HttpError,now,id} from './security.mjs';

export const jevSchema=z.object({state:z.union([z.string(),z.record(z.string(),z.unknown()),z.array(z.unknown())]),questions:z.record(z.string(),z.object({type:z.enum(['choice','noul','score']),instructions:z.unknown().optional(),criteria:z.unknown().optional()}))});
export function jevService({config,store}) {
  store.db.exec('CREATE TABLE IF NOT EXISTS jev_calls(id TEXT PRIMARY KEY,user_id TEXT,run_id TEXT,model TEXT,duration_ms INTEGER,created_at TEXT)');
  const enabled=Boolean(config.jevKey);
  async function decide(args,userId,runId,signal) {
    if(!enabled)throw new HttpError(503,'JEV kaliti serverda sozlanmagan.');
    const value=jevSchema.parse(args);if(!Object.keys(value.questions).length || Object.keys(value.questions).length>30)throw new HttpError(400,'1–30 ta savol kiriting.');
    const payload=JSON.stringify({model:'jev-latest',...value});if(payload.length>50000)throw new HttpError(413,'JEV so‘rovi 50 000 belgidan oshdi.');
    const started=Date.now();let response;
    try {response=await fetch(config.jevEndpoint || 'https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${config.jevKey}`,'Content-Type':'application/json'},body:payload,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});}
    catch {throw new HttpError(502,'JEV bilan ulanish bajarilmadi.');}
    if(!response.ok)throw new HttpError(502,`JEV HTTP ${response.status}.`);
    const text=await response.text();if(text.length>100000)throw new HttpError(502,'JEV javobi juda katta.');
    const data=JSON.parse(text);if(!data?.answers || typeof data.answers!=='object')throw new HttpError(502,'JEV javobi noto‘g‘ri.');
    store.exec('INSERT INTO jev_calls VALUES(?,?,?,?,?,?)',id('jev_'),userId,runId||null,data.model||'jev-latest',Date.now()-started,now());
    const usage=data.usage&&Number.isFinite(data.usage.input_tokens)&&data.usage.input_tokens>=0&&Number.isFinite(data.usage.output_tokens)&&data.usage.output_tokens>=0?data.usage:null;
    const run=runId?store.one('SELECT * FROM runs WHERE id=? AND user_id=?',runId,userId):null;
    if(run)store.usage(run,{id:'jev'},data.model||'jev-latest','jev-supervisor',usage?{prompt_tokens:usage.input_tokens,completion_tokens:usage.output_tokens}:null);
    return {model:data.model||'jev-latest',answers:data.answers,durationMs:Date.now()-started,usage};
  }
  return {enabled,decide,routes(app){
    app.get('/api/jev',(req,res)=>res.json({enabled,supervisor:enabled,model:'jev-latest',purpose:'Model jarayonlarini tezkor nazorat qilish',lastTest:store.one('SELECT model,created_at,duration_ms FROM jev_calls WHERE user_id=? ORDER BY created_at DESC LIMIT 1',req.user.id)||null}));
    app.post('/api/jev/test',async(req,res)=>{if(req.user.role!=='admin')throw new HttpError(403,'Faqat administrator uchun.');res.json(await decide({state:'OpenSI is connected to TypeSafe JEV.',questions:{connected:{type:'noul',instructions:'Does the text say OpenSI is connected to TypeSafe JEV?'}}},req.user.id));});
  }};
}
