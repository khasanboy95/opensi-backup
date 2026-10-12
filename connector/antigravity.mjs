import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export function pendingCommand(step, root, softDenied = false) {
  const deniedMessage = step.state === 'ERROR' && /user denied permission to run command:/i.test(step.tool_info?.error?.message || '');
  if (step.tool_name !== 'run_command' || step.tool_info?.output !== undefined || (!deniedMessage && !(softDenied && step.state === 'DONE' && !step.tool_info?.error))) return null;
  const parameters = step.tool_info?.parameters;
  if (typeof parameters?.CommandLine !== 'string' || !parameters.CommandLine.trim() || parameters.CommandLine.length > 8000) return null;
  const cwd = path.resolve(root, parameters.Cwd || '.'); const relative = path.relative(path.resolve(root), cwd);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return { command: parameters.CommandLine, cwd: relative.split(path.sep).join('/'), timeout: 90 };
}

// CLI permission summaries collapse several denied commands into one "command"
// action. Keep each final step and its exact parameters, excluding executed steps.
export function mergeNativeStep(previous, step) {
  return {...previous,...step,tool_info:{...previous?.tool_info,...step.tool_info,
    parameters:{...previous?.tool_info?.parameters,...step.tool_info?.parameters}}};
}
export function nativeCommandRequests(result, steps, root) {
  const softDenied=result.denied_actions?.some(action=>action.action==='command');
  const requests=steps.map(step=>pendingCommand(step,root,softDenied)).filter(Boolean);
  return [...new Map(requests.map(request=>[JSON.stringify(request),request])).values()];
}

export function pendingRead(step, softDenied = false) {
  const denied = step.state === 'ERROR' && /user denied permission for read_url/i.test(step.tool_info?.error?.message || '');
  if (step.tool_name !== 'read_url_content' || (!denied && !(softDenied && step.tool_info?.output === undefined && !step.tool_info?.error))) return null;
  const url = step.tool_info?.parameters?.Url;
  if (typeof url !== 'string' || url.length > 2000) return null;
  try { const value = new URL(url); if (value.protocol !== 'https:' || value.username || value.password) return null; } catch { return null; }
  return url;
}

async function canRequestCommand(action = 'command') {
  // An explicit CLI Deny must never be translated into an OpenSI execution request.
  try {
    const settings = JSON.parse(await readFile(path.join(os.homedir(), '.gemini/antigravity-cli/settings.json'), 'utf8'));
    return !(settings.permissions?.deny || []).some(rule => rule.startsWith(`${action}(`) || (action === 'command' && rule.startsWith('unsandboxed(')));
  } catch (error) { return error.code === 'ENOENT'; }
}

// CLI stderr can contain credentials, prompts and paths. Classify it locally;
// only fixed diagnostics and bounded retry metadata cross the connector boundary.
export function nativeCliError(exitCode, stderr = '', result) {
  let diagnostic;
  for (const line of String(stderr).split(/\r?\n/)) {
    if (!line.startsWith('AGY_ERROR:')) continue;
    try { diagnostic = JSON.parse(line.slice('AGY_ERROR:'.length).trim()); } catch { /* Ignore incomplete diagnostics. */ }
  }
  const reason = [diagnostic?.status, diagnostic?.short_error, typeof result?.error === 'string' ? result.error : result?.error?.message, stderr].filter(Boolean).join('\n');
  const status = Number(diagnostic?.error_code);
  let kind, code, message;
  if (/permission.?denied|user denied|forbidden|content.?policy|safety|refusal/i.test(reason) || status === 403) {
    kind = 'permission'; code = 'PERMISSION_DENIED'; message = 'Antigravity amal uchun ruxsat bermadi. Fayllar saqlandi; ruxsatni tekshiring.';
  } else if (/unauthenticated|not logged (?:in|into)|unauthorized|invalid (?:credential|authentication)|login required/i.test(reason) || status === 401) {
    kind = 'auth'; code = 'UNAUTHENTICATED'; message = 'Antigravity hisob sessiyasi faol emas. Ulangan Antigravity hisobiga qayta kiring; fayllar saqlandi.';
  } else if (/individual quota|quota[^\n]*(?:reached|exhausted|exceeded)|insufficient_quota|usage_limit_reached|credits? depleted/i.test(reason) || /RESOURCE_EXHAUSTED/i.test(reason) && !/rate.?limit|too many requests/i.test(reason)) {
    kind = 'quota'; code = 'RESOURCE_EXHAUSTED'; message = 'Antigravity model limiti tugadi (RESOURCE_EXHAUSTED). Bajarilgan ishlar saqlandi.';
  } else if (status === 429 || /rate.?limit|too many requests/i.test(reason)) {
    kind = 'rate'; code = 'RATE_LIMITED'; message = 'Antigravity so‘rov chegarasiga yetdi (429). Bajarilgan ishlar saqlandi.';
  } else if ([500, 502, 503, 504].includes(status) || /UNAVAILABLE|DEADLINE_EXCEEDED|overload|timeout|timed out|network|ECONNRESET|fetch failed/i.test(reason)) {
    kind = 'transient'; code = 'UNAVAILABLE'; message = 'Antigravity xizmati vaqtincha javob bermadi (503). Bajarilgan ishlar saqlandi.';
  } else message = `Antigravity CLI bajarilmadi (${exitCode ?? 'noma’lum'}). Bajarilgan ishlar saqlandi.`;
  const reset = reason.match(/(?:resets? in|retry after)\s+((?:\d+(?:\.\d+)?\s*(?:ms|[dhms])\s*)+)/i)?.[1];
  const units = { d: 86400000, h: 3600000, m: 60000, s: 1000, ms: 1 };
  const retryAfterMs = reset ? [...reset.matchAll(/(\d+(?:\.\d+)?)\s*(ms|[dhms])/gi)].reduce((n, match) => n + Number(match[1]) * units[match[2].toLowerCase()], 0) : undefined;
  return Object.assign(new Error(message), { nativeFailure: true, cliExitCode: exitCode,
    ...(kind ? { providerError: { kind, code, ...([401, 402, 403, 429, 500, 502, 503, 504].includes(status) ? { status } : {}), ...(retryAfterMs > 0 ? { retryAfterMs: Math.min(86400000, retryAfterMs) } : {}) } } : {}) });
}

// Talk only to Google's installed CLI. OAuth credentials stay in its OS keyring.
export function runCli(executable, args, { cwd, signal, input, onLine = () => {}, timeout = 300_000 } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const decoder = new StringDecoder('utf8'); let buffer = '', output = '', errors = '', failure;
    const stop = reason => {
      failure ||= reason;
      if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill('SIGKILL');
    };
    const abort = () => stop(signal.reason || new Error('Antigravity vazifasi to‘xtatildi.'));
    const timer = setTimeout(() => stop(new Error('Antigravity javobini kutish vaqti tugadi.')), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    child.on('error', error => { clean(); reject(error); });
    child.stdout.on('data', bytes => {
      const text = decoder.write(bytes); output += text; buffer += text;
      if (output.length > 8_000_000) { stop(new Error('Antigravity javobi hajmi chegaradan oshdi.')); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { onLine(line); } catch (error) { stop(error); }
      }
    });
    child.stderr.on('data', bytes => { errors = (errors + bytes.toString()).slice(-3000); });
    child.stdin.on('error', () => {}); child.stdin.end(input || '');
    child.on('close', code => {
      clean(); buffer += decoder.end();
      try { if (buffer.trim()) onLine(buffer); } catch (error) { failure ||= error; }
      if (failure) reject(failure);
      else if (code !== 0) reject(nativeCliError(code, errors));
      else resolve({ output, warning: errors });
    });
  });
}

export async function cliModels(executable, cwd) {
  const { output } = await runCli(executable, ['models'], { cwd, timeout: 30_000 });
  const models = output.split(/\r?\n/).map(line => line.split('\t')).filter(([id, label]) => /^[a-z0-9][a-z0-9._-]{0,119}$/.test(id) && label);
  if (!models.length) throw new Error('Antigravity modellari olinmadi. Avval rasmiy CLI’da hisobingizga kiring.');
  return models.slice(0, 100).map(([id, label]) => ({ id, label: label.slice(0, 150) }));
}

export async function cliTask(executable, root, { prompt, model, conversationId, cumulativeUsage }, signal, onProgress, invoke = runCli) {
  let result, cliFailure; let updates = 0; const reads = []; const commands = new Map(); const readSteps = new Map();
  // OpenSI has already obtained approval for this task's workspace edits.
  // This documented mode retains CLI tool permission rules (including shell Ask).
  if (conversationId && !/^[a-f0-9-]{36}$/.test(conversationId)) throw new Error('Antigravity suhbat identifikatori noto‘g‘ri.');
  try { await invoke(executable, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--mode', 'accept-edits', '--model', model, '--print-timeout', '5m', '--disable-slash-commands', ...(conversationId ? ['--conversation', conversationId] : [])], {
    cwd: root, signal, timeout: 315_000,
    input: JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n',
    onLine(line) {
      if (!line.trim()) return;
      const value = JSON.parse(line);
      if (value.event === 'result') result = value.result;
      if (value.event === 'step_update') {
        const step = value.step_update;
        if (step.tool_name === 'run_command'||commands.has(step.step_index)) commands.set(step.step_index, mergeNativeStep(commands.get(step.step_index),step));
        if (step.tool_name === 'read_url_content') readSteps.set(step.step_index, step);
        const read = pendingRead(step); if (read) reads.push(read);
        // Do not forward internal thoughts, credentials, full command arguments or arbitrary logs.
        if (step.step_type === 'agent_response' && step.text_delta) onProgress(JSON.stringify({ text: step.text_delta.slice(0, 12000) }) + '\n');
        else if (step.step_type === 'tool' && updates++ < 1000) onProgress(JSON.stringify({ tool: String(step.tool_name || 'tool').slice(0, 100), state: step.state }) + '\n');
      }
    },
  });
  } catch (error) {
    if (signal?.aborted || !error.nativeFailure) throw error;
    cliFailure = error;
  }
  let usage = result?.usage || null;
  if (conversationId && cumulativeUsage && result?.conversation_id === conversationId && usage) {
    usage = Object.fromEntries(Object.entries(usage).map(([key, total]) => [key, typeof total === 'number' ? Math.max(0, total - (cumulativeUsage[key] || 0)) : total]));
  }
  if (cliFailure || !result || result.status !== 'SUCCESS') {
    const failure = cliFailure?.providerError ? cliFailure : nativeCliError(cliFailure?.cliExitCode, '', result);
    return { response: String(result?.response || '').slice(0, 200000), usage,
      conversationId: result?.conversation_id, cumulativeUsage: result?.usage || null,
      failure: failure.message, ...(failure.providerError ? { providerError: failure.providerError } : {}) };
  }
  const value = nativeResult(result);
  value.conversationId = result.conversation_id;
  value.cumulativeUsage = result.usage || null;
  value.usage = usage;
  const pending=nativeCommandRequests(result,[...commands.values()],root);
  if (value.failure && pending.length && await canRequestCommand()) value.pendingCommands = pending.slice(0,12);
  if (!reads.length && readSteps.size === 1 && result.denied_actions?.some(action => action.action === 'read_url')) {
    const read = pendingRead([...readSteps.values()][0], true); if (read) reads.push(read);
  }
  if (value.failure && reads.length && await canRequestCommand('read_url')) value.pendingReads = [...new Set(reads)].slice(0, 4);
  return value;
}

export function nativeResult(result) {
  const denied = Array.isArray(result.denied_actions) && result.denied_actions.length > 0;
  return { response: String(result.response || '').slice(0, 200000), usage: result.usage || null,
    failure: denied ? `Antigravity quyidagi amalni tasdiqlay olmadi: ${result.denied_actions.map(action=>String(action.action||'tool').slice(0,80)).join(', ')}. Amal bajarilmadi; natija saqlandi.` : null };
}
