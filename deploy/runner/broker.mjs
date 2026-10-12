// A private execution broker. Only this service has the Docker socket; job containers never do.
import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { realpath, lstat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {publicRequest} from './egress.mjs';
import {packageProxy} from './package-proxy.mjs';

export function validateJob(body) {
  if (!body || !/^usr_[a-f0-9]{24}$/.test(body.userId) || !/^prj_[a-f0-9]{24}$/.test(body.projectId)) throw new Error('Invalid workspace');
  if (typeof body.command !== 'string' || !body.command.trim() || body.command.length > 8000) throw new Error('Invalid command');
  if (!Number.isInteger(body.timeout) || body.timeout < 1 || body.timeout > 110) throw new Error('Invalid timeout');
  if(body.kind!==undefined&&!['document','webhook','package'].includes(body.kind))throw new Error('Invalid runtime');
  if(body.kind==='webhook'&&(body.command!=='node /opt/toolchain/webhook-worker.mjs'||!body.webhook||Buffer.byteLength(JSON.stringify(body.webhook))>150000))throw new Error('Invalid webhook command');
  if(body.kind==='document'&&!/^node \/opt\/toolchain\/documents\.mjs [A-Za-z0-9_-]+$/.test(body.command))throw new Error('Invalid document command');
  if(body.kind==='package'&&!/^python3 -I \/opt\/toolchain\/install-packages\.py [A-Za-z0-9_-]+$/.test(body.command)&&body.command!=='node /opt/toolchain/install-node.mjs')throw new Error('Invalid package command');
  return body;
}
export async function jobPath(root, userId, projectId) {
  const base = await realpath(root);
  for (const directory of [path.join(base, userId), path.join(base, userId, projectId)]) {
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid workspace directory');
  }
  const target = await realpath(path.join(base, userId, projectId));
  if (path.relative(base, target) !== path.join(userId, projectId)) throw new Error('Invalid workspace location');
  return target;
}
export function jobArguments(body, hostRoot, name, image, packageToken, packageNetwork) {
  return ['run', '--rm', ...(body.kind==='webhook'?['-i']:[]), '--name', name, '--label', 'opensi.sandbox=true', '--network', body.kind==='package'?packageNetwork:'none', '--cpus', '1', '--memory', '768m', '--memory-swap', '768m',
    '--pids-limit', '160', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only', '--ulimit', 'core=0', '--ulimit', 'fsize=1000000000:1000000000',
    '--tmpfs', '/tmp:rw,nosuid,size=192m', '--shm-size', '128m', '--user', '1000:1000',
    '--mount', `type=bind,source=${path.posix.join(hostRoot, body.userId, body.projectId)},target=/workspace`,
    '-w', '/workspace', '-e', 'HOME=/tmp', '-e', 'CI=true', '-e', 'FORCE_COLOR=0', '-e', 'PYTHONPATH=/workspace/.opensi-python', ...(body.kind==='package'?['-e', `OPENSI_PACKAGE_PROXY=http://package:${packageToken}@runner:4591`]:[]), image,
    'sh', '-c', 'if [ ! -e node_modules ] && [ ! -L node_modules ]; then ln -s /opt/toolchain/node_modules node_modules; fi; exec sh -c "$1"', 'opensi-job', body.command];
}
function imageAvailable(image){
  return new Promise(resolve=>{
    const child=spawn('docker',['image','inspect',image],{stdio:'ignore'});
    let settled=false;const done=ok=>{if(settled)return;settled=true;clearTimeout(timer);resolve(ok);};
    child.once('error',()=>done(false));child.once('close',code=>done(code===0));
    const timer=setTimeout(()=>{child.kill('SIGKILL');done(false);},3000);
  });
}
export function createBroker({ token, root, hostRoot, image = 'opensi-runtime:0.3.0', documentImage = 'opensi-documents:0.1.0', packageNetwork=process.env.OPENSI_PACKAGE_NETWORK||'opensi_opensi-execution', packageAccess } ) {
  if (!/^[a-f0-9]{64}$/.test(token || '') || !path.isAbsolute(root) || !path.posix.isAbsolute(hostRoot)) throw new Error('Runner configuration missing');
  const jobs = new Set(); const projects = new Set();
  return http.createServer(async (req, res) => {
    const supplied = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { res.writeHead(401); res.end(); return; }
    if (req.method === 'GET' && req.url === '/health') { const [runtimeReady,documentsReady]=await Promise.all([imageAvailable(image),imageAvailable(documentImage)]);res.setHeader('content-type','application/json');res.end(JSON.stringify({ ok: true, active: jobs.size,runtimeReady,documentsReady })); return; }
    if (req.method !== 'POST' || req.url !== '/execute') { res.writeHead(404); res.end(); return; }
    let body;
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 200000) throw new Error('Request too large'); chunks.push(chunk); }
      body = validateJob(JSON.parse(Buffer.concat(chunks).toString()));
      await jobPath(root, body.userId, body.projectId);
    } catch { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid execution request' })); return; }
    if (jobs.size >= 2 || projects.has(body.projectId)) { res.writeHead(409); res.end(JSON.stringify({ error: 'Runner busy' })); return; }
    const name = 'opensi-job-' + randomUUID(); jobs.add(name); projects.add(body.projectId);
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }); res.flushHeaders();
    const send = value => { if (!res.destroyed) res.write(JSON.stringify(value) + '\n'); };
    const packageToken=randomUUID();if(body.kind==='package')packageAccess?.grant(packageToken);
    const child = spawn('docker', jobArguments(body, hostRoot, name, body.kind==='document'?documentImage:image,packageToken,packageNetwork), { stdio: [body.kind==='webhook'?'pipe':'ignore','pipe','pipe'] });
    if(body.kind==='webhook'){child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(body.webhook)+'\n');}
    let output = ''; let truncated = false; let timedOut = false; let finished = false;
    const capture = data => { const value = data.slice(0, Math.max(0, 100000 - output.length)); if (value.length < data.length) truncated = true; output += value; if (value) send({ type: 'output', text: value }); };
    const networkAbort=new AbortController();let networkCount=0,networkActive=0,pendingLine='';
    const line=value=>{
      if(!value.startsWith('OPENSI_HTTP ')){capture(value+'\n');return;}
      let message;try{message=JSON.parse(value.slice(12));}catch{return;}
      const reply=value=>{if(!child.stdin.destroyed)child.stdin.write(JSON.stringify({id:message.id,...value})+'\n');};
      if(++networkCount>32||networkActive>=8){reply({error:'Network request budget exceeded'});return;}
      networkActive++;
      publicRequest(message.request,networkAbort.signal).then(result=>reply({result}),()=>reply({error:'Public HTTPS request failed or destination denied'})).finally(()=>networkActive--);
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data',value=>{if(body.kind!=='webhook'){capture(value);return;}pendingLine+=value;if(pendingLine.length>250000){kill();return;}let i;while((i=pendingLine.indexOf('\n'))>=0){line(pendingLine.slice(0,i));pendingLine=pendingLine.slice(i+1);}});child.stderr.on('data', capture);
    const kill = () => { const cleanup = spawn('docker', ['rm','-f',name], { stdio:'ignore' }); cleanup.on('error', () => {}); child.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, body.timeout * 1000);
    const disconnected = () => { if (!finished) kill(); }; res.on('close', disconnected);
    const finish = result => {
      if (finished) return; finished = true; packageAccess?.revoke(packageToken); networkAbort.abort();clearTimeout(timer); res.off('close', disconnected);
      kill(); jobs.delete(name); projects.delete(body.projectId); send({ type:'result', ...result, output, truncated, timedOut }); res.end();
    };
    child.once('error', () => finish({ exitCode: -1, error: 'Runner could not start the sandbox' }));
    child.once('close', code => finish({ exitCode: code }));
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const packageAccess=packageProxy();packageAccess.server.listen(4591,'0.0.0.0');
  createBroker({ packageAccess, token: process.env.OPENSI_RUNNER_TOKEN, root: '/workspaces', hostRoot: process.env.OPENSI_WORKSPACES_HOST, image: process.env.OPENSI_RUNTIME_IMAGE,documentImage:process.env.OPENSI_DOCUMENT_IMAGE }).listen(4590, '0.0.0.0');
}
