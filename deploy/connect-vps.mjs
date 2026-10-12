import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Run interactively on the owner's computer. The SSH client reads the existing
// root password from its console; this script never receives or stores it.
if (process.platform !== 'win32' || !process.env.USERPROFILE) throw new Error('Run OpenSI-VPS-Ulash.cmd on this Windows computer.');
const sshDirectory = path.join(process.env.USERPROFILE, '.ssh');
const keyFile = path.join(sshDirectory, 'opensi_greencloud_ed25519');
const publicKey = (await readFile(`${keyFile}.pub`, 'utf8')).trim();
if (!/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/.test(publicKey)) throw new Error('The public key must be one valid ssh-ed25519 line.');
const ssh = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh.exe');
// Keep stdin attached to the owner's console so OpenSSH can prompt normally,
// including a provider-required first-login password change. Only the public
// key is placed in the remote command; the password never enters this process.
const quotedPublicKey = "'" + publicKey.replaceAll("'", "'\\''") + "'";
const remote = `set -eu; umask 077; mkdir -p /root/.ssh; touch /root/.ssh/authorized_keys; key=${quotedPublicKey}; if ! grep -Fqx -- "$key" /root/.ssh/authorized_keys; then printf "%s\\n" "$key" >> /root/.ssh/authorized_keys; fi; chmod 700 /root/.ssh; chmod 600 /root/.ssh/authorized_keys; printf "OPENSI_SSH_READY\\n"`;
console.log('Server: 23.252.124.21. Bu kompyuterning OpenSI public keyi root SSH kirishiga qo‘shiladi.');
console.log('So‘ralsa, GreenCloud emailida kelgan mavjud root parolini kiriting. Parol ekranda ko‘rinmaydi va saqlanmaydi.');
const child = spawn(ssh, ['-tt', '-p', '22', '-i', keyFile, '-o', 'IdentitiesOnly=yes', '-o', 'ProxyCommand=none', '-o', 'ProxyJump=none',
  '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${path.join(sshDirectory, 'known_hosts')}`,
  'root@23.252.124.21', remote], { stdio: 'inherit', windowsHide: false });
child.on('error', error => { console.error('SSH ishga tushmadi: ' + error.message); process.exitCode = 1; });
child.on('close', code => {
  process.exitCode = code ?? 1;
  if (code === 0) console.log('SSH ulanishi tayyor. Codex chatiga "tayyor" deb yozing.');
  else console.error('SSH kirishi bajarilmadi. Xato matnini yuboring; parolni yubormang.');
});
