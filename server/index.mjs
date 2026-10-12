import { createApp } from './app.mjs';
const service = createApp();
const server = service.app.listen(service.config.port, service.config.host, () => {
  console.log(`OpenSI API: http://${service.config.host}:${service.config.port}`);
  console.log(`OpenSI workspace: ${service.config.appUrl}`);
  if (service.config.localAuth) console.log('Lokal development hisobi faol. Faqat shu kompyuterdan kirish mumkin.');
});
server.requestTimeout = 30 * 60_000;
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  server.close(); await service.close(); server.closeAllConnections(); process.exit(0);
}
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
