import net from 'node:net';
import path from 'node:path';
import {createHash} from 'node:crypto';

// An OS-owned listening handle disappears even after an abrupt process exit.
// No credential or browser command is accepted through this lock endpoint.
export async function connectorLock(stateDir) {
  const normalized=path.resolve(stateDir);
  const digest=createHash('sha256').update(process.platform==='win32'?normalized.toLowerCase():normalized).digest('hex');
  const address=process.platform==='win32'?{path:`\\\\.\\pipe\\opensi-connector-${digest.slice(0,24)}`}:{host:'127.0.0.1',port:34000+parseInt(digest.slice(0,6),16)%20000};
  const server=net.createServer(socket=>socket.destroy());
  await new Promise((resolve,reject)=>{server.once('error',error=>reject(new Error(error.code==='EADDRINUSE'?'Bu ulanish uchun connector allaqachon ishlayapti yoki instance porti band. Ikkinchi nusxa ochilmadi.':error.message)));server.listen(address,resolve);});
  return ()=>new Promise(resolve=>server.close(resolve));
}
