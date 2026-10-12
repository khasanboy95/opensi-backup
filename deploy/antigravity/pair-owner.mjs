// Operator-only: run in the OpenSI container and pipe stdout directly into the
// cloud connector's private credential file. Stdout is a credential, never log it.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {makeConfig} from './server/config.mjs';
import {createVault} from './server/security.mjs';

const owner=process.argv[2];
if(!/^usr_[a-f0-9]{24}$/.test(owner||''))throw new Error('Explicit owner ID required');
const db=new DatabaseSync('/app/data/opensi.sqlite');
const vault=createVault(makeConfig());
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
const user=db.prepare('SELECT disabled FROM users WHERE id=?').get(owner);
if(!user||user.disabled)throw new Error('Owner unavailable');
const exists=db.prepare("SELECT s.key FROM settings s JOIN nodes n ON s.key='hosted-antigravity:'||n.id WHERE n.user_id=? AND n.revoked=0").get(owner);
if(exists)throw new Error('A cloud node already exists. Reuse its private connector credential or explicitly revoke it first.');
const nodeId='node_'+randomBytes(12).toString('hex'),token=randomBytes(32).toString('base64url');
db.exec('BEGIN IMMEDIATE');
try{
 db.prepare('INSERT INTO nodes(id,user_id,name,platform,workspace,token_hash,last_seen) VALUES(?,?,?,?,?,?,?)').run(nodeId,owner,'Antigravity Bulut','linux','Bulut loyihalari',createHash('sha256').update(token).digest('hex'),'1970-01-01T00:00:00.000Z');
 db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run(`hosted-antigravity:${nodeId}`,vault.encrypt(JSON.stringify({owner})));
 db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error;}
process.stdout.write(JSON.stringify({nodeId,token,server:'https://opensi.23-252-124-21.sslip.io',workspace:'/workspace'}));
