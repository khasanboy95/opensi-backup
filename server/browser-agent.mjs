// Only observations/captures may be replayed. Clicks, form submissions and
// unknown-outcome external actions must be inspected instead of auto-repeated.
export function transientBrowserError(error){
 if([401,403].includes(error?.status)||/denied|permission|forbidden|rad et|ruxsat|tasdiq|boshqaruv.*foydalanuvchi|to‘xtatgan/i.test(error?.message||''))return false;
 return [502,503,504].includes(error?.status)||/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|ERR_CONNECTION_(?:RESET|CLOSED)|ERR_TIMED_OUT/i.test(error?.message||'');
}

export async function browserAgentTool({computer,name,args,run,project,signal,approval,automatic=false,publicPage=false,onRecovery=()=>{}}){
 if(publicPage&&['computer_capture','computer_explore'].includes(name)){const {maxPages,maxDepth,...captureArgs}=args;name='computer_capture';args={...captureArgs,publicPage:true};}
 const readOnly=['computer_observe','computer_capture','computer_explore'].includes(name);
 let request={...args},readRetries=0;
 while(true){
  signal.throwIfAborted();
  let result;
  try{
   if(automatic)await computer.ensureAgent(run.user_id,project.id,signal);
   result=await computer.tool(name,request,run,project,signal);
  }catch(error){
   if(signal.aborted||!readOnly||readRetries++>=1||!transientBrowserError(error))throw error;
   onRecovery({tool:name,kind:'browser_retry',message:'Brauzer ulanishi vaqtincha uzildi. Agent holatni tekshirib, o‘qish amalini qayta bajaryapti.'});
   continue;
  }
  if(!result?.handoffRequired)return result;
  computer.beginHandoff(run.user_id,project.id,result.reason);
  while(true){
   const decision=await approval(run,'computer_login',{reason:result.reason,url:result.url,projectId:project.id},signal);
   if(!decision.approved)return {denied:true,message:'Foydalanuvchi brauzer ishini davom ettirmadi. Boshqaruv unda qoladi.'};
   try{await computer.finishHandoff(run.user_id,project.id,signal);break;}
   catch(error){if(signal.aborted||error.status!==409)throw error;result={...result,reason:error.message};}
  }
  onRecovery({tool:name,kind:'browser_resumed',message:'Kirish yakunlandi. Agent shu loyihadagi brauzer tahlilini davom ettiryapti.'});
  // Continue the authenticated page, rather than navigating back to /login or
  // returning a bare observation that silently discards the requested capture.
  if(readOnly){if(result.resumeCurrentPage&&name!=='computer_observe')request={...request,url:undefined};}
  else return computer.tool('computer_observe',{},run,project,signal);
 }
}
