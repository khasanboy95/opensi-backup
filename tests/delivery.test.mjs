import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

test('device folder delivery preserves binary files and nested paths, deduplicates, and recovers permission denial',async()=>{
 const built=await build({entryPoints:['src/delivery.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
 const delivery=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const old={indexedDB:globalThis.indexedDB,window:globalThis.window,fetch:globalThis.fetch};
 const records=new Map(),files=new Map();let permission='granted',writes=0;
 function directory(prefix=''){return {name:'QA output',queryPermission:async()=>permission,requestPermission:async()=>{permission='granted';return permission;},getDirectoryHandle:async name=>directory(prefix+name+'/'),getFileHandle:async name=>({createWritable:async()=>{const chunks=[];return {write:async chunk=>{chunks.push(Buffer.from(chunk));},close:async()=>{files.set(prefix+name,Buffer.concat(chunks));writes++;},abort:async()=>{}}}})};}
 const database={createObjectStore(){},close(){},transaction(){const t={objectStore(){return {get(key){return request(()=>records.get(key));},put(value,key){return request(()=>{records.set(key,value);return key;});}};}};function request(fn){const q={};queueMicrotask(()=>{q.result=fn();q.onsuccess?.();queueMicrotask(()=>t.oncomplete?.());});return q;}return t;}};
 globalThis.indexedDB={open(){const q={result:database};queueMicrotask(()=>q.onsuccess?.());return q;}};
 globalThis.window={showDirectoryPicker:async()=>directory()};
 const bytes=Buffer.from([0,255,128,13,10]);const manifest={files:[{path:'assets/output.bin',size:bytes.length,updated_at:'2026-10-07T00:00:00Z'}]};
 globalThis.fetch=async url=>url.includes('download-manifest')?Response.json(manifest):new Response(new ReadableStream({start(controller){controller.enqueue(bytes.subarray(0,2));controller.enqueue(bytes.subarray(2));controller.close();}}));
 try {
  await delivery.chooseFolder('qa');await delivery.bindDestination('qa','prj_test','folder');
  assert.match(await delivery.deliver('qa','prj_test','run_test'),/saqlandi/);assert.deepEqual(files.get('OpenSI/prj_test/run_test/assets/output.bin'),bytes);await delivery.deliver('qa','prj_test','run_test');assert.equal(writes,1);
  permission='denied';await assert.rejects(delivery.deliver('qa','prj_test','run_next'),/Natijani saqlash/);assert.ok((await delivery.deliveryFor('qa','prj_test')).error);
  await delivery.deliver('qa','prj_test','run_next',true);assert.equal(writes,2);assert.equal((await delivery.deliveryFor('qa','prj_test')).error,undefined);
  assert.equal(await delivery.deliveryFor('different-user','prj_test'),undefined);
 }finally{for(const [key,value] of Object.entries(old))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
