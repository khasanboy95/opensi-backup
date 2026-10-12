/** Resolve only references to files already belonging to this workspace. */
export function fileReference(value: string, files: string[]) {
  let text = value.trim();
  try { text = decodeURIComponent(text); } catch { return null; }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;
  const match = text.match(/^(.*?)(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)?$/);
  if (!match) return null;
  const path = match[1].replace(/^\.\//, '').replace(/^\//, '');
  const candidates = files.filter(file => file === path);
  if (!candidates.length && !path.includes('/')) candidates.push(...files.filter(file => file.split('/').at(-1) === path));
  if (candidates.length !== 1) return null;
  return { path: candidates[0], line: Math.max(1, Math.min(1_000_000, Number(match[2] || match[3] || 1))) };
}
