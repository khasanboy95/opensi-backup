import {z} from 'zod';
export const executionSchema=z.object({autonomy:z.enum(['guided','automatic']).default('guided')});
export function executionService(store) {
  store.db.exec("CREATE TABLE IF NOT EXISTS project_execution(project_id TEXT PRIMARY KEY REFERENCES projects(id),autonomy TEXT NOT NULL DEFAULT 'guided')");
  const get=projectId=>({autonomy:store.one('SELECT autonomy FROM project_execution WHERE project_id=?',projectId)?.autonomy||'guided'});
  const set=(projectId,value)=>{const v=executionSchema.parse(value);store.exec('INSERT INTO project_execution VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET autonomy=excluded.autonomy',projectId,v.autonomy);return v;};
  return {get,set};
}
export function needsApproval(name,project,policy) {
  if(name==='ask_user'||name==='computer_login')return true;
  if(name.startsWith('mcp_'))return policy.autonomy!=='automatic';
  if(name==='computer_action'||name==='computer_capture'||name==='computer_explore')return policy.autonomy!=='automatic';
  if(name==='run_command'||name==='runtime_info'||name==='install_packages'||name==='transcribe_media')return policy.autonomy!=='automatic';
  return false;
}
