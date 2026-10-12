// Runs only inside the networkless document sandbox. No credentials are mounted.
import path from 'node:path';
import {readFile,writeFile,mkdir,realpath,lstat,copyFile,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
import MarkdownIt from 'markdown-it';
const root='/workspace';
async function safe(name){
 if(typeof name!=='string'||name.length>240||name.split('/').some(p=>!p||p.startsWith('.')||p==='node_modules')||/[\\:\x00-\x1f]/.test(name))throw Error('Invalid document path');
 let current=root;for(const p of name.split('/')){current=path.join(current,p);try{if((await lstat(current)).isSymbolicLink())throw Error('Symlink not allowed');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return current;
}
const escape=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function main(){
 const a=JSON.parse(Buffer.from(process.argv[2],'base64url').toString());const input=await safe(a.path),output=await safe(a.output);
 if(!/^exports\/document-[a-f0-9]+\.[a-z0-9]+$/.test(a.output))throw Error('Invalid output');
 const ext=path.extname(input).slice(1).toLowerCase();
 const groups={writer:['doc','docx','odt','rtf','txt','md','html','htm'],calc:['xls','xlsx','ods','csv','tsv'],impress:['ppt','pptx','odp'],image:['png','jpg','jpeg','webp']};
 const kind=Object.keys(groups).find(k=>groups[k].includes(ext));
 const targets={writer:['pdf','docx','odt','rtf','txt'],calc:['pdf','xlsx','ods','csv'],impress:['pdf','pptx','odp'],image:['pdf']};
 if(!kind||!targets[kind].includes(a.format)||a.format===ext)throw Error('Unsupported conversion');
 const size=(await lstat(input)).size;if(size>50_000_000)throw Error('Conversion limit is 50 MB');
 await mkdir('/tmp/document',{recursive:true});await mkdir(path.dirname(output),{recursive:true});
 if(a.format==='pdf'&&['html','htm','md','txt','png','jpg','jpeg','webp'].includes(ext)){
  const bytes=await readFile(input);let html;
  if(kind==='image')html=`<img style="max-width:100%;max-height:250mm;object-fit:contain" src="data:image/${ext==='jpg'?'jpeg':ext};base64,${bytes.toString('base64')}">`;
  else if(ext==='md')html=new MarkdownIt({html:false,linkify:false}).render(bytes.toString('utf8'));
  else if(ext==='txt')html=`<pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(bytes.toString('utf8'))}</pre>`;
  else html=bytes.toString('utf8');
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  try{
   const page=await browser.newPage({javaScriptEnabled:false});
   await page.route('**/*',async route=>{try{const u=new URL(route.request().url());if(u.origin!=='https://document.invalid')return route.abort();const relative=decodeURIComponent(u.pathname).slice(1);const file=await safe(relative);const s=await lstat(file);if(!s.isFile()||s.size>10_000_000||! /\.(png|jpe?g|webp|gif|css|woff2?|ttf)$/i.test(file))return route.abort();await route.fulfill({body:await readFile(file)});}catch{await route.abort();}});
   await page.setContent(`<base href="https://document.invalid/${path.posix.dirname(a.path)}/"><style>body{font:12pt Arial,sans-serif;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #bbb;padding:6px}img{max-width:100%}pre{white-space:pre-wrap}@page{size:A4;margin:16mm}</style>${html}`,{waitUntil:'networkidle',timeout:30000});
   await page.pdf({path:'/tmp/document/result.pdf',format:'A4',printBackground:true,preferCSSPageSize:true,timeout:60000});
  }finally{await browser.close();}
  await copyFile('/tmp/document/result.pdf',output,constants.COPYFILE_EXCL);
 }else{
  let local='/tmp/document/source.'+ext;await copyFile(input,local);
  if(ext==='md'){local='/tmp/document/source.html';await writeFile(local,`<meta charset="utf-8">${new MarkdownIt({html:false}).render(await readFile(input,'utf8'))}`);}
  await mkdir('/tmp/lo-profile/user',{recursive:true});
  await writeFile('/tmp/lo-profile/user/registrymodifications.xcu','<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
  await mkdir('/tmp/document/out',{recursive:true});
  const filters={docx:'Office Open XML Text',odt:'writer8',rtf:'Rich Text Format',txt:'Text (encoded):UTF8',xlsx:'Calc MS Excel 2007 XML',ods:'calc8',csv:'Text - txt - csv (StarCalc):44,34,76',pptx:'Impress MS PowerPoint 2007 XML',odp:'impress8',pdf:kind==='calc'?'calc_pdf_Export':kind==='impress'?'impress_pdf_Export':'writer_pdf_Export'};
  const targetFormat=a.format+':'+filters[a.format];
  await new Promise((resolve,reject)=>{const c=spawn('libreoffice',['-env:UserInstallation=file:///tmp/lo-profile','--headless','--nologo','--nodefault','--norestore','--convert-to',targetFormat,'--outdir','/tmp/document/out',local],{stdio:['ignore','pipe','pipe']});let log='';c.stdout.on('data',d=>log+=d.toString().slice(0,2000));c.stderr.on('data',d=>log+=d.toString().slice(0,2000));c.on('error',reject);c.on('close',code=>code===0?resolve():reject(Error('Office conversion failed: '+log.slice(0,500))));});
  const files=await readdir('/tmp/document/out');const result=files.find(n=>n.endsWith('.'+a.format));if(!result)throw Error('Office could not read this document. Check format/password.');
  await copyFile('/tmp/document/out/'+result,output,constants.COPYFILE_EXCL);
 }
 if(a.format==='pdf'&&!(await readFile(output)).subarray(0,5).equals(Buffer.from('%PDF-')))throw Error('Invalid PDF result');
 console.log(JSON.stringify({path:a.output,size:(await lstat(output)).size,format:a.format}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
