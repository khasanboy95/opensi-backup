import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [spawn(process.execPath, ['--watch', 'server/index.mjs'], { cwd: root, stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '4581', '--strictPort'], { cwd: root, stdio: 'inherit', windowsHide: true })];
const stop = () => { for (const child of children) child.kill(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
for (const child of children) child.on('exit', code => { stop(); process.exitCode = code || 0; });
