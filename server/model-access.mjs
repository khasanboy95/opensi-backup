import {HttpError} from './security.mjs';
// This model is private to the platform owner's account, including automatic routing.
export function modelAllowed(store,config,userId,model) {
  if(!/astra/i.test(String(model)))return true;
  const user=store.one('SELECT email,disabled FROM users WHERE id=?',userId);
  return Boolean(user&&!user.disabled&&user.email?.toLowerCase()===(config.astraOwnerEmail||'khasandjemilov@gmail.com').toLowerCase());
}
export function assertModelAllowed(store,config,userId,model){if(!modelAllowed(store,config,userId,model))throw new HttpError(403,'Bu model faqat OpenSI egasining hisobida mavjud.');}
export function visibleProviders(store,config,userId,providers){return providers.map(p=>({...p,models:p.models.filter(m=>modelAllowed(store,config,userId,m)),...(p.model_labels?{model_labels:Object.fromEntries(Object.entries(p.model_labels).filter(([m])=>modelAllowed(store,config,userId,m)))}:{})})).filter(p=>p.models.length);}
