import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture, createRun, until, mockProvider, addProvider, runState, tempDir, removeTemp } from './helpers.mjs';
import { fileTool } from '../server/files.mjs';
import { hash, token, now } from '../server/security.mjs';
import { createRunner, compactFileContext } from '../server/runner.mjs';

test('large files can be read in ranges, copied, appended and edited without losing the existing source', async () => {
  const root = await tempDir();
  try {
    const prefix = 'x'.repeat(28000) + '\nfunction target(){return "old";}\n';
    await fileTool(root, 'write_file', { path: 'drafts/index.html', content: prefix });
    const tail = await fileTool(root, 'read_file', { path: 'drafts/index.html', offset: 28000, limit: 12000 });
    assert.equal(tail.content, '\nfunction target(){return "old";}\n'); assert.equal(tail.nextOffset, prefix.length); assert.equal(tail.truncated, false);
    await fileTool(root, 'copy_file', { from: 'drafts/index.html', path: 'index.html' });
    await fileTool(root, 'append_file', { path: 'index.html', content: '</script></body></html>' });
    await fileTool(root, 'edit_file', { path: 'index.html', search: 'return "old"', replace: 'return "fixed"' });
    assert.equal((await fileTool(root, 'read_file', { path: 'index.html' })).content, prefix.replace('return "old"', 'return "fixed"') + '</script></body></html>');
    assert.equal((await fileTool(root, 'read_file', { path: 'drafts/index.html' })).content, prefix);
    await assert.rejects(fileTool(root, 'edit_file', { path: 'index.html', search: 'xxxx', replace: 'bad' }), /bir necha joyda/);
    await assert.rejects(fileTool(root, 'edit_file', { path: 'index.html', search: 'missing', replace: 'bad' }), /topilmadi/);
    await assert.rejects(fileTool(root, 'append_file', { path: 'index.html', content: '✅'.repeat(170000) }), /500 KB/);
    await assert.rejects(fileTool(root, 'copy_file', { from: 'index.html', path: '../escaped.html' }), /tashqarisidagi/);
    assert.ok((await fileTool(root, 'read_file', { path: 'index.html' })).content.endsWith('</html>'));
  } finally { await removeTemp(root); }
});

test('an interrupted draft is recovered separately, remains private and recovery never overwrites a user edit', async () => {
  const f = await fixture(); let release; const gate = new Promise(resolve => { release = resolve; });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'qa-model' }] })); return; }
    for await (const _ of req) {}
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.flushHeaders();
    const send = data => res.write(`data: ${JSON.stringify(data)}\n\n`);
    send({ type: 'response.output_item.added', item: { id: 'fc_draft', type: 'function_call', call_id: 'call_draft', name: 'write_file', arguments: '' } });
    send({ type: 'response.function_call_arguments.delta', item_id: 'fc_draft', delta: '{"path":"index.html","content":"<!doctype html>\\nPARTIAL_ONLY' });
    await gate; if (!res.destroyed) res.end();
  });
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const added = await f.request('/providers', { method: 'POST', body: { label: 'Recover QA', protocol: 'responses', baseUrl: `http://127.0.0.1:${server.address().port}/v1` } });
    assert.equal(added.status, 200); const { run, project } = await createRun(f, added.value, 'Recovery test');
    const live = await until(async () => { const value = (await f.request('/runs/' + run.id)).value; return value?.live?.drafts[0]?.content.includes('PARTIAL_ONLY') ? value : null; });
    assert.equal((await f.request(`/projects/${project.id}/file`, { method: 'PUT', body: { path: 'index.html', content: 'BLOCKED_WHILE_RUNNING' } })).status,409);
    await f.request('/runs/' + run.id + '/cancel', { method: 'POST', body: {} });
    await until(async () => (await f.request('/runs/' + run.id)).value?.live?.drafts[0]?.state === 'interrupted');
    assert.equal((await f.request(`/projects/${project.id}/file`, { method: 'PUT', body: { path: 'index.html', content: 'KNOWN_GOOD_VERSION' } })).status,200);
    const key = live.live.drafts[0].key;
    const session = token(); f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)', 'other-recovery', 'Other', 'user', now());
    f.store.exec('INSERT INTO sessions VALUES(?,?,?)', hash(session), 'other-recovery', Date.now() + 60000);
    assert.equal((await f.request(`/runs/${run.id}/drafts/recover`, { method: 'POST', body: { key }, headers: { cookie: `opensi_session=${session}` } })).status, 404);
    const recovered = await f.request(`/runs/${run.id}/drafts/recover`, { method: 'POST', body: { key } }); assert.equal(recovered.status, 200);
    assert.ok(recovered.value.path.startsWith('drafts/')); assert.equal(recovered.value.operation, 'write_file');
    assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`)).value.content, 'KNOWN_GOOD_VERSION');
    assert.equal((await f.request(`/projects/${project.id}/file?path=${encodeURIComponent(recovered.value.path)}`)).value.content, '<!doctype html>\nPARTIAL_ONLY');
    await f.request(`/projects/${project.id}/file`, { method: 'PUT', body: { path: recovered.value.path, content: 'USER_EDITED_RECOVERY' } });
    assert.equal((await f.request(`/runs/${run.id}/drafts/recover`, { method: 'POST', body: { key } })).status, 200);
    assert.equal((await f.request(`/projects/${project.id}/file?path=${encodeURIComponent(recovered.value.path)}`)).value.content, 'USER_EDITED_RECOVERY');
    const done = (await f.request('/runs/' + run.id)).value; assert.equal(done.live.drafts[0].state, 'recovered'); assert.equal(done.live.drafts[0].content, '');
  } finally { release(); await f.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('the agent file loop can finish and repair code using compact edits', async () => {
  const f = await fixture(); const mock = await mockProvider();
  try {
    const provider = await addProvider(f, mock); const { run, project } = await createRun(f, provider, '_EDIT_FLOW_');
    const done = await runState(f, run.id, 'completed');
    assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`)).value.content, '<html>FIXED</html>');
    assert.ok(done.events.some(event => event.type === 'tool_result' && event.data.tool === 'append_file' && event.data.result.saved));
    assert.ok(done.events.some(event => event.type === 'tool_result' && event.data.tool === 'edit_file' && event.data.result.saved));
    for (const message of mock.requests[1].messages.filter(message => message.role === 'tool')) assert.doesNotThrow(() => JSON.parse(message.content));
  } finally { await f.close(); await mock.close(); }
});

test('a model write larger than 20000 characters saves the file and finishes the run', async () => {
  const f = await fixture(); const mock = await mockProvider();
  try {
    const provider = await addProvider(f,mock); const {run,project}=await createRun(f,provider,'_LARGE_WRITE_');
    const done=await runState(f,run.id,'completed');
    assert.equal(done.events.find(event=>event.type==='tool_result'&&event.data.tool==='write_file')?.data.result.saved,true);
    const file=(await f.request(`/projects/${project.id}/file?path=index.html`)).value.content;
    assert.equal(file.length,27041); assert.ok(file.endsWith('</body></html>'));
    assert.ok(mock.requests[1].messages.find(message=>message.tool_calls?.[0]?.id==='large-write').tool_calls[0].function.arguments.length<2000);
  } finally { await f.close(); await mock.close(); }
});

test('startup makes a crash-surviving draft recoverable without claiming completion', async () => {
  const f = await fixture(); const mock = await mockProvider(); let restarted;
  try {
    const provider = await addProvider(f, mock); const { run } = await createRun(f, provider, 'Crash snapshot'); await runState(f, run.id, 'completed');
    f.store.exec("UPDATE runs SET status='running' WHERE id=?", run.id);
    f.store.exec('UPDATE live_runs SET data=? WHERE run_id=?', JSON.stringify({ phase:'writing', drafts:[{key:'crash-draft',path:'crash.html',content:'CRASH_PARTIAL',state:'writing'}],terminals:[],text:'' }), run.id);
    restarted = createRunner(f.config, f.store, f.vault, f.nodes);
    const detail = (await f.request('/runs/'+run.id)).value;
    assert.equal(detail.run.status,'interrupted'); assert.equal(detail.live.drafts[0].state,'interrupted'); assert.equal(detail.live.drafts[0].content,'CRASH_PARTIAL');
    assert.equal((await f.request(`/runs/${run.id}/drafts/recover`,{method:'POST',body:{key:'crash-draft'}})).status,200);
  } finally { await restarted?.close(); await f.close(); await mock.close(); }
});

test('a large file can finish after more than eighteen agent operations', async () => {
  const f = await fixture(); const mock = await mockProvider();
  try {
    const provider = await addProvider(f, mock); const { run, project } = await createRun(f, provider, '_LONG_FILE_FLOW_');
    const done = await runState(f, run.id, 'completed');
    const file = (await f.request(`/projects/${project.id}/file?path=index.html`)).value.content;
    assert.ok(file.startsWith('<html>')); assert.ok(file.endsWith('</html>')); assert.equal((file.match(/<p>/g)||[]).length, 18);
    assert.equal(done.events.filter(event=>event.type==='tool_result').length, 20);
    assert.equal(mock.requests.length, 21);
  } finally { await f.close(); await mock.close(); }
});

test('the configured agent operation limit still stops a loop and preserves saved work', async () => {
  const f = await fixture({agentMaxSteps:3}); const mock = await mockProvider();
  try {
    const provider = await addProvider(f, mock); const { run, project } = await createRun(f, provider, '_LONG_FILE_FLOW_');
    await runState(f, run.id, 'failed');
    assert.equal(mock.requests.length, 3);
    assert.equal((await f.request(`/projects/${project.id}/file?path=index.html`)).value.content, '<html><p>Section 1</p><p>Section 2</p>');
  } finally { await f.close(); await mock.close(); }
});

test('model context compaction preserves tool IDs, recent code, metadata and the original conversation', () => {
  const messages = [{role:'user',content:'Preserve the full game and finish it.'}];
  for (let i=0;i<10;i++) messages.push(
    {role:'assistant',tool_calls:[{id:'read-'+i,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'index.html',offset:i*12000,limit:12000})}}]},
    {role:'tool',tool_call_id:'read-'+i,content:JSON.stringify({path:'index.html',content:String(i).repeat(12000),offset:i*12000,nextOffset:(i+1)*12000,total:120000})});
  for (let i=0;i<4;i++) messages.push(
    {role:'assistant',tool_calls:[{id:'write-'+i,type:'function',function:{name:'append_file',arguments:JSON.stringify({path:'index.html',content:'CODE_'+i+'x'.repeat(8000)})}}]},
    {role:'tool',tool_call_id:'write-'+i,content:JSON.stringify({path:'index.html',saved:true,bytes:120000})});
  const original = JSON.stringify(messages); const compact = compactFileContext(messages);
  assert.equal(JSON.stringify(messages),original); assert.deepEqual(compact[0],messages[0]);
  const results = compact.filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  assert.ok(results.filter(result=>result.contentOmitted).length>0);
  assert.ok(results.reduce((sum,result)=>sum+(result.content?.length||0),0)<=80000);
  assert.equal(results[0].path,'index.html'); assert.equal(results[0].nextOffset,12000);
  assert.ok(JSON.parse(compact.find(message=>message.tool_calls?.[0].id==='write-0').tool_calls[0].function.arguments).content.includes('omitted'));
  assert.ok(JSON.parse(compact.find(message=>message.tool_calls?.[0].id==='write-3').tool_calls[0].function.arguments).content.startsWith('CODE_3'));
  assert.deepEqual(compact.filter(message=>message.role==='tool').map(message=>message.tool_call_id),messages.filter(message=>message.role==='tool').map(message=>message.tool_call_id));
});
