// Isolated, explicitly labelled test environment. Never reads the user's provider credentials.
import { createApp } from '../server/app.mjs';
import { mockProvider, tempDir, removeTemp } from '../tests/helpers.mjs';
const dataDir=await tempDir();const mock=await mockProvider();
const service=createApp({dataDir,localAuth:true,production:false,encryptionKey:'',jevKey:'',port:4582,appUrl:'http://127.0.0.1:4582'});
const server=service.app.listen(4582,'127.0.0.1',()=>{
  console.log('Isolated OpenSI browser QA: http://127.0.0.1:4582');
  console.log(`QA mock provider URL: ${mock.base}`);
  console.log('Mock provider needs no key. This server does not use real AI or bill tokens.');
});
let closing=false;
async function close(){if(closing)return;closing=true;server.close();await service.close();server.closeAllConnections();await mock.close();await removeTemp(dataDir);process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
process.stdin.on('data',data=>{if(data.toString().trim()==='exit')void close();});
