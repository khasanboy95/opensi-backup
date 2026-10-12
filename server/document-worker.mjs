// A bounded child process: no provider credentials, no uploaded code execution.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import {XMLParser} from 'fast-xml-parser';
import {safePath} from './files.mjs';

export async function unpackZip(bytes,root,{extract=true}={}) {
 const zip=await new Promise((resolve,reject)=>yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,strictFileNames:true},(e,z)=>e?reject(e):resolve(z)));
 const files=[];let total=0,count=0;const xml={};
 return new Promise((resolve,reject)=>{
  const fail=e=>{zip.close();reject(e);};zip.on('error',fail);zip.on('end',()=>resolve({files,xml,total}));
  zip.on('entry',async entry=>{try {
   if(++count>500)throw new Error('ZIP ichida 500 tadan ko‘p yozuv bor.');
   if(entry.generalPurposeBitFlag&1)throw new Error('Parolli ZIP ochilmaydi.');
   if((entry.externalFileAttributes>>>16&0xf000)===0xa000)throw new Error('ZIP symlink qabul qilinmaydi.');
   const name=entry.fileName.replace(/\/$/,'');
   // Validate all entries, including directories; do not silently skip traversal.
   if(!name||name.startsWith('/')||/[\\\x00-\x1f:]/.test(name)||name.split('/').some(p=>p==='..'||p==='.'||!p))throw new Error('ZIP yo‘li noto‘g‘ri.');
   const target=extract?await safePath(root,name):null;
   if(entry.fileName.endsWith('/')){zip.readEntry();return;}
   if(entry.uncompressedSize>50_000_000 || (total+=entry.uncompressedSize)>100_000_000)throw new Error('Ochilgan ZIP 100 MB chegaradan oshdi.');
   if(entry.uncompressedSize>1_000_000 && entry.uncompressedSize/Math.max(entry.compressedSize,1)>200)throw new Error('ZIP siqish nisbati haddan tashqari katta.');
   const stream=await new Promise((ok,no)=>zip.openReadStream(entry,(e,s)=>e?no(e):ok(s)));
   const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>entry.uncompressedSize)throw new Error('ZIP hajmi noto‘g‘ri.');chunks.push(chunk);}
   const content=Buffer.concat(chunks);if(extract){await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx'});}
   if(/^(word\/document|ppt\/slides\/slide\d+|xl\/(sharedStrings|worksheets\/sheet\d+))\.xml$/.test(name)&&size<=5_000_000)xml[name]=content.toString('utf8');
   files.push({path:name,size});zip.readEntry();
  }catch(e){fail(e);}});zip.readEntry();
 });
}
function officeText(xml) {
 const parser=new XMLParser({ignoreAttributes:true,processEntities:true,htmlEntities:true});
 const walk=value=>typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.map(walk).join(' '):value&&typeof value==='object'?Object.entries(value).filter(([k])=>['w:t','a:t','t','v','#text','w:p','w:r','w:body','w:document','p:sld','p:cSld','p:spTree','p:sp','p:txBody','a:p','a:r','sst','si','r','worksheet','sheetData','row','c','is'].includes(k)).map(([,v])=>walk(v)).join(' '):'';
 return Object.entries(xml).map(([name,value])=>{if(/<!DOCTYPE|<!ENTITY/i.test(value))throw new Error('Hujjatda taqiqlangan XML entity bor.');return `--- ${name} ---\n${walk(parser.parse(value))}`;}).join('\n').slice(0,120000);
}
if(process.argv[2]) {
 const [source,kind,output]=process.argv.slice(2);
 try {
  const bytes=await readFile(source);let result;
  if(kind==='pdf') {
   const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
   const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true});
   const doc=await loading.promise;let text='';const pages=Math.min(doc.numPages,100);
   for(let p=1;p<=pages && text.length<120000;p++){const page=await doc.getPage(p);const content=await page.getTextContent();text+=`\n--- Sahifa ${p} ---\n`+content.items.map(i=>i.str||'').join(' ');page.cleanup();}
   result={text:text.slice(0,120000),pages:doc.numPages,truncated:pages<doc.numPages||text.length>=120000};await loading.destroy();
  } else {
   const zip=await unpackZip(bytes,output,{extract:kind==='zip'});result={files:zip.files,text:kind==='zip'?zip.files.map(f=>`${f.path} (${f.size} B)`).join('\n'):officeText(zip.xml)};
  }
  process.stdout.write('\nOPENSI_DOCUMENT_RESULT:'+JSON.stringify(result));
 }catch(e){process.stdout.write('\nOPENSI_DOCUMENT_RESULT:'+JSON.stringify({error:String(e.message).slice(0,250)}));process.exitCode=1;}
}
