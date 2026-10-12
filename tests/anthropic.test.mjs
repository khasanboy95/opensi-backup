import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture, createRun, runState } from './helpers.mjs';
import { anthropicPayload } from '../server/anthropic.mjs';

const secret = 'qa-anthropic-secret';
function event(res, value) { res.write(`event: ${value.type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`); }
function textReply(res, text) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  event(res, { type: 'message_start', message: { usage: { input_tokens: 7 } } });
  event(res, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  event(res, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } });
  event(res, { type: 'content_block_stop', index: 0 });
  event(res, { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } });
  event(res, { type: 'message_stop' });
  res.end();
}

test('Claude payload preserves system text, images and tool result IDs', () => {
  const payload = anthropicPayload('qa-model', [
    { role: 'system', content: 'Work in this project.' },
    { role: 'user', content: [{ type: 'text', text: 'Inspect' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } }] },
    { role: 'assistant', content: null, tool_calls: [{ id: 'toolu_1', function: { name: 'read_file', arguments: '{"path":"a.txt"}' } }] },
    { role: 'tool', tool_call_id: 'toolu_1', content: '{"saved":true}' },
  ], [{ type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }]);
  assert.equal(payload.system, 'Work in this project.');
  assert.equal(payload.messages[0].content[1].source.media_type, 'image/png');
  assert.equal(payload.messages[1].content[0].id, 'toolu_1');
  assert.equal(payload.messages[2].content[0].tool_use_id, 'toolu_1');
  assert.equal(payload.tools[0].input_schema.properties.path.type, 'string');
});

test('Claude model discovery, API test and streamed tool workflow', async () => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    assert.equal(req.headers['x-api-key'], secret);
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    if (req.url?.startsWith('/v1/models?')) {
      const after = new URL(req.url, 'http://localhost').searchParams.get('after_id');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(after ? { data: [{ id: 'qa-model', lifecycle: 'active' }], has_more: false } : { data: [{ id: 'old-model', lifecycle: 'deprecated' }], has_more: true, last_id: 'old-model' }));
      return;
    }
    assert.equal(req.url, '/v1/messages');
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
    if (JSON.stringify(body.messages).includes('OPENSI_CONNECTED')) { textReply(res, 'OPENSI_CONNECTED'); return; }
    if (body.messages.some(message => message.content.some(part => part.type === 'tool_result'))) {
      const result = body.messages.find(message => message.content.some(part => part.type === 'tool_result'));
      assert.equal(result.content[0].tool_use_id, 'toolu_write');
      textReply(res, 'Claude tool workflow complete.');
      return;
    }
    assert.ok(body.tools.some(tool => tool.name === 'write_file'));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    event(res, { type: 'message_start', message: { usage: { input_tokens: 8 } } });
    event(res, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_write', name: 'write_file', input: {} } });
    const args = JSON.stringify({ path: 'claude.txt', content: 'Claude wrote this file.' });
    event(res, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(0, 18) } });
    event(res, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: args.slice(18) } });
    event(res, { type: 'content_block_stop', index: 0 });
    event(res, { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } });
    event(res, { type: 'message_stop' });
    res.end();
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const f = await fixture();
  try {
    const bad = await f.request('/providers', { method: 'POST', body: { label: 'Wrong key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'anthropic-messages', apiKey: 'vcp_not_a_model_key', models: ['qa-model'] } });
    assert.equal(bad.status, 400);
    const created = await f.request('/providers', { method: 'POST', body: { label: 'Claude QA', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, protocol: 'anthropic-messages', apiKey: secret } });
    assert.equal(created.status, 200, JSON.stringify(created.value));
    assert.deepEqual(created.value.models, ['qa-model']);
    assert.equal(created.value.has_key, true);
    const tested = await f.request(`/providers/${created.value.id}/test`, { method: 'POST', body: { model: 'qa-model' } });
    assert.equal(tested.status, 200, JSON.stringify(tested.value));
    assert.equal(tested.value.message, 'OPENSI_CONNECTED');
    const { run, project } = await createRun(f, created.value, 'Write a file with Claude');
    const finished = await runState(f, run.id, 'completed');
    assert.equal((await f.request(`/projects/${project.id}/file?path=claude.txt`)).value.content, 'Claude wrote this file.');
    assert.equal(finished.usage.unknown, 0);
    assert.ok(requests.length >= 3);
  } finally {
    await f.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
