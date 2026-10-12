export function mediaRetryAt(body, retryAfter, from=Date.now()) {
  let delayMs=0;
  if(retryAfter) {
    const seconds=Number(retryAfter);
    if(Number.isFinite(seconds)&&seconds>0)delayMs=seconds*1000;
    else {const date=Date.parse(retryAfter);if(Number.isFinite(date))delayMs=date-from;}
  }
  if(!delayMs) {
    const match=String(body).match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?/i);
    if(match&&(match[1]||match[2]||match[3]))delayMs=((Number(match[1]||0)*3600)+(Number(match[2]||0)*60)+Number(match[3]||0))*1000;
  }
  // A provider can omit Retry-After. Back off for an hour rather than retrying in a loop.
  return new Date(from+Math.min(24*3600_000,Math.max(60_000,delayMs?delayMs+60_000:3600_000))).toISOString();
}
