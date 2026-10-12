import {HttpError} from './security.mjs';

const key = userId => `video-account-preferences:v1:${userId}`;
const empty = {flowEmail:'',veoflowEmail:''};
const fields = {flow:'flowEmail',veoflow:'veoflowEmail'};

export function videoAccountPreferences(store,userId) {
  return {...empty,...store.setting(key(userId),empty)};
}

export function videoAccountPreferenceRoutes(app,store,parse,z) {
  app.get('/api/video/account-preferences',(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json(videoAccountPreferences(store,req.user.id));
  });
  app.patch('/api/video/account-preferences',(req,res)=>{
    const value=parse(z.object({source:z.enum(['flow','veoflow']),email:z.string().trim().max(254)}).strict(),req.body);
    if(value.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email))throw new HttpError(400,'Hisob emaili noto‘g‘ri.');
    const preferences=videoAccountPreferences(store,req.user.id);
    preferences[fields[value.source]]=value.email.toLowerCase();
    store.setSetting(key(req.user.id),preferences);
    res.setHeader('Cache-Control','no-store');
    res.json(preferences);
  });
}
