import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(rootDir, '.env.local'), quiet: true });
dotenv.config({ path: path.join(rootDir, '.env'), quiet: true });

export function makeConfig(overrides = {}) {
  const production = process.env.NODE_ENV === 'production';
  const config = {
    production,
    port: Number(process.env.PORT || 4580),
    host: process.env.HOST || '127.0.0.1',
    appUrl: (process.env.APP_URL || `http://127.0.0.1:${production ? 4580 : 4581}`).replace(/\/$/, ''),
    localAuth: !production && process.env.LOCAL_DEV_AUTH !== 'false',
    dataDir: path.resolve(rootDir, process.env.DATA_DIR || 'data'),
    encryptionKey: process.env.OPENSI_ENCRYPTION_KEY || '',
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    vercelClientId: process.env.VERCEL_INTEGRATION_CLIENT_ID || '',
    vercelClientSecret: process.env.VERCEL_INTEGRATION_CLIENT_SECRET || '',
    vercelIntegrationSlug: process.env.VERCEL_INTEGRATION_SLUG || '',
    adminEmails: (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
    dockerEnabled: process.env.OPENSI_DOCKER_ENABLED === 'true',
    // This deployment's videos use Google Flow account credits, not Gemini API billing.
    // Ignore the legacy environment flag so a later deploy cannot silently enable paid video calls.
    videoApiEnabled: false,
    runnerUrl: process.env.OPENSI_RUNNER_URL || '',
    runnerToken: process.env.OPENSI_RUNNER_TOKEN || '',
    computerUrl: process.env.OPENSI_COMPUTER_URL || '',
    jevKey: process.env.TYPESAFE_API_KEY || '',
    dockerImage: process.env.OPENSI_DOCKER_IMAGE || 'node:24-alpine',
    // Only enable one proxy hop when the backend port is private (see VPS Compose).
    trustProxy: process.env.OPENSI_TRUST_PROXY === '1' ? 1 : false,
    maxConcurrent: Number(process.env.OPENSI_MAX_CONCURRENT || 100),
    maxConcurrentPerUser: Number(process.env.OPENSI_MAX_CONCURRENT_PER_USER || 3),
    maxConcurrentShells: Number(process.env.OPENSI_MAX_CONCURRENT_SHELLS || 2),
    approvalTimeout: 30 * 60_000,
    connectorTimeout: 130_000,
    modelTimeout: 1800_000,
    modelIdleTimeout: 240_000,
    agentMaxSteps: 64,
    ...overrides,
  };
  const url = new URL(config.appUrl);
  for (const key of ['maxConcurrent','maxConcurrentPerUser','maxConcurrentShells']) {
    if (!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 1000) throw new Error(`Invalid concurrency: ${key}`);
  }
  if (config.localAuth && (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['127.0.0.1', 'localhost', '::1'].includes(config.host))) {
    throw new Error('Lokal admin faqat loopback manzilda ishlaydi. Ommaviy host uchun LOCAL_DEV_AUTH=false va Google OAuth sozlang.');
  }
  if (config.production && (!/^[a-f0-9]{64}$/i.test(config.encryptionKey) || url.protocol !== 'https:')) {
    throw new Error('Production uchun HTTPS APP_URL va 64 hex belgili OPENSI_ENCRYPTION_KEY kerak.');
  }
  return config;
}
