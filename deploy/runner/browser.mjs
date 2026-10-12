import http from 'node:http';
import path from 'node:path';
import { readFile, lstat, realpath, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

// This program runs only inside an isolated job. It cannot reach the app, metadata or internet.
const options = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString());
const workspace = await realpath('/workspace');
let base = workspace;
if (options.directory && options.directory !== '.') {
  if (!/^[a-zA-Z0-9_/-]+$/.test(options.directory) || options.directory.split('/').includes('..')) throw new Error('Invalid directory');
  base = await realpath(path.join(workspace, options.directory));
  if (!base.startsWith(workspace + '/')) throw new Error('Invalid directory');
} else if(options.directory !== '.') { try { if ((await lstat(path.join(workspace, 'dist/index.html'))).isFile()) base = await realpath(path.join(workspace, 'dist')); } catch {} }
if (base !== workspace && !base.startsWith(workspace + '/')) throw new Error('Invalid preview');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml', '.woff2':'font/woff2' };
const server = http.createServer(async (req, res) => {
  if(req.url === '/favicon.ico') {res.writeHead(204);res.end();return;}
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    if (name.split('/').some(part => part.startsWith('.') || part === 'node_modules') || name.includes('\\')) throw new Error();
    const file = await realpath(path.join(base, name));
    if (!file.startsWith(base + '/') || !(await lstat(file)).isFile() || (await lstat(file)).size > 5000000) throw new Error();
    res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox','--disable-dev-shm-usage'] });
const errors = []; const checks = []; const blocked = new Set();
try {
  const page = await browser.newPage({ viewport: options.mobile ? { width:390, height:844 } : { width:1440, height:900 }, serviceWorkers:'block' });
  page.setDefaultTimeout(5000);
  await page.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin + '/')) return route.continue(); blocked.add(new URL(url).origin); return route.abort(); });
  page.on('pageerror', error => errors.push(error.message.slice(0,1000)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0,1000)); });
  await page.goto(origin + '/', { waitUntil:'load', timeout:15000 });
  for (const step of (options.steps || []).slice(0,20)) {
    try {
      const locator = step.text ? page.getByText(step.text, { exact:true }).first() : page.locator(step.selector).first();
      if (step.action === 'click') await locator.click();
      else if (step.action === 'fill') await locator.fill(step.value || '');
      else if (step.action === 'press') await locator.press(step.value || 'Enter');
      else if (step.action === 'visible') { if (!await locator.isVisible()) throw new Error('Element is not visible'); }
      else throw new Error('Unsupported action');
      checks.push({ ...step, passed:true });
    } catch (error) { checks.push({ ...step, passed:false, error:error.message.slice(0,500) }); }
  }
  const report = await page.evaluate(() => ({ title:document.title, width:innerWidth, pageWidth:document.documentElement.scrollWidth, text:document.body.innerText.slice(0,12000) }));
  // Do not follow a project-created symlink when saving evidence.
  const folder = path.join(workspace, 'artifacts'); await mkdir(folder, { recursive:true });
  if ((await lstat(folder)).isSymbolicLink() || await realpath(folder) !== folder) throw new Error('Invalid artifact directory');
  const screenshot = `artifacts/browser-${randomUUID()}.png`;
  await page.screenshot({ path:path.join(workspace,screenshot), fullPage:false });
  console.log(JSON.stringify({ ...report, passed:!errors.length && checks.every(item=>item.passed) && report.pageWidth <= report.width, errors:errors.slice(0,20), checks, blockedOrigins:[...blocked].slice(0,10), screenshot }));
} finally { await browser.close(); server.close(); }
