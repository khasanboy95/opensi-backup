// Keep ownership until teardown finishes, including a launch that resolves after close.
export function sessionLifecycle({sessions,launch,prepare,dispose,limit=2}) {
  async function open(id) {
    const existing=sessions.get(id);
    if(existing){if(existing.closing)throw Object.assign(new Error('Sessiya yopilmoqda.'),{status:409});return existing.ready;}
    if(sessions.size>=limit)throw Object.assign(new Error('Serverda brauzer sessiyalari band.'),{status:409});
    const s={id,last:Date.now(),blocked:[],busy:false,assets:new Map(),assetBytes:0,closing:false};
    sessions.set(id,s);
    s.ready=(async()=>{
      try {
        s.resource=await launch(s);
        if(s.closing)throw new Error('Session opening cancelled');
        const result=await prepare(s);
        if(s.closing)throw new Error('Session opening cancelled');
        return result;
      } catch(error) {
        await release(s);
        if(sessions.get(id)===s)sessions.delete(id);
        throw error;
      }
    })();
    return s.ready;
  }
  async function release(s){
    if(!s.resource)return;
    s.disposing??=Promise.resolve().then(()=>dispose(s.resource));
    await s.disposing;
  }
  async function close(id){
    const s=sessions.get(id);if(!s)return {ok:true};
    s.closing=true;
    s.closed??=(async()=>{
      // Dispose now to interrupt a stalled page; ready also disposes late launches.
      await release(s);
      await s.ready.catch(()=>{});
      await release(s);
      if(sessions.get(id)===s)sessions.delete(id);
      return {ok:true};
    })();
    return s.closed;
  }
  return {open,close};
}
