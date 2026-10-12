import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {tempDir,removeTemp} from './helpers.mjs';

test('browser folder tools modify selected handles and reject traversal/terminal',async()=>{
 const tmp=await tempDir();try{
  const output=path.join(tmp,'browser.mjs');await build({entryPoints:['src/browser-workspace.ts'],bundle:true,platform:'browser',format:'esm',outfile:output});
  const {browserFileTool}=await import(pathToFileURL(output).href);
  const values=new Map([['index.html','<h1>Existing</h1>']]);
  const root={async getFileHandle(name,{create=false}={}){if(!values.has(name)){if(!create)throw Error('NotFound');values.set(name,'');}return {async getFile(){const text=values.get(name);return {size:text.length,lastModified:0,text:async()=>text,arrayBuffer:async()=>new TextEncoder().encode(text).buffer};},async createWritable(){let next;return {write:async text=>{next=text;},close:async()=>values.set(name,next),abort:async()=>{}};}};},async *entries(){for(const key of values.keys())yield [key,{kind:'file',...await this.getFileHandle(key)}];}};
  assert.equal((await browserFileTool(root,'read_file',{path:'index.html'})).content,'<h1>Existing</h1>');
  await browserFileTool(root,'edit_file',{path:'index.html',search:'Existing',replace:'Continued'});
  await browserFileTool(root,'copy_file',{from:'index.html',path:'copy.html'});
  assert.equal(values.get('copy.html'),'<h1>Continued</h1>');
  assert.equal((await browserFileTool(root,'list_files',{})).total,2);
  assert.equal(Buffer.from((await browserFileTool(root,'preview_file',{path:'index.html'})).base64,'base64').toString(),'<h1>Continued</h1>');
  await assert.rejects(browserFileTool(root,'read_file',{path:'../secret'}));
  await assert.rejects(browserFileTool(root,'write_file',{path:'.env',content:'secret'}));
  await assert.rejects(browserFileTool(root,'run_command',{command:'python app.py'}));
 }finally{await removeTemp(tmp);}
});
