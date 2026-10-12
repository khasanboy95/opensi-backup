import type { LiveState, RunDetail, RunEvent } from './types';

const volatile = new Set(['delta', 'live', 'file_delta', 'terminal_delta']);
export function applyRunEvent(current: RunDetail, event: RunEvent): RunDetail {
  if (event.id <= current.cursor) return current;
  const next = { ...current, cursor: event.id, events: volatile.has(event.type) ? current.events : [...current.events, event].slice(-400) };
  if (event.type === 'status') next.run = { ...current.run, status: event.data.status, error: event.data.error, updated_at: event.created_at };
  if (event.type === 'message' && !event.data.depth) {
    next.messages = [...current.messages, { id: `evt_${event.id}`, role: 'assistant', message: event.data.message, created_at: event.created_at, run_id: current.run.id }];
    if (next.live) next.live = { ...next.live, text: '' };
  }
  if(event.type==='parallel_task')next.parallel=[...(current.parallel||[]).filter(t=>t.id!==event.data.task.id),event.data.task].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  if(event.type==='parallel_message')next.messages=[...current.messages,{id:`parallel_${event.data.taskId}`,role:'user',message:{role:'user',content:event.data.prompt},created_at:event.created_at,run_id:current.run.id}];
  if (event.type === 'approval') next.approvals = [...current.approvals.filter(item => item.id !== event.data.id), event.data as RunDetail['approvals'][number]];
  if (event.type === 'approval_resolved') next.approvals = current.approvals.filter(approval => approval.id !== event.data.id);
  if (event.type === 'usage') next.usage = { input: current.usage.input + (event.data.input || 0), output: current.usage.output + (event.data.output || 0), unknown: current.usage.unknown + (event.data.known ? 0 : 1) };
  if (event.type === 'live') {
    const value = event.data as LiveState;
    next.live = { ...value,
      drafts: (value.drafts || []).map(draft => ({ ...draft, content: draft.state === 'saved' || draft.state === 'failed' ? '' : current.live?.drafts.find(item => item.key === draft.key)?.content || '' })),
      terminals: (value.terminals || []).map(terminal => ({ ...terminal, output: current.live?.terminals.find(item => item.callId === terminal.callId)?.output || '' })),
    };
  }
  if (event.type === 'file_delta' && next.live) next.live = { ...next.live, drafts: next.live.drafts.map(draft => draft.key === event.data.key ? { ...draft, content: mergeChunk(draft.content, event.data.offset, event.data.text) } : draft) };
  if (event.type === 'terminal_delta' && next.live) next.live = { ...next.live, terminals: next.live.terminals.map(terminal => terminal.callId === event.data.callId ? { ...terminal, output: mergeChunk(terminal.output, event.data.offset, event.data.text) } : terminal) };
  return next;
}
function mergeChunk(current: string, offset: number, text: string) {
  if (offset === 0) return text;
  if (offset === current.length) return current + text;
  return current; // A polling snapshot repairs any missing chunk without duplicating code.
}

export interface ToolActivity { id: number; tool: string; agent?: string; args: Record<string, any>; result?: Record<string, any>; state: 'running' | 'done' | 'failed' | 'interrupted'; createdAt: string; callId?: string }
export function toolActivities(detail: RunDetail): ToolActivity[] {
  const operations: ToolActivity[] = [];
  for (const event of detail.events) {
    if (event.type === 'tool_start') operations.push({ id: event.id, tool: event.data.tool, agent: event.data.agent, args: event.data.args || {}, state: 'running', createdAt: event.created_at, callId: event.data.callId });
    if (event.type === 'tool_result') {
      const item = [...operations].reverse().find(operation => operation.state === 'running' && (event.data.callId ? operation.callId === event.data.callId : operation.tool === event.data.tool && operation.agent === event.data.agent));
      if (item) { item.result = event.data.result; item.state = event.data.result?.error || event.data.result?.denied || event.data.result?.isError || event.data.result?.passed === false || event.data.result?.timedOut || (typeof event.data.result?.exitCode === 'number' && event.data.result.exitCode !== 0) ? 'failed' : 'done'; }
    }
  }
  if (!['running', 'queued', 'waiting_approval', 'waiting_input'].includes(detail.run.status)) for (const item of operations) if (item.state === 'running') item.state = 'interrupted';
  return operations;
}
