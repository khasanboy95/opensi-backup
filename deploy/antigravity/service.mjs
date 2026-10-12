import {access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {startConnector} from './opensi-connector.mjs';

// An administrator pairs this dedicated service with one OpenSI owner only.
// Google login is completed in the official CLI; no Windows tokens are copied.
const stop=new AbortController();
process.on('SIGTERM',()=>stop.abort());process.on('SIGINT',()=>stop.abort());
while(!stop.signal.aborted){
  try{
    await access('/state/connector/connection.json');
    await startConnector({server:process.env.OPENSI_SERVER,workspace:'/workspace',stateDir:'/state/connector',antigravity:'/opt/agy/agy',name:'Antigravity Bulut',quiet:true,signal:stop.signal});
  }catch{
    // Never include CLI auth URLs, login codes or credential contents in service logs.
    if(!stop.signal.aborted)console.log('Antigravity cloud: waiting for official sign-in and owner pairing.');
  }
  await delay(15000,undefined,{signal:stop.signal}).catch(()=>{});
}
