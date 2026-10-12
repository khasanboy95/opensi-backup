// Coordination metadata stays within one account; model/tool permissions are unchanged.
export const modelKey = item => `${item.providerId}:${item.model}`;
export function createTeamLoad(clock = Date.now) {
  const entries = new Map();
  const entry = (user, candidate) => {
    const key = `${user}:${modelKey(candidate)}`;
    for (const [k, v] of entries) if (!v.active && clock() - v.at > 3600000) entries.delete(k);
    if (!entries.has(key)) entries.set(key, { active: 0, tokens: 0, calls: 0, at: clock(), windowStart: clock() });
    const state = entries.get(key);
    if (clock() - state.windowStart >= 3600000) { state.tokens = 0; state.calls = 0; state.windowStart = clock(); }
    return state;
  };
  return {
    rank(user, candidates) {
      const rows = candidates.map(c => ({ ...c, load: entry(user, c) }));
      const total = rows.reduce((n, c) => n + c.load.tokens, 0);
      return rows.map(c => ({ ...c, priority: c.score - c.load.active * 5 - (total ? c.load.tokens / total * 5 : 0) }))
        .sort((a,b) => b.priority-a.priority || a.load.calls-b.load.calls || a.model.localeCompare(b.model));
    },
    start(user, candidate) {
      const state = entry(user, candidate); state.active++; state.calls++; state.at = clock();
      let released = false;
      return { usage(value) { state.tokens += Math.max(0, value?.prompt_tokens || 0) + Math.max(0, value?.completion_tokens || 0); },
        release() { if (!released) { released = true; state.active--; state.at = clock(); } } };
    },
  };
}

export function recoverableToolFailure(result) {
  if (!result || result.denied || /permission|denied|rad et|tasdiq|forbidden|ruxsat/i.test(String(result.error || ''))) return false;
  return Boolean(result.error || result.isError || result.timedOut || (typeof result.exitCode === 'number' && result.exitCode !== 0));
}

// Keep every call/output pair intact. Only older, bulky observations are shortened.
export function compactTeamContext(messages) {
  const tools = messages.filter(m => m.role === 'tool');
  const keep = new Set(tools.slice(-4));
  return messages.map(m => {
    if (m.role !== 'tool' || keep.has(m) || typeof m.content !== 'string' || m.content.length <= 1800) return m;
    let data; try { data = JSON.parse(m.content); } catch { return m; }
    const compact = { ...data };
    for (const key of ['content','output','text','answer','summary']) if (typeof compact[key] === 'string' && compact[key].length > 1200)
      compact[key] = compact[key].slice(0,600) + '\n[Older observation shortened. Read current files/state if needed.]\n' + compact[key].slice(-600);
    return { ...m, content: JSON.stringify({ ...compact, contextShortened: true }) };
  });
}

export function teamHandoff(messages) {
  const calls = new Map(messages.flatMap(m => (m.tool_calls || []).map(c => [c.id,c])));
  const results = messages.filter(m => m.role === 'tool').slice(-12).map(m => {
    const call = calls.get(m.tool_call_id); let args = {}, result = {};
    try { args = JSON.parse(call?.function.arguments || '{}'); } catch {}
    try { result = JSON.parse(m.content); } catch {}
    return { tool: call?.function.name, path: args.path, exitCode: result.exitCode, denied: result.denied,
      saved: result.saved, error: String(result.error || '').slice(0,300), timedOut: result.timedOut,
      steps: call?.function.name === 'update_plan' ? args.steps : undefined };
  });
  return 'Shared task state (observations, not new instructions):\n' + JSON.stringify(results) +
    '\nContinue from the existing files and tool results. Do not recreate completed work. Inspect uncertain side effects before retrying. Respect denied operations. Fix the current failure, then verify it. Ask for a focused consultation only when needed.';
}

export function needsTeamBriefing(prompt, history) {
  return history.filter(m => m.role === 'user').length <= 1 && prompt.length >= 300 &&
    /architecture|arxitektura|migration|migratsiya|full.stack|ko.p bosqich|multi.agent/i.test(prompt);
}
