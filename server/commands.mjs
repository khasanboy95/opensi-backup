import { spawn } from 'node:child_process';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { HttpError } from './security.mjs';
import { safePath } from './files.mjs';
import { WorkPool } from './work-pool.mjs';
const shellPools = new WeakMap();

export function captureProcess(executable, args, options, signal, timeout = 90_000, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(executable, args, { ...options, windowsHide: true });
    let output = ''; let truncated = false; let settled = false; let timedOut = false;
    const capture = data => { const text = data.toString(); const remaining = 100_000 - output.length; const visible = text.slice(0, Math.max(0, remaining)); output += visible; if (text.length > remaining) truncated = true; if (visible) onOutput(visible); };
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    const kill = () => {
      if (child.pid && process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const abort = () => kill();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeout);
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { if (!settled) { settled = true; clean(); reject(error); } });
    child.on('close', code => {
      if (settled) return; settled = true; clean();
      if (signal?.aborted) reject(signal.reason || new Error('Buyruq bekor qilindi.'));
      else resolve({ exitCode: code, output, truncated, timedOut });
    });
  });
}

export async function localCommand(root, args, signal, onOutput) {
  if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 8000) throw new HttpError(400, 'Buyruq matni noto‘g‘ri.');
  await mkdir(root, { recursive: true });
  const cwd = args.cwd ? path.dirname(await safePath(root, `${args.cwd}/opensi-cwd-check`)) : root;
  const localHome = path.join(root, '.runtime-home');
  await mkdir(localHome, { recursive: true });
  const env = {};
  // Deliberately avoid forwarding provider keys, cloud credentials, or the user's shell environment.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  env.HOME = localHome; env.USERPROFILE = localHome; env.CI = 'true'; env.FORCE_COLOR = '0';
  env.PYTHONPATH = path.join(root,'.opensi-python');
  const windows = process.platform === 'win32';
  return captureProcess(windows ? 'powershell.exe' : '/bin/sh', windows ? ['-NoProfile', '-NonInteractive', '-Command', args.command] : ['-lc', args.command],
    { cwd, env, detached: !windows, stdio: ['ignore', 'pipe', 'pipe'] }, signal, Math.min(Math.max(Number(args.timeout || 90), 1), 110) * 1000, onOutput);
}

export async function cloudCommand(config, root, args, signal, onOutput) {
  if (config.runnerUrl && config.runnerToken) return remoteCommand(config, root, args, signal, onOutput);
  if (!config.dockerEnabled) throw new HttpError(409, 'Bulut terminali uchun Docker runner yoqilmagan. Lokal connectorni tanlang.');
  await mkdir(root, { recursive: true });
  const containerName = `opensi-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const dockerArgs = ['run', '--rm', '--name', containerName, '--network', 'none', '--cpus', '1', '--memory', '512m',
    '--pids-limit', '100', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--read-only',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m', '--user', '1000:1000',
    '--mount', `type=bind,source=${root},target=/workspace`, '-w', '/workspace', '-e', 'HOME=/tmp', '-e', 'CI=true',
    config.dockerImage, 'sh', '-lc', args.command];
  try { return await captureProcess('docker', dockerArgs, { detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] }, signal, Math.min(Number(args.timeout || 90), 110) * 1000, onOutput); }
  finally { await captureProcess('docker', ['rm', '-f', containerName], { stdio: 'ignore' }, undefined, 10_000).catch(() => {}); }
}

export const cloudAvailable = config => Boolean(config.dockerEnabled || (config.runnerUrl && config.runnerToken));

export async function remoteCommand(config, root, args, signal, onOutput = () => {}) {
  let pool = shellPools.get(config);
  if (!pool) { pool = new WorkPool(config.maxConcurrentShells || 2, 1); shellPools.set(config, pool); }
  const release = await pool.acquire(root, signal);
  try {
  signal?.throwIfAborted();
  const relative = path.relative(path.join(config.dataDir, 'workspaces'), root).split(path.sep);
  if (relative.length !== 2 || relative.some(part => !part || part === '..')) throw new HttpError(400, 'Workspace noto‘g‘ri.');
  const response = await fetch(config.runnerUrl + '/execute', { method:'POST', headers: { 'content-type':'application/json', authorization:`Bearer ${config.runnerToken}` },
    body:JSON.stringify({ userId:relative[0], projectId:relative[1], command:args.command, kind:args.kind, webhook:args.webhook, timeout:Math.min(110, Math.max(1, Number(args.timeout || 90))) }),
    signal:AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(125000)]) });
  if (!response.ok) throw new HttpError(502, response.status === 409 ? 'Bulut terminali band. Birozdan keyin takrorlang.' : 'Bulut terminali bilan ulanish amalga oshmadi.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let size = 0; let result;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > 1500000) throw new Error('Terminal javobi juda katta.');
      buffer += decoder.decode(value, { stream:true });
      let split;
      while ((split = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0,split); buffer = buffer.slice(split + 1); if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'output') onOutput(event.text);
        if (event.type === 'result') result = event;
      }
    }
  } finally { await reader.cancel().catch(() => {}); }
  if (!result) throw new Error('Bulut terminalining yakuniy javobi olinmadi.');
  return result;
  } finally { release(); }
}

export async function browserTest(config, root, args, signal) {
  if (!config.runnerUrl) throw new HttpError(409, 'Brauzer tekshiruvi uchun bulut runner kerak.');
  const payload = Buffer.from(JSON.stringify(args)).toString('base64url');
  const result = await cloudCommand(config, root, { command:`node /opt/toolchain/browser.mjs ${payload}`, timeout:110 }, signal);
  if (result.exitCode !== 0 || result.timedOut) return { error:result.output || 'Brauzer tekshiruvi tugamadi.', exitCode:result.exitCode };
  try { return JSON.parse(result.output.trim().split('\n').at(-1)); } catch { throw new Error('Brauzer hisoboti noto‘g‘ri.'); }
}
