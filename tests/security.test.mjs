import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile, symlink } from 'node:fs/promises';
import { fixture, tempDir, removeTemp } from './helpers.mjs';
import { hash, token, privateAddress, validateUrl, now } from '../server/security.mjs';
import { fileTool, safePath, validFileName } from '../server/files.mjs';

test('vault encrypts and authenticates secrets without plaintext storage', async () => {
  const f = await fixture(); try { const value = 'test-secret-never-output'; const encrypted = f.vault.encrypt(value); assert.notEqual(encrypted,value); assert.equal(f.vault.decrypt(encrypted),value); const corrupted=Buffer.from(encrypted,'base64'); corrupted[30]^=1; assert.throws(()=>f.vault.decrypt(corrupted.toString('base64'))); } finally { await f.close(); }
});
test('path traversal, hidden files, Windows devices and malformed paths are rejected', () => {
  for (const name of ['../outside','.env','a/../b','C:/secret','/tmp/file','a\\b','a/.git/config','a//b','nul.txt','x/CON','foo?bar']) assert.throws(()=>validFileName(name),name);
  assert.equal(validFileName('src/components/App.tsx'),'src/components/App.tsx');
});
test('safePath does not follow a directory junction outside the workspace', async () => {
  const root=await tempDir(); const outside=await tempDir();
  try { await writeFile(path.join(outside,'secret.txt'),'external'); await symlink(outside,path.join(root,'linked'),process.platform==='win32'?'junction':'dir'); await assert.rejects(safePath(root,'linked/secret.txt'),/Symlink/); }
  finally { await removeTemp(root); await removeTemp(outside); }
});
test('actual file tools persist UTF-8 content and enforce size limits', async () => {
  const root=await tempDir(); try { await fileTool(root,'write_file',{path:'src/readme.md',content:'O‘zbekcha matn — sinov'}); assert.equal((await fileTool(root,'read_file',{path:'src/readme.md'})).content,'O‘zbekcha matn — sinov'); assert.equal((await fileTool(root,'list_files',{})).files[0].path,'src/readme.md'); await assert.rejects(fileTool(root,'write_file',{path:'large.txt',content:'a'.repeat(500001)})); } finally { await removeTemp(root); }
});
test('public URL validation blocks private addresses and non-HTTPS services', async () => {
  for (const address of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.1','169.254.169.254','::1','fd00::1','::ffff:127.0.0.1']) assert.equal(privateAddress(address),true,address);
  assert.equal(privateAddress('8.8.8.8'),false);
  await assert.rejects(validateUrl('http://example.com/v1'));
  await assert.rejects(validateUrl('https://127.0.0.1/v1'));
  await assert.rejects(validateUrl('https://user:password@example.com/v1'));
  await assert.rejects(validateUrl('https://example.com/v1?key=private'));
  assert.equal(await validateUrl('http://127.0.0.1:9999/v1',{allowLocal:true}),'http://127.0.0.1:9999/v1');
});
test('development admin cannot be enabled on a public listening interface', async () => {
  await assert.rejects(fixture({host:'0.0.0.0'}),/Lokal admin/);
});

test('a private single-hop reverse proxy keeps independent anonymous client rate limits', async () => {
  const f=await fixture({trustProxy:1,localAuth:false});
  try {
    const a=await f.request('/health',{headers:{'x-forwarded-for':'203.0.113.11'}});
    const b=await f.request('/health',{headers:{'x-forwarded-for':'203.0.113.22'}});
    const again=await f.request('/health',{headers:{'x-forwarded-for':'203.0.113.11'}});
    assert.equal(a.status,200); assert.equal(b.status,200);
    assert.match(a.response.headers.get('ratelimit'),/r=3999/);
    assert.match(b.response.headers.get('ratelimit'),/r=3999/);
    assert.match(again.response.headers.get('ratelimit'),/r=3998/);
  } finally { await f.close(); }
});

test('production never grants an anonymous local admin and defaults to no trusted proxy', async () => {
  const f=await fixture({production:true,localAuth:false,encryptionKey:'ab'.repeat(32),appUrl:'https://opensi.example.com',trustProxy:false});
  try {
    assert.equal(f.app.get('trust proxy fn')('127.0.0.1',0),false);
    assert.equal((await f.request('/health')).status,200);
    assert.equal((await f.request('/me')).status,401);
    assert.equal((await f.request('/admin/overview')).status,401);
    assert.equal((await f.request('/auth/config')).value.localMode,false);
    assert.equal(f.store.one("SELECT count(*) AS n FROM users WHERE id='local-owner'").n,0);
  } finally { await f.close(); }
});
test('CSRF origin and required custom header protect mutating routes', async () => {
  const f=await fixture(); try { const result=await f.request('/nodes/pair-code',{method:'POST',body:{},headers:{origin:'https://attacker.example'}}); assert.equal(result.status,403); const raw=await fetch(f.base+'/api/nodes/pair-code',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}); assert.equal(raw.status,403); } finally { await f.close(); }
});
test('sessions are hashed, expire, and disabled users cannot authenticate', async () => {
  const f=await fixture({localAuth:false}); try {
    f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','test-user','Test user','user',now());
    const session=token(); f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'test-user',Date.now()+60000);
    assert.equal((await f.request('/me')).status,401);
    assert.equal((await f.request('/me',{headers:{cookie:`opensi_session=${session}`}})).value.user.id,'test-user');
    assert.equal((await f.request('/admin/overview',{headers:{cookie:`opensi_session=${session}`}})).status,403);
    f.store.exec('UPDATE users SET disabled=1 WHERE id=?','test-user'); assert.equal((await f.request('/me',{headers:{cookie:`opensi_session=${session}`}})).status,401);
    f.store.exec('UPDATE users SET disabled=0 WHERE id=?','test-user'); f.store.exec('UPDATE sessions SET expires_at=0'); assert.equal((await f.request('/me',{headers:{cookie:`opensi_session=${session}`}})).status,401);
  } finally { await f.close(); }
});
test('an invalid Google callback never creates an authenticated user', async () => {
  const f=await fixture(); try { const response=await fetch(f.base+'/api/auth/google/callback?state=forged&code=forged',{redirect:'manual'}); assert.equal(response.status,302); assert.ok(response.headers.get('location').includes('signin_error')); assert.equal(f.store.one('SELECT count(*) AS n FROM users WHERE google_sub IS NOT NULL').n,0); assert.equal(f.store.one('SELECT count(*) AS n FROM sessions').n,0); } finally { await f.close(); }
});
