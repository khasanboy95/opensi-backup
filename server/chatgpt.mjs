import {assertModelAllowed,visibleProviders} from './model-access.mjs';
import { randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, hash, id, token, now } from './security.mjs';

export const chatgptResource = 'https://api.openai.com/v1';
const issuer = 'https://auth.openai.com';
const keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
export async function verifyChatgptIdentity(raw, clientId, nonce, jwks = keys) {
  const { payload } = await jwtVerify(raw, jwks, { issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'iat'], clockTolerance: 5 });
  if (!payload.sub || payload.nonce !== nonce) throw new HttpError(400, 'ChatGPT hisob tasdig‘i mos kelmadi. Qayta ulang.');
  return payload;
}
const scopesOf = value => typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
const needPlan = scopes => { if (!scopes.includes('chatgpt.tokens.use.direct')) throw new HttpError(403, 'ChatGPT tarifidan foydalanishga ruxsat berilmadi. ChatGPT sozlamalarida OpenSI ruxsatini tekshiring.'); };
const safeError = status => new HttpError(502, `ChatGPT ulanishi bajarilmadi (HTTP ${status}). Ulanishlar bo‘limida qayta kiring yoki ChatGPT usage sozlamalarini tekshiring.`);

export function chatgptService(config, store, vault, dependencies = {}) {
  const request = dependencies.fetch || fetch;
  const verify = dependencies.verify || verifyChatgptIdentity;
  const locks = new Map();
  let hostId = store.setting('chatgpt-host-id');
  if (!hostId) { hostId = `urn:uuid:${randomUUID()}`; store.setSetting('chatgpt-host-id', hostId); }
  const owner = (userId, accountId) => {
    const row = store.one('SELECT * FROM chatgpt_accounts WHERE id=? AND user_id=?', accountId, userId);
    if (!row) throw new HttpError(404, 'ChatGPT ulanishi topilmadi.');
    return row;
  };
  const viewer = userId => store.one('SELECT id,role,google_sub,disabled FROM users WHERE id=?', userId);
  const usable = (userId, accountId) => {
    const user = viewer(userId);
    const row = store.one('SELECT a.*,u.role AS owner_role,u.disabled AS owner_disabled FROM chatgpt_accounts a JOIN users u ON u.id=a.user_id WHERE a.id=?', accountId);
    const allowed = user && !user.disabled && row && (row.user_id === userId || (user.google_sub && row.shared && row.owner_role === 'admin' && !row.owner_disabled));
    if (!allowed) throw new HttpError(404, 'ChatGPT ulanishi topilmadi.');
    return row;
  };
  const publicAccount = (row, userId = row.user_id) => ({ id: row.id,
    label: row.user_id === userId ? `ChatGPT · ${row.email || 'hisob'} · ${row.id.slice(-6)}` : `OpenSI ChatGPT · ${row.id.slice(-6)}`,
    ...(row.user_id === userId ? { email: row.email } : {}), shared: Boolean(row.shared), can_manage: row.user_id === userId,
    can_share: row.user_id === userId && viewer(userId)?.role === 'admin',
    base_url: chatgptResource, protocol: 'chatgpt-plan', models: JSON.parse(row.models).map(m => m.slug), model_labels: Object.fromEntries(JSON.parse(row.models).map(m => [m.slug, m.display_name])),
    has_key: Boolean(row.secret), enabled: Boolean(row.secret), verified_at: row.updated_at, tested_at: row.tested_at });
  async function catalog(accessToken) {
    const response = await request(`${chatgptResource}/models`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
    if (!response.ok) throw safeError(response.status);
    const body = await response.json();
    const models = (Array.isArray(body.models) ? body.models : []).filter(m => m.visibility === 'list' && typeof m.slug === 'string' && m.slug.length < 200)
      .slice(0, 300).map(m => ({ slug: m.slug, display_name: String(m.display_name || m.slug).slice(0, 200) }));
    if (!models.length) throw new HttpError(403, 'Bu ChatGPT hisobidan foydalanish mumkin bo‘lgan model qaytmadi. Tarif va OpenSI ruxsatini tekshiring.');
    return models;
  }
  function credentialRecord(tokens, previous = {}) {
    const scopes = tokens.scope === undefined ? previous.scopes || [] : scopesOf(tokens.scope);
    needPlan(scopes);
    if (typeof tokens.access_token !== 'string' || !tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0 || tokens.token_type?.toLowerCase() !== 'bearer') throw new HttpError(400, 'ChatGPT token javobi to‘liq emas.');
    const refresh = tokens.refresh_token || previous.refresh_token;
    if (typeof refresh !== 'string' || !refresh) throw new HttpError(400, 'ChatGPT yangilash ruxsati olinmadi. Qayta ulang.');
    return { access_token: tokens.access_token, refresh_token: refresh, id_token: tokens.id_token || previous.id_token,
      scopes, expires_at: Date.now() + tokens.expires_in * 1000 };
  }
  async function access(userId, accountId) {
    // One refresh at a time; the database update precedes every waiter returning.
    if (locks.has(accountId)) await locks.get(accountId);
    const row = owner(userId, accountId);
    if (!row.secret) throw new HttpError(401, 'ChatGPT hisobiga qayta kiring.');
    const saved = JSON.parse(vault.decrypt(row.secret));
    if (saved.expires_at > Date.now() + 60_000) return saved.access_token;
    const pending = (async () => {
      const response = await request(`${issuer}/api/accounts/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: row.client_id, refresh_token: saved.refresh_token, resource: chatgptResource }), signal: AbortSignal.timeout(20_000), redirect: 'error' });
      if (!response.ok) {
        if ([400, 401, 403].includes(response.status)) store.exec("UPDATE chatgpt_accounts SET secret='' WHERE id=?", accountId);
        throw safeError(response.status);
      }
      const next = credentialRecord(await response.json(), saved);
      store.exec('UPDATE chatgpt_accounts SET secret=? WHERE id=? AND secret=?', vault.encrypt(JSON.stringify(next)), accountId, row.secret);
      if (!owner(userId, accountId).secret) throw new HttpError(401, 'ChatGPT ulanishi uzilgan.');
      return next.access_token;
    })();
    locks.set(accountId, pending);
    try { return await pending; } finally { locks.delete(accountId); }
  }
  return {
    list(userId) {
      const user = viewer(userId);
      if (!user || user.disabled) return [];
      return store.all("SELECT a.* FROM chatgpt_accounts a JOIN users u ON u.id=a.user_id WHERE a.user_id=? OR (a.shared=1 AND u.role='admin' AND u.disabled=0 AND ?=1) ORDER BY a.created_at", userId, user.google_sub ? 1 : 0).map(row => visibleProviders(store,config,userId,[publicAccount(row, userId)])[0]).filter(Boolean);
    },
    share(userId, accountId, enabled) {
      if (viewer(userId)?.role !== 'admin' || viewer(userId)?.disabled) throw new HttpError(403, 'Umumiy ulanishni faqat administrator boshqaradi.');
      owner(userId, accountId);
      store.exec('UPDATE chatgpt_accounts SET shared=? WHERE id=? AND user_id=?', enabled ? 1 : 0, accountId, userId);
      store.exec('INSERT INTO login_events VALUES(?,?,?,?,?)', id('login_'), userId, 'chatgpt-sharing', enabled ? 'enabled' : 'disabled', now());
      return publicAccount(owner(userId, accountId), userId);
    },
    begin(userId, accountId = null) {
      if (accountId) owner(userId, accountId);
      store.exec('DELETE FROM chatgpt_pending WHERE expires_at<? OR user_id=?', Date.now(), userId);
      const code = token();
      store.exec('INSERT INTO chatgpt_pending(hash,user_id,account_id,nonce,expires_at,phase) VALUES(?,?,?,?,?,?)', hash(code), userId, accountId, token(), Date.now() + 10 * 60_000, 'pair');
      return { code, server: config.appUrl, expiresIn: 600 };
    },
    start(code) {
      const row = store.one("SELECT * FROM chatgpt_pending WHERE hash=? AND phase='pair' AND expires_at>?", hash(code), Date.now());
      if (!row || store.one('SELECT disabled FROM users WHERE id=?', row.user_id)?.disabled) throw new HttpError(401, 'Ulash kodi eskirgan yoki ishlatilgan. Yangi kod yarating.');
      const finish = token();
      store.exec("UPDATE chatgpt_pending SET hash=?,phase='finish' WHERE hash=?", hash(finish), row.hash);
      const saved = row.account_id ? owner(row.user_id, row.account_id) : null;
      return { finish, nonce: row.nonce, hostId, clientId: saved?.client_id || 'dynamic_agent_client' };
    },
    async finish(finish, clientId, tokens) {
      const row = store.one("SELECT * FROM chatgpt_pending WHERE hash=? AND phase='finish' AND expires_at>?", hash(finish), Date.now());
      if (!row) throw new HttpError(401, 'Ulash sessiyasi eskirgan yoki ishlatilgan.');
      store.exec('DELETE FROM chatgpt_pending WHERE hash=?', row.hash);
      if (!/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId)) throw new HttpError(400, 'ChatGPT klienti tasdiqlanmadi.');
      const selected = row.account_id ? owner(row.user_id, row.account_id) : null;
      if (selected && selected.client_id !== clientId) throw new HttpError(400, 'ChatGPT klienti almashtirilgan.');
      const identity = await verify(tokens.id_token, clientId, row.nonce);
      if (selected && selected.subject !== identity.sub) throw new HttpError(400, 'Tanlangan ChatGPT hisobi mos kelmadi.');
      const credentials = credentialRecord(tokens);
      const models = await catalog(credentials.access_token);
      if (store.one('SELECT disabled FROM users WHERE id=?', row.user_id)?.disabled) throw new HttpError(403, 'OpenSI hisobi faol emas.');
      const existing = selected || store.one('SELECT * FROM chatgpt_accounts WHERE user_id=? AND client_id=? AND subject=?', row.user_id, clientId, identity.sub);
      const accountId = existing?.id || id('cg_');
      store.exec('INSERT INTO chatgpt_accounts(id,user_id,client_id,subject,email,secret,models,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,secret=excluded.secret,models=excluded.models,updated_at=excluded.updated_at,tested_at=NULL',
        accountId, row.user_id, clientId, identity.sub, String(identity.email || '').slice(0, 254), vault.encrypt(JSON.stringify(credentials)), JSON.stringify(models), now(), now());
      store.exec('INSERT INTO login_events VALUES(?,?,?,?,?)', id('login_'), row.user_id, 'chatgpt-link', 'success', now());
      return { ok: true, account: publicAccount(owner(row.user_id, accountId)) };
    },
    provider(userId, accountId, model) {
      assertModelAllowed(store,config,userId,model);
      const row = usable(userId, accountId);
      if (!row.secret || !JSON.parse(row.models).some(m => m.slug === model)) throw new HttpError(400, 'Faol ChatGPT hisobi va ro‘yxatdagi modelni tanlang.');
      return { id: row.id, base_url: chatgptResource, protocol: 'chatgpt-plan', key: '', getKey: async () => {
        const current = usable(userId, accountId);
        const key = await access(current.user_id, accountId);
        usable(userId, accountId); // Recheck sharing/disabled state after a pending refresh.
        return key;
      }, markTested: () => store.exec('UPDATE chatgpt_accounts SET tested_at=? WHERE id=?', now(), accountId) };
    },
    async refreshModels(userId, accountId) {
      const models = await catalog(await access(userId, accountId));
      store.exec('UPDATE chatgpt_accounts SET models=?,updated_at=? WHERE id=? AND user_id=?', JSON.stringify(models), now(), accountId, userId);
      return publicAccount(owner(userId, accountId));
    },
    async disconnect(userId, accountId) {
      owner(userId, accountId);
      if (store.one("SELECT id FROM runs WHERE (user_id=? OR provider_id=?) AND status IN ('queued','running','waiting_approval','waiting_input')", userId, accountId)) throw new HttpError(409, 'Avval ishlayotgan vazifani tugating yoki to‘xtating.');
      if (locks.has(accountId)) await locks.get(accountId).catch(() => {});
      const row = owner(userId, accountId); let revoked = !row.secret;
      if (row.secret) {
        const credentials = JSON.parse(vault.decrypt(row.secret));
        try {
          const discovery = await request(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' });
          const endpoint = new URL((await discovery.json()).revocation_endpoint);
          if (endpoint.origin !== issuer) throw new Error('Invalid revocation endpoint');
          const response = await request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: credentials.refresh_token, token_type_hint: 'refresh_token', client_id: row.client_id }), signal: AbortSignal.timeout(15_000), redirect: 'error' });
          revoked = response.status === 200;
        } catch { /* Local disconnect still clears credentials. */ }
      }
      store.exec("UPDATE chatgpt_accounts SET secret='',models='[]',tested_at=NULL WHERE id=? AND user_id=?", accountId, userId);
      return { ok: true, revoked, message: revoked ? 'ChatGPT ulanishi uzildi.' : 'OpenSI ulanishi uzildi. ChatGPT tomondagi bekor qilish tasdiqlanmadi; ChatGPT Settings orqali ham uzing.' };
    },
  };
}
