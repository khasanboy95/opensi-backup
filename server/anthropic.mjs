import { HttpError, guardedFetch, redact, validateUrl } from './security.mjs';
import { repairToolHistory } from './history.mjs';

const version = '2023-06-01';

function headers(key) {
  return { 'anthropic-version': version, 'x-api-key': key, 'Content-Type': 'application/json' };
}

function requestError(response, detail, key) {
  const error = new HttpError(502, `Claude API HTTP ${response.status}. ${redact(detail, [key])}`);
  error.providerStatus = response.status;
  const retry = response.headers.get('retry-after');
  if (retry) error.retryAfterMs = /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
  return error;
}

export async function discoverAnthropicModels(provider, config) {
  await validateUrl(provider.base_url, { allowLocal: config.localAuth });
  if (!provider.key) throw new HttpError(400, 'Claude API kalitini kiriting.');
  const models = [];
  let after = '';
  do {
    const query = new URLSearchParams({ limit: '100' });
    if (after) query.set('after_id', after);
    const response = await guardedFetch(`${provider.base_url}/models?${query}`, {
      headers: headers(provider.key), signal: AbortSignal.timeout(20_000), redirect: 'error',
    }, { allowLocal: config.localAuth });
    if (!response.ok) throw new HttpError(400, `Claude model ro‘yxati olinmadi (HTTP ${response.status}). API kaliti va manzilini tekshiring.`);
    const result = await response.json();
    for (const item of result.data || []) {
      if (typeof item?.id === 'string' && item.id.length < 200 && item.lifecycle !== 'retired' && item.lifecycle !== 'deprecated') models.push(item.id);
    }
    const next = result.has_more && typeof result.last_id === 'string' ? result.last_id : '';
    if (next === after) break;
    after = next;
  } while (after && models.length < 300);
  if (!models.length) throw new HttpError(400, 'Claude API faol model ro‘yxatini qaytarmadi.');
  return [...new Set(models)].slice(0, 300);
}

function contentBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map(part => {
    if (part.type === 'text') return { type: 'text', text: part.text || '' };
    if (part.type === 'image_url') {
      const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url?.url || '');
      if (!match) throw new HttpError(400, 'Claude uchun PNG, JPEG, GIF yoki WebP data URL rasm kerak.');
      return { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } };
    }
    throw new HttpError(400, 'Claude uchun xabar qismi qo‘llab-quvvatlanmaydi.');
  });
}

export function anthropicPayload(model, messages, tools = []) {
  const system = [];
  const output = [];
  for (const message of repairToolHistory(messages)) {
    if (message.role === 'system') { system.push(typeof message.content === 'string' ? message.content : JSON.stringify(message.content)); continue; }
    if (message.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: message.tool_call_id, content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content) };
      const last = output.at(-1);
      if (last?.role === 'user' && last.content.every(part => part.type === 'tool_result')) last.content.push(block);
      else output.push({ role: 'user', content: [block] });
      continue;
    }
    const content = contentBlocks(message.content);
    if (message.role === 'assistant') {
      for (const call of message.tool_calls || []) {
        let input;
        try { input = JSON.parse(call.function.arguments || '{}'); } catch { throw new HttpError(400, 'Saqlangan vosita argumentlari JSON emas.'); }
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input });
      }
    }
    if (content.length) output.push({ role: message.role, content });
  }
  const payload = { model, max_tokens: 16384, messages: output, stream: true };
  if (system.length) payload.system = system.join('\n\n');
  if (tools.length) {
    payload.tools = tools.map(tool => ({ name: tool.function.name, description: tool.function.description || '', input_schema: tool.function.parameters || { type: 'object', properties: {} } }));
    payload.tool_choice = { type: 'auto' };
  }
  return payload;
}

export async function completeAnthropic({ provider, model, messages, tools = [], signal, onText = () => {}, onUsage = () => {}, onProgress = () => {}, onToolCall = () => {}, config }) {
  if (provider.getKey) provider = { ...provider, key: await provider.getKey() };
  await validateUrl(provider.base_url, { allowLocal: config.localAuth });
  if (!provider.key) throw new HttpError(400, 'Claude API kaliti yo‘q.');
  const deadline = AbortSignal.timeout(config.modelTimeout || 1800_000);
  const combined = AbortSignal.any([signal || new AbortController().signal, deadline]);
  const payload = anthropicPayload(model, messages, tools);
  onProgress({ phase: 'requesting', receivedBytes: 0 });
  let usage = { prompt_tokens: null, completion_tokens: null };
  try {
    const response = await guardedFetch(`${provider.base_url}/messages`, {
      method: 'POST', headers: headers(provider.key), body: JSON.stringify(payload), signal: combined, redirect: 'error',
    }, { allowLocal: config.localAuth });
    if (!response.ok) throw requestError(response, await response.text(), provider.key);
    onProgress({ phase: 'connected' });
    let content = '';
    const calls = new Map();
    let stopReason = null;
    let finished = false;
    const ingest = data => {
      if (data.type === 'error' || data.error) throw new Error(`Claude API oqim xatosi: ${redact(JSON.stringify(data.error || data), [provider.key])}`);
      if (data.type === 'message_start') usage.prompt_tokens = data.message?.usage?.input_tokens ?? usage.prompt_tokens;
      if (data.type === 'content_block_start') {
        const block = data.content_block;
        if (block?.type === 'text' && block.text) { content += block.text; onText(block.text); }
        if (block?.type === 'tool_use') calls.set(data.index, { id: block.id, type: 'function', function: { name: block.name, arguments: '' }, initial: block.input || {} });
      }
      if (data.type === 'content_block_delta') {
        if (data.delta?.type === 'text_delta') { content += data.delta.text || ''; onText(data.delta.text || ''); }
        if (data.delta?.type === 'input_json_delta') {
          const call = calls.get(data.index);
          if (!call) throw new Error('Claude vosita oqimi boshlanishsiz keldi.');
          call.function.arguments += data.delta.partial_json || '';
          if (call.function.arguments.length > 600_000) throw new Error('Claude vosita argumentlari chegaradan oshdi.');
          onToolCall({ id: call.id, type: 'function', function: call.function, streamKey: String(data.index) });
        }
      }
      if (data.type === 'content_block_stop' && calls.has(data.index)) {
        const call = calls.get(data.index);
        if (!call.function.arguments) call.function.arguments = JSON.stringify(call.initial);
        JSON.parse(call.function.arguments);
        onToolCall({ id: call.id, type: 'function', function: call.function, streamKey: String(data.index) });
      }
      if (data.type === 'message_delta') {
        stopReason = data.delta?.stop_reason || stopReason;
        usage.completion_tokens = data.usage?.output_tokens ?? usage.completion_tokens;
        usage.prompt_tokens = data.usage?.input_tokens ?? usage.prompt_tokens;
      }
      if (data.type === 'message_stop') finished = true;
    };
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const result = await response.json();
      usage = { prompt_tokens: result.usage?.input_tokens ?? null, completion_tokens: result.usage?.output_tokens ?? null };
      for (const [index, block] of (result.content || []).entries()) {
        ingest({ type: 'content_block_start', index, content_block: block });
        ingest({ type: 'content_block_stop', index });
      }
      stopReason = result.stop_reason;
      finished = true;
    } else {
      if (!response.body) throw new Error('Claude API oqimi bo‘sh.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = ''; let receivedBytes = 0;
      const frame = raw => {
        const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) ingest(JSON.parse(data));
      };
      while (true) {
        let idleTimer;
        const { value, done } = await Promise.race([reader.read(), new Promise((_, reject) => {
          idleTimer = setTimeout(() => { reject(new Error('Claude API oqimi kutish chegarasiga yetdi.')); void reader.cancel().catch(() => {}); }, config.modelIdleTimeout || 240_000);
        })]).finally(() => clearTimeout(idleTimer));
        if (done) break;
        receivedBytes += value.length;
        onProgress({ receivedBytes });
        if (receivedBytes > 4_000_000) { await reader.cancel(); throw new Error('Claude API javobi hajmi chegaradan oshdi.'); }
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
      }
      buffer += decoder.decode();
      if (buffer.trim()) frame(buffer);
    }
    if (!finished || !['end_turn', 'tool_use'].includes(stopReason)) throw new Error(`Claude API javobi to‘liq yakunlanmadi (${stopReason || 'oqim uzildi'}).`);
    const toolCalls = [...calls.values()].map(({ initial, ...call }) => call);
    if (stopReason === 'tool_use' && !toolCalls.length) throw new Error('Claude vosita chaqiruvi bo‘sh.');
    if (!content && !toolCalls.length) throw new Error('Claude bo‘sh javob qaytardi.');
    provider.markTested?.();
    return { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  } catch (error) {
    if (!signal?.aborted && deadline.aborted) throw new Error(`Claude model so‘rovi ${Math.round((config.modelTimeout || 1800_000) / 1000)} soniya kutish chegarasiga yetdi.`);
    if (provider.key && error.message?.includes(provider.key)) throw new Error(redact(error.message, [provider.key]));
    throw error;
  } finally {
    onUsage(Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens) ? usage : null);
  }
}
