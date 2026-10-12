// OpenSI ChatGPT connection helper. Node.js 24+. No third-party dependencies.
// OAuth runs on loopback; only the selected OpenSI server receives credentials.
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
async function main() {
  if (!args.includes('--server') || !args.includes('--code')) throw new Error('Ishlatish: node chatgpt-connect.mjs --server https://YOUR-OPENSI --code ULASH_KODI');
  const target = new URL(option('--server'));
  if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/' || target.search || target.hash) throw new Error('OpenSI serveri HTTPS origin bo‘lishi kerak.');
  const code = option('--code');
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) throw new Error('Ulash kodi noto‘g‘ri. OpenSI Ulanishlar bo‘limidan yangi kod oling.');
  const send = async (route, ticket, body) => {
    const response = await fetch(new URL(route, target), { method: 'POST', headers: { Authorization: `Bearer ${ticket}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), redirect: 'error' });
    if (!response.ok) throw new Error(`OpenSI ulanishi bajarilmadi (HTTP ${response.status}). Ulanishlar bo‘limidan qayta boshlang.`);
    return response.json();
  };
  const pending = await send('/api/chatgpt/bridge/start', code, {});
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url'), startPath = '/' + randomBytes(24).toString('hex');
  let used = false, redirectUri, authorizationUrl, timer;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.method !== 'GET') { res.writeHead(403).end('Forbidden'); return; }
    const url = new URL(req.url, redirectUri);
    if (url.pathname === startPath) { res.writeHead(302, { Location: authorizationUrl }).end(); return; }
    if (url.pathname !== '/auth/callback' || used || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid or expired sign-in'); return; }
    used = true;
    try {
      if (url.searchParams.has('error')) throw new Error('OpenAI kirish ruxsati berilmadi.');
      const clientId = url.searchParams.get('client_id') || (pending.clientId === 'dynamic_agent_client' ? '' : pending.clientId);
      if (!/^oaiapp_[A-Za-z0-9_-]+$/.test(clientId) || (pending.clientId !== 'dynamic_agent_client' && pending.clientId !== clientId)) throw new Error('OpenAI klienti mos kelmadi.');
      const authorizationCode = url.searchParams.get('code');
      if (!authorizationCode) throw new Error('OpenAI tasdiqlash kodini qaytarmadi.');
      const response = await fetch('https://auth.openai.com/api/accounts/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code: authorizationCode, code_verifier: verifier, redirect_uri: redirectUri, resource: 'https://api.openai.com/v1' }), signal: AbortSignal.timeout(30_000), redirect: 'error' });
      if (!response.ok) throw new Error(`OpenAI tasdiqlash bajarilmadi (HTTP ${response.status}). Qayta boshlang.`);
      const tokens = await response.json();
      const result = await send('/api/chatgpt/bridge/finish', pending.finish, { clientId, tokens });
      console.log(`ChatGPT ulandi. ${result.account.models.length} model olindi. OpenSI sahifasini yangilang.`);
      res.writeHead(302, { Location: `${target.origin}/#/connections` }).end();
    } catch (error) {
      console.error(error.message);
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ChatGPT ulanmadi. Terminaldagi xabarni tekshiring va OpenSI Ulanishlar bo‘limidan qayta boshlang.');
    } finally { clearTimeout(timer); server.close(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  redirectUri = `http://127.0.0.1:${server.address().port}/auth/callback`;
  const auth = new URL('https://auth.openai.com/api/accounts/authorize');
  auth.search = new URLSearchParams({ client_id: pending.clientId, ...(pending.clientId === 'dynamic_agent_client' ? { agent_name_hint: 'OpenSI' } : {}), ext_agent_host_id: pending.hostId,
    response_type: 'code', redirect_uri: redirectUri, scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource: 'https://api.openai.com/v1',
    state, nonce: pending.nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') }).toString();
  authorizationUrl = auth.toString();
  console.log(`ChatGPT ulanishi ${target.origin} serveridagi shaxsiy OpenSI hisobingizga saqlanadi.`);
  console.log(`Brauzerda oching: http://127.0.0.1:${server.address().port}${startPath}`);
  timer = setTimeout(() => { console.error('Kirish muddati tugadi. Yangi kod bilan qayta boshlang.'); server.closeAllConnections(); server.close(); }, 10 * 60_000);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
