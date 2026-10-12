import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directories = ['server', 'src', 'public', 'connector', 'deploy'];
const files = ['package.json', 'package-lock.json', 'Dockerfile', '.dockerignore', 'compose.yaml', 'compose.vps.yaml', 'compose.runner.yaml', 'compose.computer.yaml', 'compose.antigravity.yaml',
  '.env.production.example', 'index.html', 'tsconfig.json', 'vite.config.mjs', 'README.md', 'docs/vps-deploy.md', 'docs/google-login.md', 'docs/capabilities.md', 'docs/adaptive-team.md', 'docs/automatic-model-recovery.md', 'docs/native-command-recovery.md', 'docs/publishing.md', 'docs/documents.md', 'docs/automation.md', 'docs/skills.md', 'docs/webhook-testing.md', 'docs/hark-comparison.md', 'docs/creative-runtime.md', 'OpenSI-VPS-Ulash.cmd', 'OpenSI-Google-Ulash.cmd'];
files.push('docs/task-continuation.md');
files.push('docs/parallel-requests.md');
files.push('docs/zcode.md');
files.push('docs/gemini-video.md');
async function collect(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) throw new Error(`Unexpected hidden file: ${directory}/${entry.name}`);
    const relative = `${directory}/${entry.name}`;
    const stat = await lstat(path.join(root, relative));
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not included in a VPS release: ${relative}`);
    if (stat.isDirectory()) await collect(relative);
    else if (stat.isFile()) files.push(relative);
    else throw new Error(`Unsupported release entry: ${relative}`);
  }
}
for (const directory of directories) await collect(directory);
files.sort();
const manifest = [];
for (const file of files) {
  const stat = await lstat(path.join(root, file));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid release file: ${file}`);
  const bytes = await readFile(path.join(root, file));
  if (file.endsWith('.cmd') && /^(?:password\s*:|(?:@?set\s+"?)?(?:root[_-]?)?password\s*=)\s*\S+/im.test(bytes.toString('utf8'))) {
    throw new Error('The VPS connection file contains a password field. Remove it before packaging; enter passwords only in the SSH console.');
  }
  if (file.endsWith('.json')) {
    const json = JSON.parse(bytes.toString('utf8'));
    if (json.web?.client_secret || json.installed?.client_secret) throw new Error(`Google OAuth credential files are not included in a VPS release: ${file}`);
  }
  manifest.push({ path: file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const output = path.join(root, 'releases');
await mkdir(output, { recursive: true });
const base = `opensi-vps-${stamp}`;
const archive = path.join(output, `${base}.tar.gz`);
const result = spawnSync('tar', ['-czf', archive, ...files], { cwd: root, windowsHide: true, encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.error?.message || result.stderr || 'tar failed');
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(path.join(output, `${base}.manifest.json`), JSON.stringify({ createdAt: new Date().toISOString(), sha256: digest, files: manifest }, null, 2) + '\n');
await writeFile(`${archive}.sha256`, `${digest}  ${base}.tar.gz\n`);
console.log(`VPS package: ${archive}`);
console.log(`SHA-256: ${digest}`);
console.log(`${files.length} source files; local database, API keys, SSH keys and node_modules excluded.`);
