// Decode complete and in-flight JSON strings without ever executing partial tools.
export function partialString(json, name) {
  const match = new RegExp('(?:^|[,{])\\s*"' + name + '"\\s*:\\s*"').exec(json);
  if (!match) return { value: '', complete: false };
  let value = '';
  for (let i = match.index + match[0].length; i < json.length; i++) {
    const char = json[i];
    if (char === '"') return { value, complete: true };
    if (char !== '\\') { value += char; continue; }
    const escaped = json[++i];
    if (escaped === undefined) break;
    if (escaped === 'u') {
      const hex = json.slice(i + 1, i + 5);
      if (!/^[a-f0-9]{4}$/i.test(hex)) break;
      value += String.fromCharCode(parseInt(hex, 16)); i += 4;
    } else {
      const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (!(escaped in escapes)) break;
      value += escapes[escaped];
    }
  }
  return { value, complete: false };
}

export function liveTracker(store, runId, event,localOnly=false) {
  let state = { phase: 'starting', step: 0, agent: '', depth: 0, receivedBytes: 0, text: '', drafts: [], terminals: [], updatedAt: new Date().toISOString() };
  const saved=store.one('SELECT data FROM live_runs WHERE run_id=?',runId);if(saved)try{state={...state,...JSON.parse(saved.data),phase:'starting'};}catch{/* A damaged live snapshot must not block the saved task. */}
  let timer = null; let lastFlush = 0; const delivered = new Map(); const pendingCalls = new Map();
  const flush = () => {
    for (const [key, { call, depth, step, agent }] of pendingCalls) {
      const path = partialString(call.function.arguments, 'path');
      const content = partialString(call.function.arguments, call.function.name === 'edit_file' ? 'replace' : 'content').value;
      const draft = { key, callId: call.id, operation: call.function.name, path: path.complete ? path.value : '', content, agent, step, depth, state: 'writing', bytes: Buffer.byteLength(content), lines: content ? content.split('\n').length : 0 };
      state.drafts = state.drafts.some(item => item.key === key) ? state.drafts.map(item => item.key === key ? draft : item) : [...state.drafts, draft].slice(-24);
    }
    pendingCalls.clear();
    if (timer) clearTimeout(timer); timer = null; lastFlush = Date.now();
    store.exec('INSERT INTO live_runs(run_id,data) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET data=excluded.data', runId, JSON.stringify(localOnly?{...state,drafts:state.drafts.map(d=>({...d,content:''}))}:state));
    event(runId, 'live', { ...state, drafts: state.drafts.map(({ content, ...draft }) => draft), terminals: state.terminals.map(({ output, ...terminal }) => terminal) });
    for (const draft of state.drafts) {
      const previous = delivered.get(draft.key) || '';
      if (!localOnly && draft.content !== previous && draft.content) {
        const append = draft.content.startsWith(previous);
        event(runId, 'file_delta', { key: draft.key, offset: append ? previous.length : 0, text: append ? draft.content.slice(previous.length) : draft.content });
      }
      delivered.set(draft.key, draft.content);
    }
    for (const terminal of state.terminals) {
      const previous = delivered.get('terminal:' + terminal.callId) || '';
      if (terminal.output !== previous) {
        const append = terminal.output.startsWith(previous);
        event(runId, 'terminal_delta', { callId: terminal.callId, offset: append ? previous.length : 0, text: append ? terminal.output.slice(previous.length) : terminal.output });
      }
      delivered.set('terminal:' + terminal.callId, terminal.output);
    }
  };
  const update = (value, immediately = false) => {
    state = { ...state, ...value, updatedAt: new Date().toISOString() };
    if (immediately || Date.now() - lastFlush >= 350) flush();
    else if (!timer) timer = setTimeout(flush, 350 - (Date.now() - lastFlush));
  };
  return {
    plan(plan) { update({ plan }, true); },
    turn(agent, depth, step, model) { update({ phase: 'requesting', agent, depth, step, model, tool: '', path: '', command: '', startedAt: new Date().toISOString(), receivedBytes: 0, ...(depth ? {} : { text: '' }) }, true); },
    progress(value) { update({ ...value, ...(value.phase === 'running' && ['waiting_approval', 'waiting_input'].includes(state.phase) ? { phase: 'executing' } : {}) }, value.phase === 'connected'); },
    text(text, depth) { update({ phase: 'responding', ...(!depth ? { text: state.text + text } : {}) }); },
    call(call, depth, step, agent) {
      if (!['write_file','append_file','edit_file'].includes(call.function.name)) return;
      const key = `${depth}:${step}:${call.streamKey || call.id}`;
      pendingCalls.set(key, { call: { ...call, function: { ...call.function } }, depth, step, agent });
      update({ phase: 'writing' });
    },
    tool(tool, callId, args, phase = 'executing') {
      update({ phase, tool, callId, path: args.path || '', command: tool === 'run_command' ? args.command : tool === 'webhook_test' ? 'Webhook HTTP test: '+args.entry : '',
        ...(['run_command','webhook_test'].includes(tool) ? { terminals: [...state.terminals, { callId, command: args.command || 'Webhook HTTP test: '+args.entry, output: '', state: 'running' }].slice(-10) } : {}) }, true);
    },
    output(callId, text) { update({ phase: 'executing', terminals: state.terminals.map(item => item.callId === callId ? { ...item, output: (item.output + text).slice(0, 100000) } : item) }); },
    result(callId, result) {
      // A saved draft now lives in the real workspace; release the in-flight copy.
      update({ phase: 'tool_done', drafts: state.drafts.map(draft => draft.callId === callId ? { ...draft, content: '', state: result.error || result.denied ? 'failed' : 'saved' } : draft),
        terminals: state.terminals.map(item => item.callId === callId ? { ...item, output: String(result.output ?? result.error ?? item.output).slice(0,100000), state: result.error || result.denied || result.timedOut || (typeof result.exitCode === 'number' && result.exitCode !== 0) ? 'failed' : 'done', exitCode: result.exitCode } : item) }, true);
    },
    finish(status) { flush(); update({ phase: status, text: status === 'completed' ? '' : state.text, drafts: state.drafts.map(draft => ({ ...draft, state: draft.state === 'writing' ? 'interrupted' : draft.state })), terminals: state.terminals.map(item => item.state === 'running' ? { ...item, state: 'interrupted' } : item) }, true); if (timer) clearTimeout(timer); },
    flush,
  };
}
