import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const dir of ['server','connector','scripts','tests','deploy/computer']) for (const name of readdirSync(dir)) if (name.endsWith('.mjs')) {
  const result = spawnSync(process.execPath, ['--check', `${dir}/${name}`], { stdio: 'inherit', windowsHide: true });
  if (result.status) process.exit(result.status);
}
console.log('JavaScript syntax checked.');
