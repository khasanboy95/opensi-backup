import { HttpError } from './security.mjs';

const groups = {
  working: ['queued', 'running'],
  waiting: ['waiting_approval', 'waiting_input'],
  completed: ['completed'],
  issues: ['failed', 'interrupted'],
  cancelled: ['cancelled'],
};

const encodeCursor = row => Buffer.from(JSON.stringify([row.created_at, row.id])).toString('base64url');
function decodeCursor(value) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Array.isArray(decoded) && decoded.length === 2 && typeof decoded[0] === 'string' && decoded[0].length <= 40 && /^run_[a-z0-9]+$/i.test(decoded[1])) return decoded;
  } catch { /* Invalid cursors are rejected below. */ }
  throw new HttpError(400, 'Vazifalar sahifasi kursori noto‘g‘ri. Ro‘yxatni yangilang.');
}

export function taskCatalog(store, userId, { category = 'all', q = '', projectId = '', environment = 'all', sort = 'newest', limit = 40, cursor = '' } = {}) {
  const base = ['r.user_id=?', 'r.deleted_at IS NULL'];
  const args = [userId];
  if (projectId) { base.push('r.project_id=?'); args.push(projectId); }
  if (environment !== 'all') { base.push('r.environment=?'); args.push(environment); }
  if (q) {
    base.push("(p.title LIKE ? ESCAPE '\\' OR r.prompt LIKE ? ESCAPE '\\' OR r.model LIKE ? ESCAPE '\\')");
    const term = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    args.push(term, term, term);
  }
  const from = 'FROM runs r JOIN projects p ON p.id=r.project_id';
  const where = base.join(' AND ');
  const counts = { all: 0, working: 0, waiting: 0, completed: 0, issues: 0, cancelled: 0 };
  for (const row of store.all(`SELECT r.status,COUNT(*) AS count ${from} WHERE ${where} GROUP BY r.status`, ...args)) {
    counts.all += row.count;
    for (const [group, statuses] of Object.entries(groups)) if (statuses.includes(row.status)) counts[group] += row.count;
  }
  const predicates = [...base];
  const values = [...args];
  if (category !== 'all') {
    const statuses = groups[category];
    predicates.push(`r.status IN (${statuses.map(() => '?').join(',')})`);
    values.push(...statuses);
  }
  const position = decodeCursor(cursor);
  const ascending = sort === 'oldest';
  if (position) {
    predicates.push(`(r.created_at ${ascending ? '>' : '<'} ? OR (r.created_at=? AND r.id ${ascending ? '>' : '<'} ?))`);
    values.push(position[0], position[0], position[1]);
  }
  const rows = store.all(`SELECT r.*,p.title AS project_title ${from} WHERE ${predicates.join(' AND ')} ORDER BY r.created_at ${ascending ? 'ASC' : 'DESC'},r.id ${ascending ? 'ASC' : 'DESC'} LIMIT ?`, ...values, limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const usage = items.length ? store.all(`SELECT run_id,COALESCE(SUM(input_tokens),0) AS input,COALESCE(SUM(output_tokens),0) AS output,COALESCE(SUM(known=0),0) AS unknown FROM usage WHERE run_id IN (${items.map(() => '?').join(',')}) GROUP BY run_id`, ...items.map(item => item.id)) : [];
  const byRun = new Map(usage.map(item => [item.run_id, { input: item.input, output: item.output, unknown: item.unknown }]));
  return { items: items.map(item => ({ ...item, usage: byRun.get(item.id) || { input: 0, output: 0, unknown: 0 } })), counts, nextCursor: hasMore ? encodeCursor(items.at(-1)) : null };
}
