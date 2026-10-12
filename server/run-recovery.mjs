import { hash, now } from './security.mjs';

export function connectionFailure(error) {
  const text=String(error?.message||error||'');
  if (/denied|permission|unauthorized|forbidden|rad et|ruxsat|token.*bekor|quota|limit|402|401|403/i.test(text)) return false;
  return error?.connectionLost===true || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|fetch failed|socket|network|connection.*(?:lost|closed|reset)|offline|connector.*(?:uzil|vaqt|javob)|server.*(?:uzil|unavailable)|502|503|504|model.*(?:uzil|timeout)/i.test(text);
}

export const actionKey=(tool,args)=>hash(JSON.stringify([tool,args]));
export function runRecovery(store,vault) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS run_recovery (
    run_id TEXT PRIMARY KEY REFERENCES runs(id), state TEXT NOT NULL DEFAULT 'ready',
    attempts INTEGER NOT NULL DEFAULT 0, resumes INTEGER NOT NULL DEFAULT 0,
    next_at INTEGER NOT NULL DEFAULT 0, checkpoint TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
  )`);
  const row=id=>store.one('SELECT * FROM run_recovery WHERE run_id=?',id);
  const register=id=>store.exec('INSERT OR IGNORE INTO run_recovery(run_id,updated_at) VALUES(?,?)',id,now());
  const load=id=>{const value=row(id);if(!value)return {};try{return JSON.parse(vault.decrypt(value.checkpoint)||'{}');}catch{return {};}};
  const save=(id,patch)=>{register(id);const state={...load(id),...patch};store.exec('UPDATE run_recovery SET checkpoint=?,updated_at=? WHERE run_id=?',vault.encrypt(JSON.stringify(state)),now(),id);};
  return {row,register,load,save,
    state(id,state,nextAt=0){register(id);store.exec('UPDATE run_recovery SET state=?,next_at=?,updated_at=? WHERE run_id=?',state,nextAt,now(),id);},
    resume(id){register(id);store.exec("UPDATE run_recovery SET state='ready',attempts=0,resumes=resumes+1,next_at=0,updated_at=? WHERE run_id=?",now(),id);},
    defer(id,delay){register(id);store.exec("UPDATE run_recovery SET state='reconnecting',attempts=attempts+1,resumes=resumes+1,next_at=?,updated_at=? WHERE run_id=?",Date.now()+delay,now(),id);},
    record(id,tool,args,result,local=false){
      if(result?.error||result?.denied||result?.execution_status==='unknown'||result?.reused||(Number.isFinite(result?.exitCode)&&result.exitCode!==0))return;
      const old=load(id),key=actionKey(tool,args);
      const evidence=local?{local:true,saved:result?.saved,path:result?.path,exitCode:result?.exitCode,execution_status:'completed',outputOmitted:true}:JSON.parse(JSON.stringify(result));
      if(typeof evidence.output==='string')evidence.output=evidence.output.slice(-4000);
      const compact=JSON.stringify(evidence).length>8000?{execution_status:'completed',saved:result?.saved,path:result?.path,exitCode:result?.exitCode,outputOmitted:true}:evidence;
      const edits=['write_file','append_file','edit_file','rename_file','delete_file','copy_file'].includes(tool);
      save(id,{actions:[...(old.actions||[]).filter(a=>a.key!==key&&(!edits||!['run_command','native_command','browser_test'].includes(a.tool))),{key,tool,result:compact}].slice(-150)});
    },
    result(id,tool,args){return load(id).actions?.find(a=>a.key===actionKey(tool,args))?.result;},
    public(id){const value=row(id);return value?{state:value.state,attempts:value.attempts,resumes:value.resumes}:null;},
  };
}
