import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { id, now } from './security.mjs';

export function openStore(config, vault) {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(config.dataDir, 'opensi.sqlite'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, google_sub TEXT UNIQUE, email TEXT, name TEXT NOT NULL, picture TEXT,
      role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0,
      token_limit INTEGER NOT NULL DEFAULT 1000000, created_at TEXT NOT NULL, last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chatgpt_accounts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), client_id TEXT NOT NULL, subject TEXT NOT NULL,
      email TEXT, secret TEXT NOT NULL, models TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT, tested_at TEXT,
      UNIQUE(user_id,client_id,subject)
    );
    CREATE TABLE IF NOT EXISTS chatgpt_pending (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT REFERENCES chatgpt_accounts(id),
      nonce TEXT NOT NULL, expires_at INTEGER NOT NULL, phase TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_events (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), method TEXT, status TEXT, created_at TEXT);
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, base_url TEXT NOT NULL, secret TEXT NOT NULL,
      models TEXT NOT NULL, protocol TEXT NOT NULL DEFAULT 'chat-completions', enabled INTEGER NOT NULL DEFAULT 1, verified_at TEXT, tested_at TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mcp_connections (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, secret TEXT NOT NULL,
      tools TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT, user_id TEXT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT NOT NULL, description TEXT NOT NULL,
      prompt TEXT NOT NULL, tools TEXT NOT NULL, provider_id TEXT, model TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), title TEXT NOT NULL,
      environment TEXT NOT NULL, node_id TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT NOT NULL,
      platform TEXT, workspace TEXT, token_hash TEXT UNIQUE, last_seen TEXT, revoked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS pair_codes (hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), project_id TEXT REFERENCES projects(id),
      provider_id TEXT, model TEXT, agent_id TEXT, prompt TEXT, status TEXT NOT NULL,
      environment TEXT, node_id TEXT, error TEXT, created_at TEXT, updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES runs(id), project_id TEXT REFERENCES projects(id),
      role TEXT, content TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT REFERENCES runs(id), type TEXT, data TEXT, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS live_runs (run_id TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS file_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id), path TEXT NOT NULL,
      content TEXT NOT NULL, hash TEXT NOT NULL, run_id TEXT, label TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS versions_project ON file_versions(project_id,path,id);
    CREATE TABLE IF NOT EXISTS browser_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL REFERENCES projects(id), run_id TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY, run_id TEXT REFERENCES runs(id), tool TEXT, args TEXT, status TEXT NOT NULL,
      created_at TEXT, resolved_at TEXT
    );
    CREATE TABLE IF NOT EXISTS commands (
      id TEXT PRIMARY KEY, node_id TEXT REFERENCES nodes(id), project_id TEXT REFERENCES projects(id), run_id TEXT REFERENCES runs(id),
      tool TEXT, args TEXT, status TEXT NOT NULL, result TEXT, created_at TEXT, claimed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS usage (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), run_id TEXT REFERENCES runs(id), provider_id TEXT,
      model TEXT, agent_id TEXT, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
      known INTEGER NOT NULL, created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), name TEXT, mime TEXT, content TEXT, created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS runs_owner ON runs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
    CREATE INDEX IF NOT EXISTS messages_project ON messages(project_id, id);
    CREATE INDEX IF NOT EXISTS usage_owner ON usage(user_id, created_at);
    CREATE INDEX IF NOT EXISTS commands_node ON commands(node_id, status);
  `);
  if (!db.prepare('PRAGMA table_info(providers)').all().some(column => column.name === 'protocol')) db.exec("ALTER TABLE providers ADD COLUMN protocol TEXT NOT NULL DEFAULT 'chat-completions'");
  if (!db.prepare('PRAGMA table_info(mcp_connections)').all().some(column => column.name === 'user_id')) db.exec('ALTER TABLE mcp_connections ADD COLUMN user_id TEXT REFERENCES users(id)');
  if (!db.prepare('PRAGMA table_info(chatgpt_accounts)').all().some(column => column.name === 'shared')) db.exec('ALTER TABLE chatgpt_accounts ADD COLUMN shared INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(commands)').all().some(column => column.name === 'consumed')) db.exec('ALTER TABLE commands ADD COLUMN consumed INTEGER NOT NULL DEFAULT 0');
  if (!db.prepare('PRAGMA table_info(runs)').all().some(column => column.name === 'deleted_at')) db.exec('ALTER TABLE runs ADD COLUMN deleted_at TEXT');
  const store = {
    db,
    one: (sql, ...args) => db.prepare(sql).get(...args),
    all: (sql, ...args) => db.prepare(sql).all(...args),
    exec: (sql, ...args) => db.prepare(sql).run(...args),
    setting(key, fallback = null) {
      const row = this.one('SELECT value FROM settings WHERE key=?', key);
      return row ? JSON.parse(vault.decrypt(row.value)) : fallback;
    },
    setSetting(key, value) {
      this.exec('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, vault.encrypt(JSON.stringify(value)));
    },
    message(run, role, content) {
      this.exec('INSERT INTO messages(run_id,project_id,role,content,created_at) VALUES(?,?,?,?,?)', run.id, run.project_id, role, JSON.stringify(content), now());
    },
    usage(run, provider, model, agentId, usage) {
      const known = Boolean(usage && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens));
      this.exec('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?,?)', id('u_'), run.user_id, run.id, provider.id, model, agentId,
        known ? Math.max(0, Math.trunc(usage.prompt_tokens)) : 0,
        known ? Math.max(0, Math.trunc(usage.completion_tokens)) : 0, known ? 1 : 0, now());
    },
    project(userId, projectId) {
      const row = this.one('SELECT * FROM projects WHERE id=? AND user_id=?', projectId, userId);
      if (!row) return null;
      return row;
    },
    close: () => db.close(),
  };
  if (config.localAuth) store.exec("INSERT OR IGNORE INTO users(id,name,role,created_at) VALUES('local-owner','Lokal workspace','admin',?)", now());
  return store;
}
