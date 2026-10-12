import path from 'node:path';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,rename,unlink,rm,lstat} from 'node:fs/promises';
import {fileTool,safePath,validFileName} from './files.mjs';
import {containsSecret} from './project-import.mjs';
import {parallelInventory,privateParallelPath} from './parallel-files.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const optionalRead=async target=>{try{return await readFile(target);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
const hashOf=bytes=>bytes===null?null:digest(bytes);
const maxBytes=64_000_000,maxFileBytes=16_000_000;
async function atomicWrite(root,name,bytes){
  const target=await safePath(root,name);await mkdir(path.dirname(target),{recursive:true});
  const temp=path.join(path.dirname(target),'.opensi-merge-'+createHash('sha256').update(name+Date.now()+Math.random()).digest('hex').slice(0,16));
  try{await writeFile(temp,bytes);await rename(temp,target);}finally{await unlink(temp).catch(()=>{});}
}

// Snapshots and base bytes stay next to the executing filesystem. For linked
// projects this module runs in the connector, never in server storage.
export function parallelWorkspace(source,directory,{workRoot}={}){
  const work=workRoot||path.join(directory,'work'),base=path.join(directory,'base'),metaFile=path.join(directory,'state.json');
  const load=async()=>{const value=JSON.parse(await readFile(metaFile,'utf8'));if(value.source!==path.resolve(source))throw Error('Parallel papka boshqa loyihaga tegishli.');return value;};
  const save=async value=>{await mkdir(directory,{recursive:true});const temp=metaFile+'.tmp';await writeFile(temp,JSON.stringify(value));await rename(temp,metaFile);};
  async function current(name){return optionalRead(await safePath(source,name));}
  const report=(state,resumed=false)=>({created:true,resumed,files:Object.keys(state.files).length,bytes:state.bytes||0,total:state.inventory?.length??Object.keys(state.files).length,lazyFiles:(state.inventory||[]).filter(f=>!Object.hasOwn(state.files,f.path)&&!state.blocked?.[f.path]).length,skipped:state.skipped||{}});
  async function capture(state,name){
    validFileName(name);if(privateParallelPath(name)||state.blocked?.[name])throw Error('Maxfiy yoki bog‘liqlik fayli parallel ishga berilmaydi.');
    if(Object.hasOwn(state.files,name))return;
    const baseTarget=await safePath(base,name),original=await optionalRead(baseTarget);
    const target=await safePath(source,name);let stat;
    try{stat=await lstat(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!original&&!stat){state.files[name]=null;return;}
    if(stat&&!stat.isFile())throw Error('Parallel amal uchun fayl yo‘lini tanlang.');
    const size=original?.length??stat.size;
    if(size>maxFileBytes||(state.bytes||0)+size>maxBytes)throw Error('Bu fayl parallel ish nusxasining 64 MB / 16 MB chegarasiga sig‘madi. Boshqa manba fayllari bilan davom eting; katta faylni nazorat modeli asl loyihada tekshiradi.');
    const bytes=original??await readFile(target);
    if(bytes.length>maxFileBytes||(state.bytes||0)+bytes.length>maxBytes)throw Error('Parallel fayl o‘qish paytida kattalashdi. Faylni qayta tekshiring.');
    if(containsSecret(bytes.toString('utf8'))){(state.blocked||={})[name]=true;return;}
    // Base bytes may exist after a process died between copying and saving its
    // manifest. Recover them without replacing edits already in the scratch.
    if(!original)await atomicWrite(base,name,bytes);
    if(!original||await optionalRead(await safePath(work,name))===null)await atomicWrite(work,name,bytes);
    state.files[name]=digest(bytes);state.bytes=(state.bytes||0)+bytes.length;
  }
  async function inventory(state){
    const after=(await parallelInventory(work)).files,map=new Map((state.inventory||[]).filter(f=>!state.blocked?.[f.path]&&!Object.hasOwn(state.files,f.path)).map(f=>[f.path,{...f,materialized:false}]));
    for(const f of after)if(!state.blocked?.[f.path])map.set(f.path,{...f,materialized:true});
    return [...map.values()].sort((a,b)=>a.path.localeCompare(b.path));
  }
  async function proposals(){
    const state=await load(),files=(await parallelInventory(work)).files,after=new Map(files.map(f=>[f.path,f]));
    const changes=[];
    for(const name of new Set([...Object.keys(state.files),...after.keys()])){
      validFileName(name);if(privateParallelPath(name)||state.blocked?.[name])continue;
      const proposed=after.has(name)?await optionalRead(await safePath(work,name)):null;
      if(proposed&&proposed.length>maxFileBytes)throw Error('Parallel natijadagi fayl 16 MB dan katta.');
      const proposedHash=hashOf(proposed),baseHash=state.files[name]??null;
      if(baseHash===proposedHash)continue;
      changes.push({path:name,baseHash,proposedHash,action:proposed===null?'delete':'write'});
      if(changes.length>300)throw Error('Bitta qo‘shimcha ish 300 dan ortiq faylni o‘zgartirdi. Ishni kichik qismlarga bo‘ling.');
    }
    return changes;
  }
  return {work,
    async seed(files){
      try{if((await load()).complete)return {created:true,resumed:true};}catch(error){if(error.code!=='ENOENT')throw error;}
      if(!Array.isArray(files)||files.length>300)throw Error('Parallel manba ro‘yxati noto‘g‘ri.');
      let size=0;const manifest={};
      for(const file of files){validFileName(file.path);if(typeof file.base64!=='string')throw Error('Parallel manba baytlari noto‘g‘ri.');const bytes=Buffer.from(file.base64,'base64');size+=bytes.length;if(size>5_000_000)throw Error('Antigravity parallel manbasi 5 MB dan oshdi.');await atomicWrite(base,file.path,bytes);await atomicWrite(work,file.path,bytes);manifest[file.path]=digest(bytes);}
      await mkdir(work,{recursive:true});await save({source:path.resolve(source),files:manifest,merged:{},native:{},complete:true});return {created:true,files:files.length,bytes:size};
    },
    async export(){const changes=await proposals(),files=[];let size=0;for(const change of changes){const bytes=change.action==='delete'?null:await readFile(await safePath(work,change.path));size+=bytes?.length||0;if(size>5_000_000)throw Error('Antigravity parallel natijasi 5 MB dan oshdi.');files.push({path:change.path,base64:bytes?.toString('base64')??null});}return {files};},
    async create(signal){
      let previous;
      try{previous=await load();if(previous.complete)return report(previous,true);}catch(error){if(error.code!=='ENOENT')throw error;}
      const indexed=await parallelInventory(source,signal),files=indexed.files;
      const state=previous||{source:path.resolve(source),files:{},merged:{},native:{},complete:false};
      // Older interrupted snapshots did not keep a byte counter.
      if(state.bytes===undefined){state.bytes=0;for(const name of Object.keys(state.files))state.bytes+=(await lstat(await safePath(base,name)).catch(()=>({size:0}))).size;}
      state.inventory=files;state.skipped=indexed.skipped;state.blocked||={};await save(state);
      const large=files.length>1000||files.some(f=>f.size>maxFileBytes)||files.reduce((n,f)=>n+f.size,0)>maxBytes;
      const sourceRank=name=>/\.(?:[cm]?[jt]sx?|py|json|html?|css|md|toml|ya?ml|go|rs|java|[ch](?:pp)?|cs|sh|ps1|txt)$/i.test(name)?0:1;
      const eager=large?files.slice().sort((a,b)=>sourceRank(a.path)-sourceRank(b.path)||a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path)):files;
      let count=0;
      try{
        for(const file of eager){
          signal?.throwIfAborted();if(Object.hasOwn(state.files,file.path))continue;
          if(file.size>maxFileBytes||state.bytes+file.size>maxBytes||large&&(count>=250||state.bytes+file.size>8_000_000))continue;
          await capture(state,file.path);if(++count%32===0)await save(state);
        }
        await mkdir(work,{recursive:true});state.complete=true;
      }finally{await save(state);}
      return report(state,Boolean(previous));
    },
    async files(tool,args){
      const state=await load();
      if(tool==='list_files'){
        const all=(await inventory(state)).filter(f=>!args.path||f.path.startsWith(args.path)),offset=Math.max(0,args.offset||0),limit=Math.min(500,Math.max(1,args.limit||200));
        return {files:all.slice(offset,offset+limit),total:all.length,nextOffset:offset+limit<all.length?offset+limit:null,truncated:offset+limit<all.length,lazyFiles:report(state).lazyFiles};
      }
      if(tool==='prepare_files'){
        const prefix=(args.path||'').replace(/\/$/,'');if(prefix)validFileName(prefix);
        const missing=(state.inventory||[]).filter(f=>(!prefix||f.path===prefix||f.path.startsWith(prefix+'/'))&&!Object.hasOwn(state.files,f.path)&&!state.blocked?.[f.path]);
        if(missing.some(f=>f.size>maxFileBytes)||(state.bytes||0)+missing.reduce((n,f)=>n+f.size,0)>maxBytes)throw Error('Tanlangan papka parallel nusxaga sig‘madi. prepare_files bilan kerakli ichki loyiha papkasini tanlang; qolgan manbalar list_files/read_file orqali ochiladi.');
        try{for(const file of missing)await capture(state,file.path);}finally{await save(state);}
        return {...report(state),preparedPath:prefix};
      }
      for(const name of new Set([args.path,args.from].filter(Boolean))){await capture(state,name);await save(state);if(state.blocked?.[name])throw Error('Maxfiy ma’lumotli fayl parallel ishga berilmaydi.');}
      return fileTool(work,tool,args);
    },
    async import(files){await load();if(!Array.isArray(files)||files.length>300)throw Error('Parallel natija ro‘yxati noto‘g‘ri.');let size=0;for(const file of files){validFileName(file.path);if(file.base64===null){const target=await safePath(work,file.path);await unlink(target).catch(error=>{if(error.code!=='ENOENT')throw error;});}else {if(typeof file.base64!=='string')throw Error('Parallel natija baytlari noto‘g‘ri.');const bytes=Buffer.from(file.base64,'base64');size+=bytes.length;if(size>5_000_000)throw Error('Parallel natija 5 MB dan katta.');await atomicWrite(work,file.path,bytes);}}return {saved:true};},
    async state(){const state=await load();return state.native||{};},
    async native(value){const state=await load();state.native=value;await save(state);},
    async changes(){return {changes:await proposals()};},
    async apply(signal){
      const state=await load(),changes=await proposals(),result=[];
      for(const change of changes){
        signal?.throwIfAborted();const bytes=await current(change.path),currentHash=hashOf(bytes);
        if(currentHash===change.proposedHash){state.merged[change.path]=currentHash;result.push({...change,currentHash,state:'applied'});continue;}
        // A resolved edit is deliberately different from the proposal. Never
        // replace it on a replay after server or connector recovery.
        if(Object.hasOwn(state.merged,change.path)){result.push({...change,currentHash,state:'resolved'});continue;}
        if(currentHash!==change.baseHash){result.push({...change,currentHash,state:'conflict'});continue;}
        if(change.action==='delete')await unlink(await safePath(source,change.path));
        else await atomicWrite(source,change.path,await readFile(await safePath(work,change.path)));
        state.merged[change.path]=change.proposedHash;await save(state);
        result.push({...change,currentHash:change.proposedHash,state:'applied'});
      }
      await save(state);return {changes:result};
    },
    async read(name,{offset=0,limit=6000}={}){
      validFileName(name);if(privateParallelPath(name))throw Error('Maxfiy fayl parallel tekshiruvga berilmaydi.');
      await load();const original=await optionalRead(await safePath(base,name)),proposed=await optionalRead(await safePath(work,name)),actual=await current(name);
      const text=bytes=>{if(bytes===null)return null;if(bytes.includes(0)||bytes.length>500_000)return undefined;return bytes.toString('utf8');};
      const texts={base:text(original),proposed:text(proposed),current:text(actual)},totals=Object.fromEntries(Object.entries(texts).map(([k,v])=>[k,v?.length||0]));
      offset=Math.max(0,Number(offset)||0);limit=Math.min(10000,Math.max(1,Number(limit)||6000));
      return {path:name,baseHash:hashOf(original),proposedHash:hashOf(proposed),currentHash:hashOf(actual),...Object.fromEntries(Object.entries(texts).map(([k,v])=>[k,v?.slice(offset,offset+limit)??v])),totals,offset,nextOffset:Object.values(totals).some(n=>n>offset+limit)?offset+limit:null,binary:[original,proposed,actual].some(b=>b&&(b.includes(0)||b.length>500_000))};
    },
    async resolve({path:name,expectedHash,content,remove=false,choice}){
      validFileName(name);if(privateParallelPath(name))throw Error('Maxfiy faylni o‘zgartirish mumkin emas.');
      const state=await load(),actual=await current(name);
      if(hashOf(actual)!==expectedHash)throw Error('Fayl tekshiruvdan keyin o‘zgargan. Qayta o‘qib birlashtiring.');
      if(choice==='current'){state.merged[name]=hashOf(actual);}
      else if(choice==='proposed'){const bytes=await optionalRead(await safePath(work,name));if(bytes===null){if(actual!==null)await unlink(await safePath(source,name));}else await atomicWrite(source,name,bytes);state.merged[name]=hashOf(bytes);}
      else if(remove){if(actual!==null)await unlink(await safePath(source,name));state.merged[name]=null;}
      else {if(typeof content!=='string'||Buffer.byteLength(content)>500_000)throw Error('Birlashtiriladigan matn 500 KB dan oshmasligi kerak.');await atomicWrite(source,name,Buffer.from(content));state.merged[name]=digest(Buffer.from(content));}
      await save(state);return {path:name,resolved:true,currentHash:state.merged[name]};
    },
    async cleanup(){
      // Only remove the explicit scratch directory, never a computed ancestor.
      const target=path.resolve(directory),original=path.resolve(source);
      if(target===original||original.startsWith(target+path.sep)||path.basename(target).length<8)throw Error('Parallel papkani tozalash yo‘li noto‘g‘ri.');
      if((await lstat(target)).isSymbolicLink())throw Error('Parallel papka symlink bo‘lishi mumkin emas.');
      await load();
      if(workRoot){const scratch=path.resolve(workRoot);if(scratch===original||original.startsWith(scratch+path.sep)||!/^prj_[a-f0-9]{24}$/.test(path.basename(scratch)))throw Error('Parallel ish nusxasi yo‘li noto‘g‘ri.');if((await lstat(scratch)).isSymbolicLink())throw Error('Parallel ish nusxasi symlink bo‘lishi mumkin emas.');await rm(scratch,{recursive:true,force:true});}
      await rm(target,{recursive:true,force:true});return {cleaned:true};
    }
  };
}
