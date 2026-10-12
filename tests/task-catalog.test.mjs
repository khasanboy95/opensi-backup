import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers.mjs';

test('task categories, search and cursor pagination include all owned runs without duplicates', async () => {
  const f = await fixture();
  try {
    const stamp = '2026-10-11T10:00:00.000Z';
    f.store.exec("INSERT INTO users(id,name,role,created_at) VALUES('other','Other user','user',?)", stamp);
    for (const [id, owner, title, environment] of [
      ['prj_alpha','local-owner','Alpha project','cloud'],
      ['prj_beta','local-owner','Beta project','local'],
      ['prj_other','other','Private project','cloud'],
    ]) f.store.exec('INSERT INTO projects(id,user_id,title,environment,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, owner, title, environment, stamp, stamp);
    const statuses = ['queued','running','waiting_approval','waiting_input','completed','failed','cancelled','interrupted'];
    for (let i = 0; i < 87; i++) {
      const id = 'run_' + String(i).padStart(4, '0');
      f.store.exec('INSERT INTO runs(id,user_id,project_id,model,prompt,status,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
        id, 'local-owner', i === 0 ? 'prj_beta' : 'prj_alpha', 'qa-model', i === 0 ? '100%_ exact task' : 'Regular task ' + i, statuses[i % statuses.length], i === 0 ? 'local' : 'cloud', stamp, stamp);
    }
    f.store.exec('INSERT INTO runs(id,user_id,project_id,prompt,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', 'run_private', 'other', 'prj_other', 'Private prompt', 'completed', stamp, stamp);
    f.store.exec('INSERT INTO usage(id,user_id,run_id,input_tokens,output_tokens,known,created_at) VALUES(?,?,?,?,?,?,?)', 'u_task_1', 'local-owner', 'run_0086', 12, 4, 1, stamp);
    f.store.exec('INSERT INTO usage(id,user_id,run_id,input_tokens,output_tokens,known,created_at) VALUES(?,?,?,?,?,?,?)', 'u_task_2', 'local-owner', 'run_0086', 3, 2, 1, stamp);

    const seen = [];
    let cursor = '';
    do {
      const response = await f.request('/runs/catalog?limit=40' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      assert.equal(response.status, 200, JSON.stringify(response.value));
      assert.equal(response.value.counts.all, 87);
      seen.push(...response.value.items.map(item => item.id));
      if (seen.length === 40) assert.deepEqual(response.value.items[0].usage, { input: 15, output: 6, unknown: 0 });
      cursor = response.value.nextCursor;
    } while (cursor);
    assert.equal(seen.length, 87);
    assert.equal(new Set(seen).size, 87);
    assert.equal(seen[0], 'run_0086');
    assert.ok(!seen.includes('run_private'));

    const waiting = await f.request('/runs/catalog?category=waiting&limit=100');
    assert.equal(waiting.status, 200);
    assert.equal(waiting.value.items.length, 22);
    assert.ok(waiting.value.items.every(item => ['waiting_approval','waiting_input'].includes(item.status)));
    const issues = await f.request('/runs/catalog?category=issues');
    assert.equal(issues.value.items.length, 21);
    const oldest = await f.request('/runs/catalog?sort=oldest&limit=1');
    assert.equal(oldest.value.items[0].id, 'run_0000');
    const project = await f.request('/runs/catalog?projectId=prj_beta&environment=local');
    assert.equal(project.value.counts.all, 1);
    assert.equal(project.value.items[0].id, 'run_0000');
    const search = await f.request('/runs/catalog?q=' + encodeURIComponent('100%_'));
    assert.equal(search.value.counts.all, 1, 'search treats SQL wildcard characters as plain text');
    assert.equal(search.value.items[0].id, 'run_0000');
    assert.equal((await f.request('/runs/catalog?cursor=bad-cursor')).status, 400);
    assert.equal((await f.request('/runs/catalog?projectId=prj_other')).status, 404);
    assert.equal((await f.request('/runs/catalog?limit=101')).status, 400);
  } finally { await f.close(); }
});
