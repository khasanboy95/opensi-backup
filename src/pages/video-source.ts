export type VideoSource = 'flow'|'veoflow'|'api';

export const FLOW_ACCOUNT_KEY = 'opensi:preferred-google-flow-email';
export const VEOFLOW_ACCOUNT_KEY = 'opensi:preferred-veoflow-email';
export const VIDEO_SOURCE_KEY = 'opensi:preferred-video-source';
const FLOW_BILLING_POLICY_KEY = 'opensi:flow-video-billing-v1';

export function readVideoSource():VideoSource {
 try {
  // Migrate the prior auto-selected API mode back to Flow on every browser.
  if(window.localStorage.getItem(FLOW_BILLING_POLICY_KEY)!=='1'){
   window.localStorage.setItem(FLOW_BILLING_POLICY_KEY,'1');
   window.localStorage.setItem(VIDEO_SOURCE_KEY,'flow');
   return 'flow';
  }
  const source=window.localStorage.getItem(VIDEO_SOURCE_KEY);
  if(source==='flow'||source==='veoflow'||source==='api')return source;
  if(window.localStorage.getItem(FLOW_ACCOUNT_KEY))return 'flow';
  if(window.localStorage.getItem(VEOFLOW_ACCOUNT_KEY))return 'veoflow';
 } catch { /* Storage may be disabled. */ }
 return 'flow';
}

export function rememberVideoSource(source:VideoSource){
 try{window.localStorage.setItem(VIDEO_SOURCE_KEY,source);}catch{/* Storage may be disabled. */}
 window.dispatchEvent(new CustomEvent('opensi:video-source-changed',{detail:source}));
}
