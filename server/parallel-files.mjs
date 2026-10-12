import path from 'node:path';
import {mkdir,readdir,lstat} from 'node:fs/promises';
import {validFileName} from './files.mjs';
import {importSkip,containsSecret} from './project-import.mjs';

const dependencies=new Set(['node_modules','__pycache__','venv','env','site-packages','__pypackages__','bower_components']);
export const privateParallelPath=name=>importSkip(name)||containsSecret(name);

// An agent inventory is not a ZIP export. Paginate after walking the source,
// and prune dependency trees before counting files. Never silently truncate.
export async function parallelInventory(root,signal){
  await mkdir(root,{recursive:true});const files=[],skipped={private:0,dependencies:0,unsupported:0};
  async function walk(dir,prefix='',depth=0){
    signal?.throwIfAborted();
    for(const entry of await readdir(dir,{withFileTypes:true})){
      signal?.throwIfAborted();const name=prefix+entry.name;
      if(dependencies.has(entry.name)){skipped.dependencies++;continue;}
      if(entry.isSymbolicLink()||privateParallelPath(name)){skipped.private++;continue;}
      try{validFileName(name);}catch{skipped.unsupported++;continue;}
      if(entry.isDirectory()){
        if(depth>=32)throw Error('Parallel loyiha katalogi 32 darajadan chuqur. Ichki loyiha papkasini tanlang.');
        await walk(path.join(dir,entry.name),name+'/',depth+1);
      }else if(entry.isFile()){
        let stat;try{stat=await lstat(path.join(dir,entry.name));}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(stat.isSymbolicLink())continue;
        if(files.length>=100_000)throw Error('Parallel loyiha 100 000 manba faylidan oshdi. Ichki loyiha papkasini tanlang.');
        files.push({path:name,size:stat.size,updated_at:stat.mtime.toISOString()});
      }
    }
  }
  await walk(root);files.sort((a,b)=>a.path.localeCompare(b.path));return {files,skipped};
}
