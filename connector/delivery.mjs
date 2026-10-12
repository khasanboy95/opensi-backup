import path from 'node:path';
import {mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

// A dropped HTTP response must not lose a completed command or execute it again.
// Only command identity and results are journaled, on the connector machine.
export async function resultDelivery(stateDir,send,{signal,retryMs=3000}={}) {
  const root=path.join(stateDir,'command-delivery');await mkdir(root,{recursive:true});
  const target=id=>{if(!/^cmd_[a-f0-9]{24}$/.test(id))throw Error('Noto‘g‘ri connector buyrug‘i.');return path.join(root,id+'.json');};
  const write=async(id,value)=>{const file=target(id);await writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await rename(file+'.tmp',file);};
  const deliver=async(id,result)=>{
    await write(id,{id,result});
    while(!signal?.aborted){
      try{await send({commandId:id,result});await rm(target(id),{force:true});return;}
      catch(error){if([401,403,404,410].includes(error.status)){await rm(target(id),{force:true});throw error;}await delay(retryMs,undefined,{signal});}
    }
    signal?.throwIfAborted();
  };
  return {
    begin:command=>write(command.id,{id:command.id}),
    deliver,
    async flush(activeIds=new Set()){
      for(const name of await readdir(root)){
        if(!/^cmd_[a-f0-9]{24}\.json$/.test(name))continue;
        if(activeIds.has(name.slice(0,-5)))continue;
        let entry;try{entry=JSON.parse(await readFile(path.join(root,name),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}
        const result=entry.result||{error:'Connector qayta ishga tushdi. Oldingi amal natijasi noma’lum; mavjud fayllardan davom eting, amalni ko‘r-ko‘rona takrorlamang.',code:'connector_interrupted',execution_status:'unknown'};
        try{await deliver(entry.id,result);}catch(error){if(![404,410].includes(error.status))throw error;}
      }
    },
  };
}
