import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createHash } from 'node:crypto';
import { hash, token, id, now, isLoopback, HttpError } from './security.mjs';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function authService(config, store, vault) {
  const options = { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/', maxAge: 7 * 86400_000 };
  const settings = () => {
    const saved = store.setting('google', {});
    return {
      clientId: config.googleClientId || saved.clientId || '',
      clientSecret: config.googleClientSecret || saved.clientSecret || '',
      adminEmails: config.adminEmails.length ? config.adminEmails : (saved.adminEmails || []),
    };
  };
  return {
    settings,
    publicConfig() {
      const value = settings();
      return { configured: Boolean(value.clientId && value.clientSecret), localMode: config.localAuth, redirectUri: `${config.appUrl}/api/auth/google/callback` };
    },
    user(req) {
      const session = req.cookies?.opensi_session;
      if (session) {
        const user = store.one('SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.hash=? AND s.expires_at>? AND u.disabled=0', hash(session), Date.now());
        if (user) return { ...user, local: false };
      }
      if (config.localAuth && isLoopback(req.socket.remoteAddress)) {
        const user = store.one("SELECT * FROM users WHERE id='local-owner'");
        return { ...user, local: true };
      }
      return null;
    },
    requireUser(req, _res, next) {
      req.user = this.user(req);
      if (!req.user) return next(new HttpError(401, 'Google hisobingiz orqali kiring.'));
      next();
    },
    requireAdmin(req, _res, next) {
      if (req.user?.role !== 'admin') return next(new HttpError(403, 'Bu bo‘lim faqat administrator uchun.'));
      next();
    },
    begin(req, res) {
      const { clientId, clientSecret } = settings();
      if (!clientId || !clientSecret) throw new HttpError(503, 'Google OAuth hali sozlanmagan. Administrator Sozlamalar bo‘limida ulashi mumkin.');
      const state = token(); const nonce = token(); const verifier = token();
      // A same-origin continuation is needed when ChatGPT starts account linking.
      const next = typeof req.query.next === 'string' && /^\/oauth\/authorize\?[^\r\n]*$/.test(req.query.next) ? req.query.next : '';
      res.cookie('opensi_oauth', vault.encrypt(JSON.stringify({ state, nonce, verifier, next, expires: Date.now() + 10 * 60_000 })), { ...options, path: '/api/auth', maxAge: 10 * 60_000 });
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: `${config.appUrl}/api/auth/google/callback`,
        response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
      res.redirect(url.toString());
    },
    async callback(req, res) {
      try {
        const payload = req.cookies?.opensi_oauth;
        res.clearCookie('opensi_oauth', { ...options, path: '/api/auth' });
        if (!payload || typeof req.query.state !== 'string' || typeof req.query.code !== 'string') throw new Error('OAuth javobi to‘liq emas.');
        const saved = JSON.parse(vault.decrypt(payload));
        if (saved.state !== req.query.state || saved.expires < Date.now()) throw new Error('OAuth so‘rovi muddati tugagan yoki mos emas.');
        const google = settings();
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code: req.query.code, client_id: google.clientId, client_secret: google.clientSecret,
            redirect_uri: `${config.appUrl}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: saved.verifier }),
          signal: AbortSignal.timeout(20_000), redirect: 'error',
        });
        if (!response.ok) throw new Error('Google token tekshiruvi bajarilmadi.');
        const tokens = await response.json();
        const { payload: identity } = await jwtVerify(tokens.id_token, googleKeys, {
          audience: google.clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'],
        });
        if (identity.nonce !== saved.nonce || !identity.sub || identity.email_verified !== true || typeof identity.email !== 'string') throw new Error('Google hisob tasdiqlanmadi.');
        const email = identity.email.toLowerCase();
        const existing = store.one('SELECT * FROM users WHERE google_sub=?', identity.sub);
        if (existing?.disabled) throw new Error('Hisob administrator tomonidan to‘xtatilgan.');
        const userId = existing?.id || id('usr_');
        const role = google.adminEmails.includes(email) ? 'admin' : 'user';
        if (!existing) store.exec('INSERT INTO users(id,google_sub,email,name,picture,role,created_at,last_login_at) VALUES(?,?,?,?,?,?,?,?)',
          userId, identity.sub, email, String(identity.name || email).slice(0, 120), String(identity.picture || ''), role, now(), now());
        else store.exec('UPDATE users SET email=?,name=?,picture=?,role=?,last_login_at=? WHERE id=?', email,
          String(identity.name || email).slice(0, 120), String(identity.picture || ''), role, now(), userId);
        const session = token();
        store.exec('INSERT INTO sessions VALUES(?,?,?)', hash(session), userId, Date.now() + 7 * 86400_000);
        store.exec('DELETE FROM sessions WHERE expires_at<?', Date.now());
        store.exec('INSERT INTO login_events VALUES(?,?,?,?,?)', id('login_'), userId, 'google', 'success', now());
        res.cookie('opensi_session', session, options);
        res.redirect(saved.next ? new URL(saved.next, config.appUrl).toString() : config.appUrl);
      } catch {
        store.exec('INSERT INTO login_events VALUES(?,?,?,?,?)', id('login_'), null, 'google', 'failed', now());
        res.redirect(`${config.appUrl}/?signin_error=${encodeURIComponent('Google orqali kirish bajarilmadi. OAuth sozlamalari va hisob holatini tekshiring.')}`);
      }
    },
    logout(req, res) {
      if (req.cookies?.opensi_session) store.exec('DELETE FROM sessions WHERE hash=?', hash(req.cookies.opensi_session));
      res.clearCookie('opensi_session', options);
      res.json({ ok: true });
    },
  };
}
