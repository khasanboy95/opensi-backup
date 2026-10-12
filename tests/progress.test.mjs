import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fixture, createRun, runState, until, mockProvider, addProvider, tempDir, removeTemp } from './helpers.mjs';
import { partialString } from '../server/live.mjs';
import { complete } from '../server/provider.mjs';
import { captureProcess } from '../server/commands.mjs';
import { startConnector } from '../connector/index.mjs';
import { hash, token, now } from '../server/security.mjs';
import { applyRunEvent, toolActivities } from '../src/run-stream.ts';

const latch = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('partial file JSON decodes escapes and unicode across chunk boundaries', () => {
  const content = 'line 1\n"quoted" \\ path\tO‘zbek ✅ 😀';
  const json = JSON.stringify({ path: 'index.html', content });
  assert.deepEqual(partialString(json, 'path'), { value: 'index.html', complete: true });
  assert.deepEqual(partialString(json, 'content'), { value: content, complete: true });
  for (let i = 0; i < json.length; i++) assert.ok(content.startsWith(partialString(json.slice(0, i), 'content').value));
  assert.deepEqual(partialString('{"content":"A\\u004', 'content'), { value: 'A', complete: false });
  assert.deepEqual(partialString('{"content":"A\\u0042\\nC', 'content'), { value: 'AB\nC', complete: false });
});

for (const protocol of ['responses', 'chat-completions']) test(`${protocol}: live drafts survive snapshots, stay private and execute only after a complete tool call`, async () => {
  const f = await fixture(); const gate = latch(); let calls = 0;
  const content = '<!doctype html>\n<html lang="uz"><body>LIVE_A\nO‘zbek ✅ "tayyor"</body></html>';
  const args = JSON.stringify({ path: 'index.html', content });
  const split = args.indexOf('LIVE_A') + 6;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'qa-model' }] })); return; }
    for await (const _ of req) { /* consume model request */ }
    calls++;
    const first = calls === 1;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
    const send = value => res.write(`data: ${JSON.stringify(value)}\n\n`);
    if (protocol === 'responses') {
      if (first) {
        send({ type: 'response.reasoning_text.delta', delta: 'PRIVATE_REASONING_MUST_NOT_APPEAR' });
        send({ type: 'response.output_item.added', item: { id: 'fc_live', type: 'function_call', call_id: 'call_live', name: 'write_file', arguments: '' } });
        send({ type: 'response.function_call_arguments.delta', item_id: 'fc_live', delta: args.slice(0, split) });
        await gate.promise;
        if (res.destroyed) return;
        send({ type: 'response.function_call_arguments.delta', item_id: 'fc_live', delta: args.slice(split) });
      } else send({ type: 'response.output_text.delta', delta: 'Fayl tayyor.' });
      send({ type: 'response.completed', response: { status: 'completed', output: first ? [{ id: 'fc_live', type: 'function_call', call_id: 'call_live', name: 'write_file', arguments: args }] : [{ type: 'message', content: [{ type: 'output_text', text: 'Fayl tayyor.' }] }], usage: { input_tokens: 5, output_tokens: 10 } } });
    } else {
      if (first) {
        send({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_MUST_NOT_APPEAR', tool_calls: [{ index: 0, id: 'call_live', type: 'function', function: { name: 'write_file', arguments: args.slice(0, split) } }] } }] });
        await gate.promise;
        if (res.destroyed) return;
        send({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(split) } }] }, finish_reason: 'tool_calls' }] });
      } else send({ choices: [{ delta: { content: 'Fayl tayyor.' }, finish_reason: 'stop' }] });
      send({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 10 } });
      res.write('data: [DONE]\n\n');
    }
    // A compatible gateway may keep HTTP alive even after its completion marker.
    const timer = setTimeout(() => res.end(), 20_000); res.on('close', () => clearTimeout(timer));
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const added = await f.request('/providers', { method: 'POST', body: { label: 'Live QA', protocol, baseUrl: `http://127.0.0.1:${server.address().port}/v1` } });
    assert.equal(added.status, 200, JSON.stringify(added.value)); const provider = added.value;
    const { run, project } = await createRun(f, provider, 'Live file test');
    const live = await until(async () => { const value = (await f.request('/runs/' + run.id)).value; return value?.live?.drafts[0]?.content.includes('LIVE_A') ? value : null; });
    assert.equal(live.run.status, 'running'); assert.equal(live.live.phase, 'writing');
    assert.equal(live.live.drafts[0].path, 'index.html'); assert.equal(live.live.drafts[0].state, 'writing');
    assert.equal((await f.request(`/projects/${project.id}/files`)).value.files.length, 0);
    assert.equal((await f.request(`/runs/${run.id}/drafts/recover`, { method: 'POST', body: { key: live.live.drafts[0].key } })).status, 409);
    const restored = (await f.request('/runs/' + run.id)).value;
    assert.equal(restored.live.drafts[0].content, live.live.drafts[0].content);
    assert.ok(!restored.events.some(event => ['delta', 'live', 'file_delta', 'terminal_delta'].includes(event.type)));
    const session = token(); f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)', 'other-live', 'Other user', 'user', now());
    f.store.exec('INSERT INTO sessions VALUES(?,?,?)', hash(session), 'other-live', Date.now() + 60000);
    assert.equal((await f.request('/runs/' + run.id, { headers: { cookie: `opensi_session=${session}` } })).status, 404);
    const forbidden = await fetch(`${f.base}/api/runs/${run.id}/events`, { headers: { cookie: `opensi_session=${session}` } }); assert.equal(forbidden.status, 404);
    assert.ok(!JSON.stringify(f.store.all('SELECT data FROM events WHERE run_id=?', run.id)).includes('PRIVATE_REASONING_MUST_NOT_APPEAR'));
    const stream = await fetch(`${f.base}/api/runs/${run.id}/events?after=0`); const reader = stream.body.getReader();
    const frame = await reader.read(); assert.ok(new TextDecoder().decode(frame.value).includes('file_delta')); await reader.cancel();
    gate.resolve();
    const done = await runState(f, run.id, 'completed');
    assert.deepEqual(done.usage, { input: 10, output: 20, unknown: 0 }); assert.equal(calls, 2);
    assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`)).value.content, content);
    assert.equal(done.live.drafts[0].state, 'saved'); assert.equal(done.live.drafts[0].content, '');
    const tools = toolActivities(done); assert.equal(tools.length, 1); assert.equal(tools[0].state, 'done'); assert.equal(tools[0].callId, 'call_live');
  } finally { gate.resolve(); await f.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('replayed events do not duplicate messages, tokens or file chunks', () => {
  const base = { cursor: 1, events: [], messages: [], approvals: [], run: { id: 'run', status: 'running' }, usage: { input: 0, output: 0, unknown: 0 }, live: { text: '', drafts: [], terminals: [] } };
  const event = (id, type, data) => ({ id, type, data, created_at: now() });
  const usage = event(2, 'usage', { input: 11, output: 7, known: true });
  let state = applyRunEvent(base, usage); assert.strictEqual(applyRunEvent(state, usage), state);
  state = applyRunEvent(state, event(3, 'live', { phase: 'writing', drafts: [{ key: 'd', state: 'writing' }], terminals: [] }));
  const first = event(4, 'file_delta', { key: 'd', offset: 0, text: 'ABC' });
  state = applyRunEvent(state, first); state = applyRunEvent(state, first);
  state = applyRunEvent(state, event(5, 'live', { phase: 'writing', drafts: [{ key: 'd', state: 'writing' }], terminals: [] }));
  state = applyRunEvent(state, event(6, 'file_delta', { key: 'd', offset: 3, text: 'DEF' })); assert.equal(state.live.drafts[0].content, 'ABCDEF');
  state = applyRunEvent(state, event(7, 'file_delta', { key: 'd', offset: 999, text: 'missed' })); assert.equal(state.live.drafts[0].content, 'ABCDEF');
  const message = event(8, 'message', { message: { role: 'assistant', content: 'Done' }, depth: 0 });
  state = applyRunEvent(state, message); state = applyRunEvent(state, message);
  assert.equal(state.messages.length, 1); assert.deepEqual(state.usage, { input: 11, output: 7, unknown: 0 });
  assert.ok(!state.events.some(item => item.type === 'file_delta'));
});

test('an idle model stream fails explicitly instead of staying running forever', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders(); });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    await assert.rejects(complete({ provider: { base_url: `http://127.0.0.1:${server.address().port}`, protocol: 'responses' }, model: 'test', messages: [], config: { localAuth: true, modelTimeout: 2000, modelIdleTimeout: 100 } }), /yangi ma’lumot kelmadi/);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('terminal stdout is available before the process finishes', async () => {
  const output = []; const first = latch(); let finished = false;
  const job = captureProcess(process.execPath, ['-e', "console.log('FIRST');setTimeout(()=>console.log('LAST'),650)"], { stdio: ['ignore', 'pipe', 'pipe'] }, undefined, 3000, text => { output.push(text); first.resolve(); }).then(value => { finished = true; return value; });
  await first.promise; assert.equal(finished, false); assert.ok(output.join('').includes('FIRST'));
  const result = await job; assert.equal(result.exitCode, 0); assert.ok(result.output.includes('LAST')); assert.equal(output.join(''), result.output);
});

test('a paired connector streams approved terminal output and rejects a foreign node', async () => {
  const f = await fixture(); const mock = await mockProvider(); const workspace = await tempDir(); const stateDir = await tempDir(); const stop = new AbortController(); let connector;
  try {
    const provider = await addProvider(f, mock); const paired = (await f.request('/nodes/pair-code', { method: 'POST', body: {} })).value;
    connector = startConnector({ server: f.base, code: paired.code, workspace, stateDir, name: 'Streaming QA', signal: stop.signal, quiet: true });
    const node = await until(() => f.nodes.list('local-owner')[0]);
    const { run } = await createRun(f, provider, '_STREAM_COMMAND_', { environment: 'local', nodeId: node.id });
    const pending = await runState(f, run.id, 'waiting_approval');
    await f.request('/approvals/' + pending.approvals[0].id, { method: 'POST', body: { approved: true } });
    const live = await until(async () => { const value = (await f.request('/runs/' + run.id)).value; return value?.live?.terminals[0]?.output.includes('FIRST_CHUNK') ? value : null; });
    assert.equal(live.run.status, 'running'); assert.equal(live.live.terminals[0].state, 'running'); assert.ok(!live.live.terminals[0].output.includes('LAST_CHUNK'));
    const command = f.store.one("SELECT id FROM commands WHERE run_id=? AND status='claimed'", run.id);
    f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)', 'foreign-node-user', 'Other', 'user', now());
    const foreign = f.nodes.pair({ ...f.nodes.pairCode({ id: 'foreign-node-user' }), name: 'Foreign', platform: 'test', workspace: 'test' });
    assert.equal((await f.request('/connector/progress', { method: 'POST', body: { commandId: command.id, output: 'STOLEN' }, headers: { authorization: 'Bearer ' + foreign.token } })).status, 404);
    const done = await runState(f, run.id, 'completed'); assert.ok(done.live.terminals[0].output.includes('LAST_CHUNK')); assert.equal(done.live.terminals[0].exitCode, 0);
    const connection = JSON.parse(await readFile(path.join(stateDir, 'connection.json'), 'utf8'));
    assert.equal((await f.request('/connector/progress', { method: 'POST', body: { commandId: command.id, output: 'LATE' }, headers: { authorization: 'Bearer ' + connection.token } })).status, 404);
  } finally { stop.abort(); await connector?.catch(() => {}); await f.close(); await mock.close(); await removeTemp(workspace); await removeTemp(stateDir); }
});
