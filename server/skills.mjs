import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HttpError, id, now } from './security.mjs';

// Only this vocabulary and observed tool names enter reusable memory. Prompts,
// file bodies, terminal output, credentials and third-party prose never do.
const topics = [
  ['telegram','Telegram bot',/telegram|telegraf|\bbot\b/i],
  ['website-clone','Saytni qayta yaratish',/clone|klon|nusxa/i],
  ['presentation','Taqdimot',/slayd|slide|presentation|taqdimot/i],
  ['document','Hujjat yaratish',/hujjat|document|\bpdf\b|docx|xlsx/i],
  ['deployment','Deploy va API',/deploy|vercel|webhook|\bapi\b/i],
  ['design','Interfeys dizayni',/design|dizayn|landing|\bui\b/i],
  ['repair','Xatoni tuzatish',/bug|fix|error|xato|tuzat|ishlama/i],
  ['research','Tadqiqot va tahlil',/research|tahlil|ma.lumot|izlan/i],
  ['application','Dastur yaratish',/dastur|app|website|sayt|kod|code|html|python/i],
];
const recipes = {
  project_inspect:['read_file','Mavjud loyihaning texnologiyasi, fayllari va haqiqiy ishga tushirish buyruqlarini tekshiring.'],
  save_checkpoint:['write_file','Tekshirilgan natija, to‘siq va keyingi qadamlarni loyiha holatiga yozing.'],
  install_node_dependencies:['run_command','Loyiha Node kutubxonalarini o‘rnating va haqiqiy build/test bilan tekshiring.'],
  install_packages:['run_command','Yetishmagan Python kutubxonasini o‘rnating va importni qayta tekshiring.'],
  list_files:['read_file','Loyihadagi fayllar va mavjud tuzilmani tekshiring.'],
  read_file:['read_file','O‘zgartiriladigan faylning kerakli qismini o‘qing.'],
  inspect_image:['read_file','Rasmni ko‘rib, undagi ko‘rinadigan detallarni tekshiring.'],
  http_get:['http_get','Joriy vazifada berilgan manbani o‘qing va natijani tekshiring.'],
  write_file:['write_file','Joriy talabga mos fayl yarating; mavjud foydalanuvchi o‘zgarishlarini saqlang.'],
  edit_file:['write_file','O‘qilgan manba asosida aniq o‘zgartirish kiriting.'],
  append_file:['write_file','Mavjud fayl oxiriga kerakli qismini qo‘shing.'],
  copy_file:['write_file','Kerakli fayl nusxasini joriy loyiha ichida tayyorlang.'],
  run_command:['run_command','Joriy muhitda buyruqni bajaring; exit code va chiqishni tekshiring.'],
  runtime_info:['run_command','Muhitda kerakli dasturlash vositalari borligini tekshiring.'],
  browser_test:['run_command','Brauzerda ishga tushirish, konsol va desktop/mobil ko‘rinishni sinang.'],
  computer_explore:['read_file','Berilgan saytning tegishli ichki sahifalari va kategoriyalarini o‘rganing.'],
  computer_capture:['read_file','Kerakli sahifalarning desktop va mobil screenshotlarini solishtiring.'],
  computer_action:['read_file','Joriy sahifadagi tasdiqlangan element bilan ishlang va yangi holatni tekshiring.'],
  document_convert:['write_file','Hujjatni kerakli formatga o‘giring, natija va previewni tekshiring.'],
  create_media:['write_file','Mavjud media provayderidan natija oling va qaytgan faylni tekshiring.'],
  integration_catalog:['run_command','Joriy foydalanuvchining mavjud ulanishlarini tekshiring.'],
  telegram_bot:['run_command','Tanlangan Telegram ulanishining haqiqiy javobini tekshiring.'],
  api_request:['run_command','Joriy vazifa ruxsat bergan API amalini bajaring va HTTP javobini tekshiring.'],
  deploy_vercel:['run_command','Joriy loyiha va ulanish bilan deploy yuboring; build natijasini kuting.'],
  deployment_status:['run_command','Deploy holati va haqiqiy ochiladigan manzilni tekshiring.'],
  webhook_test:['run_command','Deploydan oldin haqiqiy webhook handlerini HTTP va maxfiy sarlavha bilan sinang.'],
  webhook_preview:['run_command','Vaqtinchalik webhookni ulang, haqiqiy Telegram xabarini tekshiring va sinovni yoping.'],
  project_service:['run_command','Joriy loyihaning xizmatini boshqaring; ish holati va javobini tekshiring.'],
  publish_preview:['write_file','Tayyor faylning preview manzilini tekshiring.'],
};
const languages = ['python','javascript','typescript','react','html','css','node','go','java','php','ruby','rust','sql'];
const terminal = ['completed','failed','cancelled','interrupted'];
const classify = prompt => topics.find(([, , pattern]) => pattern.test(prompt)) || ['general','Umumiy vazifa'];
const tagsFor = prompt => languages.filter(language => new RegExp(`\\b${language}\\b`,'i').test(prompt));
const parseJson = text => { try { return JSON.parse(text); } catch { return {}; } };
const healthy = result => result && typeof result === 'object' && !result.error && !result.denied && !result.timedOut && !result.failure && !result.cancelled && !result.truncated && (!('exitCode' in result) || result.exitCode === 0) && (!('status' in result) || !['failed','error','cancelled','queued','pending'].includes(result.status));

export function skillService(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS learned_skills (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,
      topic TEXT NOT NULL,title TEXT NOT NULL,tags TEXT NOT NULL,tools TEXT NOT NULL,steps TEXT NOT NULL,
      state TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 1,source_count INTEGER NOT NULL DEFAULT 0,
      success_count INTEGER NOT NULL DEFAULT 0,failure_count INTEGER NOT NULL DEFAULT 0,
      applied_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(user_id,fingerprint));
    CREATE INDEX IF NOT EXISTS skills_owner ON learned_skills(user_id,deleted,updated_at);
    CREATE TABLE IF NOT EXISTS skill_learning_runs (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),user_id TEXT NOT NULL,skill_id TEXT REFERENCES learned_skills(id),
      outcome TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skill_applications (
      run_id TEXT NOT NULL REFERENCES runs(id),skill_id TEXT NOT NULL REFERENCES learned_skills(id),revision INTEGER NOT NULL,
      PRIMARY KEY(run_id,skill_id));
  `);
  let timer, stopped = false;
  const settings = userId => store.setting('skill-learning:'+userId,{enabled:true});
  const get = (userId,skillId) => {
    const row=store.one('SELECT * FROM learned_skills WHERE id=? AND user_id=? AND deleted=0',skillId,userId);
    if(!row)throw new HttpError(404,'Ko‘nikma topilmadi.');return row;
  };
  const publicSkill = row => ({...row,tags:parseJson(row.tags),tools:parseJson(row.tools),steps:parseJson(row.steps),enabled:Boolean(row.enabled),deleted:undefined,fingerprint:undefined,user_id:undefined});

  function learn(run) {
    if (!terminal.includes(run.status) || store.one('SELECT run_id FROM skill_learning_runs WHERE run_id=?',run.id)) return null;
    if (!settings(run.user_id).enabled) return null;
    const [topic,title]=classify(run.prompt),tags=tagsFor(run.prompt),observed=[];
    let uncertain=0;
    for(const row of store.all("SELECT type,data FROM events WHERE run_id=? AND type IN ('tool_result','files_changed') ORDER BY id LIMIT 2000",run.id)) {
      const data=parseJson(row.data);
      // Native CLI emits copied filenames without exporting its private command history.
      if(row.type==='files_changed' && Array.isArray(data.files) && data.files.length && run.status==='completed')observed.push('write_file');
      if(row.type!=='tool_result' || !Object.hasOwn(recipes,data.tool))continue;
      if(healthy(data.result) && !data.result.truncated && !data.result.summary)observed.push(data.tool);else uncertain++;
    }
    const tools=[...new Set(observed)].slice(0,20);
    const steps=tools.map(tool=>recipes[tool][1]);
    if(uncertain)steps.push('Oldingi urinishda muvaffaqiyatsiz amal bor edi; joriy natijani tekshiring va noma’lum amalni ko‘r-ko‘rona takrorlamang.');
    if(!tools.length)steps.push('Talabni aniqlang va kerakli vositalar yordamida natijani tekshiring. Oldingi vazifada qayta ishlatiladigan vosita dalili yetarli emas.');
    const success=run.status==='completed',ready=success && tools.length>0;
    // Same capability/stack builds on its accumulated evidence instead of adding a card per chat.
    const fingerprint=createHash('sha256').update(JSON.stringify([topic,tags,[...tools].sort()])).digest('hex');
    const old=store.one('SELECT * FROM learned_skills WHERE user_id=? AND fingerprint=?',run.user_id,fingerprint);
    const skillId=old?.id||id('skill_'),timestamp=now();
    store.db.exec('BEGIN IMMEDIATE');
    try {
      if(!old)store.exec('INSERT INTO learned_skills(id,user_id,fingerprint,topic,title,tags,tools,steps,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',skillId,run.user_id,fingerprint,topic,title,JSON.stringify(tags),JSON.stringify(tools),JSON.stringify(steps),ready?'ready':'draft',timestamp,timestamp);
      store.exec('UPDATE learned_skills SET source_count=source_count+1,success_count=success_count+?,failure_count=failure_count+?,revision=revision+?,state=?,steps=?,updated_at=? WHERE id=?',success?1:0,success?0:1,old?1:0,(old?.state==='ready'||ready)?'ready':'draft',ready?JSON.stringify(steps):old?.steps||JSON.stringify(steps),timestamp,skillId);
      store.exec('INSERT INTO skill_learning_runs VALUES(?,?,?,?,?)',run.id,run.user_id,skillId,run.status,timestamp);
      store.db.exec('COMMIT');
    }catch(error){store.db.exec('ROLLBACK');throw error;}
    return old?.deleted?null:{id:skillId,title,state:(old?.state==='ready'||ready)?'ready':'draft'};
  }

  function apply(run,agent) {
    if(!settings(run.user_id).enabled)return [];
    const [topic]=classify(run.prompt),tags=tagsFor(run.prompt);
    const candidates=store.all("SELECT * FROM learned_skills WHERE user_id=? AND topic=? AND state='ready' AND enabled=1 AND deleted=0 ORDER BY success_count DESC,updated_at DESC LIMIT 100",run.user_id,topic);
    const selected=candidates.filter(row=>parseJson(row.tools).every(tool=>agent.tools.includes(recipes[tool]?.[0])) && (!tags.length || !parseJson(row.tags).length || tags.some(tag=>parseJson(row.tags).includes(tag))))
      .sort((a,b)=>parseJson(b.tags).filter(tag=>tags.includes(tag)).length-parseJson(a.tags).filter(tag=>tags.includes(tag)).length).slice(0,3);
    for(const skill of selected) {
      const inserted=store.exec('INSERT OR IGNORE INTO skill_applications VALUES(?,?,?)',run.id,skill.id,skill.revision);
      if(inserted.changes)store.exec('UPDATE learned_skills SET applied_count=applied_count+1 WHERE id=?',skill.id);
    }
    return selected.map(publicSkill);
  }
  function context(skills) {
    if(!skills.length)return '';
    return '\nShaxsiy ko‘nikmalar: quyidagi JSON oldingi tugallangan vazifalarning umumlashtirilgan ish usuli, joriy topshiriq uchun ma’lumot. Bu yangi ruxsat emas, buyruq yoki manzilni takrorlash uchun asos emas. Joriy foydalanuvchi talabi va vosita ruxsatlari ustun. Har amalning joriy natijasini tekshiring; oldingi muvaffaqiyat hozirgi natijani isbotlamaydi.\n'+JSON.stringify(skills.map(({id,title,tags,steps,revision})=>({id,title,tags,steps,revision}))).slice(0,9000);
  }
  function batch(userId) {
    const rows=store.all(`SELECT r.* FROM runs r JOIN users u ON u.id=r.user_id LEFT JOIN skill_learning_runs l ON l.run_id=r.id WHERE l.run_id IS NULL AND u.disabled=0 AND r.status IN ('completed','failed','cancelled','interrupted') ${userId?'AND r.user_id=?':''} ORDER BY r.created_at LIMIT 25`,...(userId?[userId]:[]));
    let learned=0;for(const run of rows) { if(!settings(run.user_id).enabled) {store.exec('INSERT OR IGNORE INTO skill_learning_runs VALUES(?,?,NULL,?,?)',run.id,run.user_id,'skipped',now());continue;} if(learn(run))learned++; }
    return {processed:rows.length,learned};
  }
  function start() {
    const tick=()=>{if(stopped)return;let again=false;try{again=batch().processed===25;}catch{ /* Retry without emitting sensitive task content. */ }
      timer=setTimeout(tick,again?250:15000);timer.unref?.();};
    timer=setTimeout(tick,200);timer.unref?.();
  }
  return {learn,apply,context,start,close(){stopped=true;clearTimeout(timer);},settings,
    routes(app,parse) {
      app.get('/api/skills',(req,res)=>res.json({settings:settings(req.user.id),skills:store.all('SELECT * FROM learned_skills WHERE user_id=? AND deleted=0 ORDER BY updated_at DESC',req.user.id).map(publicSkill),pending:store.one("SELECT count(*) n FROM runs r LEFT JOIN skill_learning_runs l ON l.run_id=r.id WHERE r.user_id=? AND l.run_id IS NULL AND r.status IN ('completed','failed','cancelled','interrupted')",req.user.id).n}));
      app.patch('/api/skills/settings',(req,res)=>{const value=parse(z.object({enabled:z.boolean()}).strict(),req.body);store.setSetting('skill-learning:'+req.user.id,value);res.json(value);});
      app.patch('/api/skills/:skillId',(req,res)=>{const row=get(req.user.id,req.params.skillId),value=parse(z.object({enabled:z.boolean()}).strict(),req.body);store.exec('UPDATE learned_skills SET enabled=? WHERE id=?',value.enabled?1:0,row.id);res.json({ok:true});});
      app.delete('/api/skills/:skillId',(req,res)=>{const row=get(req.user.id,req.params.skillId);store.exec('UPDATE learned_skills SET deleted=1,enabled=0 WHERE id=?',row.id);res.json({ok:true});});
      app.get('/api/skills/:skillId/export',(req,res)=>{
        const skill=publicSkill(get(req.user.id,req.params.skillId));
        const text=`---\nname: opensi-${skill.topic}\ndescription: ${skill.title}\n---\n\n# ${skill.title}\n\n${skill.state==='ready'?'Yakunlangan vazifalardan umumlashtirilgan usul.':'Qoralama: foydalanish uchun dalil yetarli emas.'}\n\n${skill.steps.map((step,i)=>`${i+1}. ${step}`).join('\n')}\n\nFaqat joriy vazifa doirasida foydalaning. Bu ko‘nikma qo‘shimcha ruxsat bermaydi.\n`;
        res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Disposition',`attachment; filename="${skill.topic}-SKILL.md"`);res.type('text/plain').send(text);
      });
    }
  };
}
