import {readFile,writeFile,mkdir,lstat,unlink,symlink,statfs,rm,readlink,rename} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const name=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const version=/^(?:[~^<>=\d*][\d\w.*+<>=~^| -]{0,99}|latest|next|beta)$/;
export function dependencies(pkg){const entries=Object.entries({...pkg.dependencies,...pkg.devDependencies});if(!entries.length||entries.length>150)throw Error('Expected 1–150 registry dependencies');for(const [n,v] of entries)if(!name.test(n)||typeof v!=='string'||!version.test(v)||/https?:|git|file:|workspace:|npm:/i.test(v))throw Error('Unsupported dependency specification: '+n);return Object.fromEntries(entries);}
async function main(){
 const root='/workspace',base=root+'/.opensi-node',target=root+'/node_modules';const d=await statfs(root);if(d.bavail*d.bsize<1_200_000_000)throw Error('Node install requires 1.2 GB free disk');
 for(const p of [base,target]){try{const st=await lstat(p);if(p===base&&st.isSymbolicLink()||p===target&&!st.isSymbolicLink())throw Error('Install target already exists as an unsupported directory');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const pkg=JSON.parse(await readFile(root+'/package.json','utf8')),deps=dependencies(pkg),prefix=base+'/install-'+randomUUID();await mkdir(prefix,{recursive:true});
 try{
  await writeFile(prefix+'/package.json',JSON.stringify({name:'opensi-project-dependencies',version:'1.0.0',private:true,dependencies:deps}));
  const code=await new Promise((resolve,reject)=>{const c=spawn('npm',['install','--prefix',prefix,'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org','--https-proxy='+process.env.OPENSI_PACKAGE_PROXY,'--fetch-retries=0','--fetch-timeout=25000','--maxsockets=4'],{cwd:'/tmp',env:{PATH:process.env.PATH,HOME:'/tmp',CI:'true',npm_config_userconfig:'/dev/null',npm_config_globalconfig:'/tmp/no-global-npmrc'},stdio:'inherit'});const timer=setTimeout(()=>c.kill('SIGKILL'),100000);c.once('error',reject);c.once('close',code=>{clearTimeout(timer);resolve(code);});});
  if(code!==0)throw Error('npm dependency installation failed; read the output above');
  const lock=await readFile(prefix+'/package-lock.json','utf8');await writeFile(root+'/opensi-node-lock.json',lock);
  const old=await readlink(target).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  const replacement=prefix+'/link';await symlink(prefix+'/node_modules',replacement);await rename(replacement,target);
  if(old&&/^\/workspace\/\.opensi-node\/install-[a-f0-9-]{36}\/node_modules$/.test(old)&&old!==prefix+'/node_modules')await rm(old.slice(0,-13),{recursive:true,force:true}).catch(()=>{});
  console.log(JSON.stringify({installed:true,dependencies:Object.keys(deps).length,scope:'project',scriptsExecuted:false,next:'Run the real package.json build/test scripts with run_command. Native modules requiring postinstall may need a separate offline build.'}));
 }catch(e){await rm(prefix,{recursive:true,force:true});throw e;}
}
if(process.argv[1]==='/opt/toolchain/install-node.mjs')main().catch(e=>{console.error(e.message);process.exitCode=1;});
