import { randomBytes, createHash, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const id = (prefix = '') => `${prefix}${randomBytes(12).toString('hex')}`;
export const token = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const isLoopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);

export function createVault(config) {
  mkdirSync(config.dataDir, { recursive: true });
  const keyPath = path.join(config.dataDir, '.master-key');
  let key;
  if (config.encryptionKey) {
    if (!/^[a-f0-9]{64}$/i.test(config.encryptionKey)) throw new Error('OPENSI_ENCRYPTION_KEY formati noto‘g‘ri.');
    key = Buffer.from(config.encryptionKey, 'hex');
  } else if (existsSync(keyPath)) key = readFileSync(keyPath);
  else { key = randomBytes(32); writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' }); }
  if (key.length !== 32) throw new Error('Server shifrlash kaliti noto‘g‘ri.');
  return {
    encrypt(text) {
      if (!text) return '';
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
    },
    decrypt(value) {
      if (!value) return '';
      const data = Buffer.from(value, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    },
    sign(value) { return createHmac('sha256', key).update(value).digest('base64url'); },
    verify(value, signature) {
      const expected = Buffer.from(this.sign(value));
      const actual = Buffer.from(signature || '');
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    },
  };
}

export function redact(message, secrets = []) {
  let result = String(message || 'Noma’lum xatolik');
  for (const secret of secrets) if (secret) result = result.split(secret).join('[maxfiy]');
  return result.replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [maxfiy]').replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, '[maxfiy]').slice(0, 1000);
}

export function privateAddress(address) {
  const a = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (a === 'localhost' || a.endsWith('.localhost') || a.endsWith('.local') || a === '::' || a === '::1') return true;
  if (a.startsWith('::')) return true;
  if (isIP(a) === 6) return /^(fc|fd|fe[89ab]|ff)/.test(a);
  if (isIP(a) === 4) {
    const p = a.split('.').map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && (p[1] === 168 || p[1] === 0)) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  return false;
}

// Validate the address returned for the actual TCP connection, not only a prior DNS query.
export function guardedLookup(hostname, options, callback, resolver = lookup) {
  resolver(hostname, { all: true }).then(addresses => {
    if (!addresses.length || addresses.some(item => privateAddress(item.address))) {
      callback(new Error('Xususiy tarmoq manziliga ulanish rad etildi.')); return;
    }
    const family = typeof options === 'object' ? options.family : options;
    const matches = family ? addresses.filter(item => item.family === family) : addresses;
    if (!matches.length) { callback(new Error('Tarmoq manzili topilmadi.')); return; }
    if (options?.all) callback(null, matches); else callback(null, matches[0].address, matches[0].family);
  }).catch(callback);
}
const publicDispatcher = new Agent({ connect: { lookup: guardedLookup } });
export async function guardedFetch(input, options = {}, { allowLocal = false } = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  await validateUrl(`${url.origin}${url.pathname}`, { allowLocal });
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  return fetch(input, { ...options, redirect: options.redirect || 'error', ...(!(allowLocal && loopback) ? { dispatcher: publicDispatcher } : {}) });
}

export async function validateUrl(value, { allowLocal = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(400, 'To‘g‘ri URL manzilini kiriting.'); }
  if (url.username || url.password || url.hash || url.search) throw new HttpError(400, 'URL ichida parol, query yoki fragment bo‘lmasligi kerak.');
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLocal && loopback && url.protocol === 'http:')) throw new HttpError(400, 'HTTPS manzil kerak. Lokal developmentda localhost HTTP ishlaydi.');
  if (!(allowLocal && loopback)) {
    const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
    if (!addresses.length || addresses.some(item => privateAddress(item.address))) throw new HttpError(400, 'Bu ulanish uchun ommaviy tarmoq manzili kerak.');
  }
  return url.toString().replace(/\/$/, '');
}

export async function publicFetch(value, options = {}) {
  let url = new URL(value);
  for (let redirects = 0; redirects < 4; redirects++) {
    const originPath = `${url.origin}${url.pathname}`;
    await validateUrl(originPath);
    const response = await guardedFetch(url, { ...options, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) return response;
    url = new URL(location, url);
  }
  throw new HttpError(400, 'Juda ko‘p URL yo‘naltirishlari.');
}
