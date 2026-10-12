import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from 'jose';
import { fixture } from './helpers.mjs';
import { chatgptService, verifyChatgptIdentity } from '../server/chatgpt.mjs';
import { providerPayload } from '../server/provider.mjs';
import { responseAccumulator } from '../server/responses.mjs';
import { hash, token, now } from '../server/security.mjs';

const granted = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const credential = () => ({ access_token: 'qa-access-sensitive', refresh_token: 'qa-refresh-sensitive', id_token: 'qa-id-sensitive', token_type: 'Bearer', expires_in: 3600, scope: granted });
async function setup() {
  const f = await fixture(); const requests = [];
  const service = chatgptService(f.config, f.store, f.vault, { verify: async (_, client, nonce) => ({ sub: 'chatgpt-subject', email: 'same@example.test', nonce }), fetch: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/models')) return Response.json({ models: [{ slug: 'available-model', display_name: 'Available model', visibility: 'list' }, { slug: 'hidden-model', visibility: 'hide' }] });
    if (String(url).endsWith('/oauth/token')) { await new Promise(resolve => setTimeout(resolve, 30)); return Response.json({ ...credential(), access_token: 'qa-new-access', refresh_token: 'qa-new-refresh' }); }
    if (String(url).endsWith('openid-configuration')) return Response.json({ revocation_endpoint: 'https://auth.openai.com/revoke' });
    return new Response(null, { status: 200 });
  } });
  return { ...f, service, requests, async link(user = 'local-owner', client = 'oaiapp_testing') { const pair = service.begin(user); const pending = service.start(pair.code); return (await service.finish(pending.finish, client, credential())).account; } };
}

test('ChatGPT link tickets expire, are one-use, and do not expose OAuth tokens', async () => {
  const f = await setup(); try {
    const pair = f.service.begin('local-owner'); const pending = f.service.start(pair.code);
    assert.throws(() => f.service.start(pair.code), /eskirgan/);
    const linked = await f.service.finish(pending.finish, 'oaiapp_testing', credential());
    await assert.rejects(f.service.finish(pending.finish, 'oaiapp_testing', credential()), /eskirgan/);
    assert.deepEqual(linked.account.models, ['available-model']);
    assert.equal(linked.account.model_labels['available-model'], 'Available model');
    const row = f.store.one('SELECT * FROM chatgpt_accounts WHERE id=?', linked.account.id);
    assert.ok(!row.secret.includes('sensitive'));
    const publicData = JSON.stringify((await f.request('/providers')).value);
    for (const secret of Object.values(credential()).filter(v => typeof v === 'string' && v.includes('sensitive'))) assert.ok(!publicData.includes(secret));
    const expired = f.service.begin('local-owner'); f.store.exec('UPDATE chatgpt_pending SET expires_at=0');
    assert.throws(() => f.service.start(expired.code), /eskirgan/);
  } finally { await f.close(); }
});

test('ChatGPT models, account actions and run selection are private to the linked owner', async () => {
  const f = await setup(); try {
    const account = await f.link();
    const session = token(); f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)', 'other', 'Other', 'user', now());
    f.store.exec('INSERT INTO sessions VALUES(?,?,?)', hash(session), 'other', Date.now() + 60000);
    const headers = { cookie: `opensi_session=${session}` };
    assert.equal((await f.request('/providers', { headers })).value.length, 0);
    assert.throws(() => f.service.provider('other', account.id, 'available-model'), /topilmadi/);
    assert.equal((await f.request(`/chatgpt/${account.id}/disconnect`, { headers, method: 'POST', body: {} })).status, 404);
    assert.equal((await f.request('/runs', { headers, method: 'POST', body: { prompt: 'Should never run', providerId: account.id, model: 'available-model', agentId: 'developer', environment: 'cloud' } })).status, 404);
    const other = await f.link('other', 'oaiapp_testing'); assert.notEqual(other.id, account.id);
    assert.equal(f.service.list('other').length, 1); assert.equal(f.service.list('local-owner').length, 1);
    assert.equal(f.service.provider('local-owner', account.id, 'available-model').protocol, 'chatgpt-plan');
    assert.throws(() => f.service.provider('local-owner', account.id, 'invented-model'), /ro‘yxatdagi/);
  } finally { await f.close(); }
});

test('ChatGPT linking requires plan consent and keeps the previous account on failed reauthorization', async () => {
  const f = await setup(); try {
    const account = await f.link(); const original = f.store.one('SELECT secret FROM chatgpt_accounts WHERE id=?', account.id).secret;
    let pending = f.service.start(f.service.begin('local-owner', account.id).code);
    await assert.rejects(f.service.finish(pending.finish, 'oaiapp_different', credential()), /almashtirilgan/);
    pending = f.service.start(f.service.begin('local-owner', account.id).code);
    await assert.rejects(f.service.finish(pending.finish, 'oaiapp_testing', { ...credential(), scope: 'openid email' }), /ruxsat berilmadi/);
    assert.equal(f.store.one('SELECT secret FROM chatgpt_accounts WHERE id=?', account.id).secret, original);
    assert.equal(f.service.list('local-owner').length, 1);
  } finally { await f.close(); }
});

test('rotating ChatGPT refresh token is serialized and disconnect clears tokens while retaining registration', async () => {
  const f = await setup(); try {
    const account = await f.link(); const row = f.store.one('SELECT * FROM chatgpt_accounts WHERE id=?', account.id); const saved = JSON.parse(f.vault.decrypt(row.secret));
    f.store.exec('UPDATE chatgpt_accounts SET secret=? WHERE id=?', f.vault.encrypt(JSON.stringify({ ...saved, expires_at: 0 })), account.id);
    const provider = f.service.provider('local-owner', account.id, 'available-model');
    assert.deepEqual(await Promise.all([provider.getKey(), provider.getKey(), provider.getKey()]), ['qa-new-access', 'qa-new-access', 'qa-new-access']);
    assert.equal(f.requests.filter(r => r.url.endsWith('/oauth/token')).length, 1);
    assert.equal(JSON.parse(f.vault.decrypt(f.store.one('SELECT secret FROM chatgpt_accounts WHERE id=?', account.id).secret)).refresh_token, 'qa-new-refresh');
    const result = await f.service.disconnect('local-owner', account.id); assert.equal(result.revoked, true);
    assert.equal(f.store.one('SELECT secret FROM chatgpt_accounts WHERE id=?', account.id).secret, '');
    assert.equal(f.service.start(f.service.begin('local-owner', account.id).code).clientId, 'oaiapp_testing');
    assert.throws(() => f.service.provider('local-owner', account.id, 'available-model'), /Faol/);
  } finally { await f.close(); }
});

test('ChatGPT JWT verification rejects bad nonce, issuer, audience, expiry and signatures', async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256'); const jwk = await exportJWK(publicKey); const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'qa' }] });
  const sign = (values = {}, key = privateKey) => new SignJWT({ nonce: 'nonce', ...values }).setProtectedHeader({ alg: 'RS256', kid: 'qa' }).setSubject('subject').setIssuer(values.iss || 'https://auth.openai.com').setAudience(values.aud || 'oaiapp_testing').setIssuedAt().setExpirationTime(values.exp || '5m').sign(key);
  assert.equal((await verifyChatgptIdentity(await sign(), 'oaiapp_testing', 'nonce', keys)).sub, 'subject');
  for (const values of [{ nonce: 'wrong' }, { iss: 'https://wrong.test' }, { aud: 'other' }, { exp: 1 }]) await assert.rejects(verifyChatgptIdentity(await sign(values), 'oaiapp_testing', 'nonce', keys));
  const second = await generateKeyPair('RS256'); await assert.rejects(verifyChatgptIdentity(await sign({}, second.privateKey), 'oaiapp_testing', 'nonce', keys));
});

test('ChatGPT wire contract preserves tool history with namespaces and requires completed streams', () => {
  const messages = [{ role: 'system', content: 'Instructions' }, { role: 'user', content: 'Build a page' }, { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'write_file', arguments: '{"path":"index.html"}' } }] }, { role: 'tool', tool_call_id: 'call_1', content: 'Saved' }];
  const payload = providerPayload('chatgpt-plan', 'available-model', messages, [{ type: 'function', function: { name: 'write_file', parameters: { type: 'object' } } }]);
  assert.equal(payload.store, false); assert.equal(payload.stream, true); assert.equal(payload.input[0].role, 'developer');
  assert.equal(payload.input[2].namespace, 'opensi'); assert.equal(payload.input[3].call_id, 'call_1'); assert.equal(payload.tools[0].type, 'namespace');
  assert.equal(payload.tools[0].tools[0].name, 'write_file');
  for (const field of ['max_output_tokens', 'temperature', 'previous_response_id', 'background']) assert.equal(field in payload, false);
  const state = responseAccumulator(() => {}); state.ingest({ type: 'response.output_text.delta', delta: 'partial' }); assert.equal(state.value().finished, false);
  assert.throws(() => state.ingest({ type: 'response.failed', response: { status: 'failed', error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'Limit' } } }), /chatgpt.com\/settings\/usage/);
  assert.equal(state.value().finished, false);
});

test('ChatGPT bridge rejects browser origins and untrusted import tickets', async () => {
  const f = await setup(); try {
    const pair = (await f.request('/chatgpt/connect', { method: 'POST', body: {} })).value;
    assert.equal((await f.request('/chatgpt/bridge/start', { method: 'POST', body: {}, headers: { authorization: `Bearer ${pair.code}`, origin: 'https://evil.test' } })).status, 403);
    const started = await f.request('/chatgpt/bridge/start', { method: 'POST', body: {}, headers: { authorization: `Bearer ${pair.code}` } }); assert.equal(started.status, 200);
    assert.equal((await f.request('/chatgpt/bridge/start', { method: 'POST', body: {}, headers: { authorization: `Bearer ${pair.code}` } })).status, 401);
    assert.equal((await f.request('/chatgpt/bridge/finish', { method: 'POST', body: { clientId: 'oaiapp_testing', tokens: credential() }, headers: { authorization: `Bearer ${token()}` } })).status, 401);
  } finally { await f.close(); }
});

test('admin can share inference with Google users without granting account management or leaking identity', async () => {
  const f = await setup(); try {
    const account = await f.link(); const session = token();
    f.store.exec('INSERT INTO users(id,google_sub,name,role,created_at) VALUES(?,?,?,?,?)', 'shared-user', 'google-qa-sub', 'Shared user', 'user', now());
    f.store.exec('INSERT INTO sessions VALUES(?,?,?)', hash(session), 'shared-user', Date.now() + 60000);
    const headers = { cookie: `opensi_session=${session}` };
    assert.equal((await f.request('/providers', { headers })).value.length, 0);
    assert.equal((await f.request(`/chatgpt/${account.id}/sharing`, { method: 'PATCH', body: { shared: true } })).status, 200);
    const visible = (await f.request('/providers', { headers })).value.find(p=>p.protocol==='chatgpt-plan');
    assert.deepEqual(visible.models, ['available-model']); assert.equal(visible.shared, true); assert.equal(visible.can_manage, false); assert.equal(visible.can_share, false);
    assert.equal(visible.email, undefined); assert.ok(!JSON.stringify(visible).includes('same@example.test')); assert.ok(!JSON.stringify(visible).includes('sensitive'));
    const provider = f.service.provider('shared-user', account.id, 'available-model'); assert.equal(await provider.getKey(), credential().access_token);
    for (const route of ['models', 'disconnect']) assert.equal((await f.request(`/chatgpt/${account.id}/${route}`, { headers, method: 'POST', body: {} })).status, 404);
    assert.equal((await f.request('/chatgpt/connect', { headers, method: 'POST', body: { accountId: account.id } })).status, 404);
    assert.equal((await f.request(`/chatgpt/${account.id}/sharing`, { headers, method: 'PATCH', body: { shared: false } })).status, 403);
    f.store.exec("UPDATE users SET token_limit=0 WHERE id='shared-user'");
    assert.equal((await f.request(`/chatgpt/${account.id}/test`, { headers, method: 'POST', body: { model: 'available-model' } })).status, 429);
    const run = await f.request('/runs', { headers, method: 'POST', body: { prompt: 'Quota boundary', providerId: account.id, model: 'available-model', agentId: 'developer', environment: 'cloud' } });
    assert.equal(run.status, 201);
    const row = await (async () => { for (let i=0;i<100;i++) { const r=f.store.one('SELECT * FROM runs WHERE id=?',run.value.run.id); if(r?.status==='failed')return r; await new Promise(resolve=>setTimeout(resolve,20)); } throw new Error('Run did not stop'); })();
    assert.equal(row.user_id, 'shared-user'); assert.ok(row.error.includes('token chegarasi'));
    assert.equal((await f.request(`/runs/${row.id}`)).status, 404); // Sharing a model does not share projects, even with its owner.
    f.service.share('local-owner', account.id, false);
    await assert.rejects(provider.getKey(), /topilmadi/); assert.equal((await f.request('/providers', { headers })).value.length, 0);
  } finally { await f.close(); }
});

test('shared ChatGPT access follows current Google identity and owner status, including refresh races', async () => {
  const f = await setup(); try {
    const account = await f.link();
    f.store.exec('INSERT INTO users(id,google_sub,name,role,created_at) VALUES(?,?,?,?,?)', 'shared-user', 'google-qa-sub', 'Shared user', 'user', now());
    f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)', 'not-google', 'Not Google', 'user', now());
    f.service.share('local-owner', account.id, true);
    assert.equal(f.service.list('not-google').length, 0); assert.throws(() => f.service.provider('not-google', account.id, 'available-model'), /topilmadi/);
    const provider = f.service.provider('shared-user', account.id, 'available-model');
    f.store.exec("UPDATE users SET disabled=1 WHERE id='local-owner'"); assert.equal(f.service.list('shared-user').length,0); await assert.rejects(provider.getKey(), /topilmadi/);
    f.store.exec("UPDATE users SET disabled=0,role='user' WHERE id='local-owner'"); assert.equal(f.service.list('shared-user').length,0); await assert.rejects(provider.getKey(), /topilmadi/);
    assert.throws(() => f.service.share('local-owner', account.id, true), /administrator/);
    f.store.exec("UPDATE users SET role='admin' WHERE id='local-owner'");
    const row = f.store.one('SELECT secret FROM chatgpt_accounts WHERE id=?', account.id), saved = JSON.parse(f.vault.decrypt(row.secret));
    f.store.exec('UPDATE chatgpt_accounts SET secret=? WHERE id=?', f.vault.encrypt(JSON.stringify({ ...saved, expires_at: 0 })), account.id);
    const refresh = provider.getKey(); f.service.share('local-owner', account.id, false); await assert.rejects(refresh, /topilmadi/);
    assert.equal(await f.service.provider('local-owner', account.id, 'available-model').getKey(), 'qa-new-access');
  } finally { await f.close(); }
});
