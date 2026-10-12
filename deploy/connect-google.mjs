import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

// Bootstrap the first Google login through the owner's existing SSH access.
// The downloaded OAuth JSON stays on the owner's computer; only the two fields
// required by OpenSI are sent through encrypted SSH stdin to its private env.
const server = '23.252.124.21';
const appUrl = 'https://opensi.23-252-124-21.sslip.io';
const projectId = 'opensi-510805';
const callback = `${appUrl}/api/auth/google/callback`;
if (process.platform !== 'win32' || !process.env.USERPROFILE) throw new Error('Run this on the Windows computer paired with the OpenSI VPS.');

let input = process.argv[2];
if (!input) {
  console.log(`Destination: OpenSI on ${server}. This imports Google login credentials into its private server configuration.`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { input = await prompt.question('Google Clouddan yuklangan OAuth JSON faylining to‘liq manzili: '); }
  finally { prompt.close(); }
}
const file = input.trim().replace(/^"(.*)"$/, '$1');
if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.json') throw new Error('Provide the full path of the Google OAuth JSON file.');
const info = await stat(file);
if (!info.isFile() || info.size > 256 * 1024) throw new Error('The OAuth JSON file is invalid or too large.');
let downloaded;
try { downloaded = JSON.parse(await readFile(file, 'utf8')); }
catch { throw new Error('The OAuth file must contain valid JSON.'); }
const web = downloaded.web;
if (!web || web.project_id !== projectId || !Array.isArray(web.redirect_uris) || !web.redirect_uris.includes(callback)) throw new Error(`Use the OpenSI project's Web application client with redirect URI ${callback}.`);
if (typeof web.client_id !== 'string' || typeof web.client_secret !== 'string' || !/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(web.client_id) || !/^[A-Za-z0-9._~+/=-]{1,1024}$/.test(web.client_secret)) throw new Error('The Google client ID or secret is invalid.');

const remotePython = String.raw`import json,os,re,sys,tempfile
from pathlib import Path
payload=json.load(sys.stdin)
client_id=payload.get('clientId','')
client_secret=payload.get('clientSecret','')
assert re.fullmatch(r'[A-Za-z0-9-]+\.apps\.googleusercontent\.com',client_id),'Invalid client ID'
assert re.fullmatch(r'[A-Za-z0-9._~+/=-]{1,1024}',client_secret),'Invalid client secret'
target=Path('/opt/opensi/.env.production')
assert target.is_file() and not target.is_symlink(),'Server configuration is missing or invalid'
text=target.read_text(encoding='utf-8')
assert re.search(r'^ADMIN_EMAILS=\S+$',text,re.M),'Configure the administrator email first'
assert re.search(r'^APP_URL=https://opensi\.23-252-124-21\.sslip\.io$',text,re.M),'Server application URL does not match this client'
key=re.findall(r'^OPENSI_ENCRYPTION_KEY=([a-f0-9]{64})$',text,re.M)
assert len(key)==1,'Server encryption key is invalid'
for name,value in [('GOOGLE_CLIENT_ID',client_id),('GOOGLE_CLIENT_SECRET',client_secret)]:
 text,count=re.subn(r'^'+name+r'=.*$',lambda match:name+'='+value,text,flags=re.M)
 assert count==1,'Expected exactly one Google configuration field'
assert re.findall(r'^OPENSI_ENCRYPTION_KEY=([a-f0-9]{64})$',text,re.M)==key,'Encryption key must remain unchanged'
fd,temp=tempfile.mkstemp(prefix='.env-google-',dir=target.parent)
try:
 os.fchmod(fd,0o600)
 with os.fdopen(fd,'w',encoding='utf-8') as handle:
  handle.write(text);handle.flush();os.fsync(handle.fileno())
 os.replace(temp,target)
finally:
 if os.path.exists(temp):os.unlink(temp)
print('GOOGLE_OAUTH_CONFIGURED: private server settings updated; encryption key preserved')
`;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const remote = `python3 -c ${quote(remotePython)} && cd /opt/opensi && docker compose --env-file .env.production -p opensi -f compose.yaml -f compose.vps.yaml up -d --no-deps --force-recreate --wait --wait-timeout 120 opensi`;
const ssh = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
const sshDirectory = path.join(process.env.USERPROFILE, '.ssh');
const child = spawn(ssh, ['-p', '22', '-i', path.join(sshDirectory, 'opensi_greencloud_ed25519'), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
  '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${path.join(sshDirectory, 'known_hosts')}`,
  '-o', 'ConnectTimeout=15', `root@${server}`, remote], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let sawConfigured = false;
const redact = chunk => chunk.toString().replaceAll(web.client_secret, '[REDACTED]');
child.stdout.on('data', chunk => { const text = redact(chunk); if (text.includes('GOOGLE_OAUTH_CONFIGURED')) sawConfigured = true; process.stdout.write(text); });
child.stderr.on('data', chunk => process.stderr.write(redact(chunk)));
child.stdin.on('error', () => {});
child.stdin.end(JSON.stringify({ clientId: web.client_id, clientSecret: web.client_secret }));
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
if (code !== 0 || !sawConfigured) throw new Error('Google settings were not confirmed; review the non-secret SSH error above.');
const response = await fetch(`${appUrl}/api/auth/config`, { signal: AbortSignal.timeout(15_000) });
const result = await response.json();
if (!response.ok || !result.configured || result.localMode || result.redirectUri !== callback) throw new Error('The published Google login configuration did not verify.');
console.log(`Google login sozlandi. Hisobingiz bilan kiring: ${appUrl}`);
console.log('Google loginning haqiqiy kirish oqimi hisob egasi tomonidan bajarilishi kerak.');
