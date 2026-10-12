import { createHash } from 'node:crypto';
import { fileTool, listFiles } from './files.mjs';
import { now } from './security.mjs';

// Bounded local history, independent of model context and provider tokens.
export async function captureVersions(store, root, project, runId = null, label = 'Saqlash') {
  if(store.setting('project-link:'+project.id))return;
  let budget = 5_000_000;
  for (const file of await listFiles(root)) {
    if (file.size > 500000 || file.size > budget) continue;
    let content;
    try { content = (await fileTool(root, 'read_file', { path:file.path })).content; } catch { continue; }
    budget -= file.size;
    const hash = createHash('sha256').update(content).digest('hex');
    const latest = store.one('SELECT hash FROM file_versions WHERE project_id=? AND path=? ORDER BY id DESC LIMIT 1', project.id, file.path);
    if (latest?.hash === hash) continue;
    store.exec('INSERT INTO file_versions(project_id,path,content,hash,run_id,label,created_at) VALUES(?,?,?,?,?,?,?)', project.id, file.path, content, hash, runId, label, now());
    store.exec('DELETE FROM file_versions WHERE project_id=? AND path=? AND id NOT IN (SELECT id FROM file_versions WHERE project_id=? AND path=? ORDER BY id DESC LIMIT 12)', project.id, file.path, project.id, file.path);
  }
  // Retain at most 20 MB of historical text per project. Oldest versions expire first.
  const rows = store.all('SELECT id,length(CAST(content AS BLOB)) AS bytes FROM file_versions WHERE project_id=? ORDER BY id DESC', project.id);
  let bytes = 0;
  for (const row of rows) { bytes += row.bytes; if (bytes > 20_000_000) store.exec('DELETE FROM file_versions WHERE id=?', row.id); }
}

export function lineDiff(before, after) {
  const a = before.split('\n'), b = after.split('\n'); let start = 0; let end = 0;
  while (start < Math.min(a.length,b.length) && a[start] === b[start]) start++;
  while (end < Math.min(a.length,b.length) - start && a[a.length-1-end] === b[b.length-1-end]) end++;
  const from = Math.max(0,start-3);
  const lines = [ ...a.slice(from,start).map(text=>({type:'context',text})),
    ...a.slice(start,a.length-end).map(text=>({type:'removed',text})),
    ...b.slice(start,b.length-end).map(text=>({type:'added',text})),
    ...b.slice(b.length-end,b.length-end+3).map(text=>({type:'context',text})) ];
  return { changed:before !== after, added:b.length-end-start, removed:a.length-end-start, startLine:from+1, lines:lines.slice(0,2000), truncated:lines.length>2000 };
}
