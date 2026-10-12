// Provider failures are distinct from OpenSI's own account/permission limits.
export function withProviderFailure(error, metadata) {
  if (!metadata || typeof metadata !== 'object') return error;
  if (['quota','rate','transient','auth','permission'].includes(metadata.kind)) error.providerFailureKind = metadata.kind;
  if ([401,402,403,429,500,502,503,504].includes(metadata.status)) error.providerStatus = metadata.status;
  if (['RESOURCE_EXHAUSTED','RATE_LIMITED','UNAVAILABLE','UNAUTHENTICATED','PERMISSION_DENIED'].includes(metadata.code)) error.providerCode = metadata.code;
  if (Number.isFinite(metadata.retryAfterMs) && metadata.retryAfterMs > 0) error.retryAfterMs = Math.min(86400000, metadata.retryAfterMs);
  return error;
}

export function modelFailure(error) {
  const message=String(error?.message||error),status=error?.providerStatus,kind=error?.providerFailureKind;
  if ([401,403].includes(status) || ['auth','permission'].includes(kind)) return null;
  if(/denied|permission|forbidden|rad et|tasdiq|disabled|content.?policy|safety|refusal|cancelled|Hisob faol emas|Oylik token|token limiti tugagan/i.test(message))return null;
  const quota=kind==='quota'||status===402||/\b402\b|insufficient_quota|billing_hard_limit|credit[s]?[ _-]*(?:exhausted|depleted)|balance[ _-]*(?:exhausted|insufficient)|quota[ _-]*(?:exhausted|exceeded|reached)|usage_limit_reached|resource_exhausted|token[ _-]*limit[ _-]*(?:exceeded|reached)/i.test(message);
  const rate=kind==='rate'||status===429||/\b429\b|rate.?limit|too many requests/i.test(message);
  const transient=kind==='transient'||/\b50[0234]\b|overload|service_unavailable|timed? ?out|timeout|fetch failed|ECONNRESET|empty response|bo‘sh javob|vosita chaqiruvi to‘liq emas|Unexpected.*JSON|Unexpected token|kutish (?:chegarasi|vaqti tugadi)|Model so‘rovi qabul qilinmadi|oqim.*uzil|oqimi.*uzil/i.test(message);
  if(!quota&&!rate&&!transient)return null;
  // Only explicit balance/account-wide exhaustion disables sibling models.
  const account=status===402||/\b402\b|insufficient_quota|billing_hard_limit|credits?[ _-]*(?:exhausted|depleted)|balance[ _-]*(?:exhausted|insufficient)|account[ _-]*quota/i.test(message);
  const retry=Number(error?.retryAfterMs);
  return {kind:quota?'quota':rate?'rate':'transient',scope:account?'provider':'model',
    cooldownMs:Number.isFinite(retry)&&retry>0?Math.min(86400000,Math.max(1000,retry)):quota?300000:rate?60000:15000};
}

export function createModelHealth(clock=Date.now) {
  const blocked=new Map();
  const key=(user,c,scope)=>JSON.stringify([user,c.providerId,scope==='provider'?'*':c.model]);
  const prune=()=>{for(const [k,v] of blocked)if(v.until<=clock())blocked.delete(k);};
  return {
    available(user,candidates){prune();return candidates.filter(c=>!blocked.has(key(user,c,'provider'))&&!blocked.has(key(user,c,'model')));},
    fail(user,candidate,error){const failure=modelFailure(error);if(!failure)return null;prune();blocked.set(key(user,candidate,failure.scope),{until:clock()+failure.cooldownMs});return failure;},
  };
}
