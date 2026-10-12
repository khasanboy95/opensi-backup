import { HttpError, redact, validateUrl, guardedFetch } from './security.mjs';
import { responsesInput, responseAccumulator } from './responses.mjs';
import { repairToolHistory } from './history.mjs';
import { discoverAnthropicModels, completeAnthropic } from './anthropic.mjs';

function requestError(response,message) {
  const error=new HttpError(502,message);error.providerStatus=response.status;
  const retry=response.headers.get('retry-after');
  if(retry)error.retryAfterMs=/^\d+(?:\.\d+)?$/.test(retry)?Number(retry)*1000:Math.max(0,Date.parse(retry)-Date.now());
  return error;
}

export function providerPayload(protocol, model, messages, tools = []) {
  messages = repairToolHistory(messages);
  const chatgpt = protocol === 'chatgpt-plan';
  const responses = chatgpt || protocol === 'responses';
  const payload = responses ? { model, input: responsesInput(messages, chatgpt), stream: true, store: false } : { model, messages, stream: true, stream_options: { include_usage: true } };
  if (tools.length) {
    const functions = tools.map(tool => ({ type: 'function', ...tool.function, strict: false }));
    payload.tools = chatgpt ? [{ type: 'namespace', name: 'opensi', description: 'OpenSI project files, agent plans, approved terminal commands and connected tools.', tools: functions }] : responses ? functions : tools;
    payload.tool_choice = 'auto';
  }
  return payload;
}

export async function discoverModels(provider, config) {
  if (provider.protocol === 'anthropic-messages') return discoverAnthropicModels(provider, config);
  await validateUrl(provider.base_url, { allowLocal: config.localAuth });
  const response = await guardedFetch(`${provider.base_url}/models`, {
    headers: provider.key ? (provider.protocol==='gemini-image'?{'x-goog-api-key':provider.key}:{ Authorization: `Bearer ${provider.key}` }) : {},
    signal: AbortSignal.timeout(20_000), redirect: 'error',
  }, { allowLocal: config.localAuth });
  if (!response.ok) throw new HttpError(400, `Model ro‘yxati olinmadi (HTTP ${response.status}). API manzili va kalitni tekshiring.`);
  const result = await response.json();
  const models = (provider.protocol==='gemini-image' ? (result.models||[]).filter(m=>/image|banana|^models\/gemini-omni-1\.1-flash$/i.test(m.name)).map(m=>({id:m.name.replace(/^models\//,'')})) : Array.isArray(result.data) ? result.data : []).map(item => item?.id)
    .filter(value => typeof value === 'string' && value.length > 0 && value.length < 200).slice(0, 300);
  if (!models.length) throw new HttpError(400, 'API model ro‘yxatini qaytarmadi. /models endpointini tekshiring.');
  return [...new Set(models)];
}

export async function complete({ provider, model, messages, tools = [], signal, onText = () => {}, onUsage = () => {}, onProgress = () => {}, onToolCall = () => {}, config }) {
  if (provider.complete) return provider.complete({model,messages,tools,signal,onText,onUsage,onProgress,onToolCall,config});
  if (provider.protocol === 'anthropic-messages') return completeAnthropic({provider,model,messages,tools,signal,onText,onUsage,onProgress,onToolCall,config});
  if (provider.getKey) provider = { ...provider, key: await provider.getKey() };
  await validateUrl(provider.base_url, { allowLocal: config.localAuth });
  const headers = { 'Content-Type': 'application/json' };
  if (provider.key) headers.Authorization = `Bearer ${provider.key}`;
  const chatgpt = provider.protocol === 'chatgpt-plan';
  const responses = chatgpt || provider.protocol === 'responses';
  const payload = providerPayload(provider.protocol, model, messages, tools);
  let requestDeadline;
  const timeoutMessage = () => `Model so‘rovi ${Math.round((config.modelTimeout || 1800_000) / 1000)} soniya kutish chegarasiga yetdi. Saqlangan fayllar va mavjud qoralama saqlanadi; vazifani davom ettirish mumkin.`;
  const request = async body => {
    requestDeadline = AbortSignal.timeout(config.modelTimeout || 1800_000);
    return guardedFetch(`${provider.base_url}/${responses ? 'responses' : 'chat/completions'}`, {
    method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
    signal: AbortSignal.any([signal || new AbortController().signal, requestDeadline]),
  }, { allowLocal: config.localAuth }).catch(error => { if (!signal?.aborted && requestDeadline.aborted) throw new Error(timeoutMessage()); throw error; });
  };
  onProgress({ phase: 'requesting', receivedBytes: 0 });
  let response = await request(payload);
  // Some compatible providers reject stream_options. Retry only before any stream/output.
  if (response.status === 400) {
    const detail = await response.text();
    if (!responses && /stream_options|include_usage/i.test(detail)) {
      delete payload.stream_options;
      response = await request(payload);
    } else throw requestError(response, `Model so‘rovi qabul qilinmadi: ${redact(detail, [provider.key])}`);
  }
  if (!response.ok) {
    const detail = await response.text();
    const help = chatgpt ? 'ChatGPT ulanishi va tarif limitlarini tekshiring: https://chatgpt.com/settings/usage' : response.status === 402 ? 'Provider balansini tekshiring.' : response.status === 401 ? 'API kalitini tekshiring.' : '';
    throw requestError(response, `API HTTP ${response.status}. ${help} ${redact(detail, [provider.key])}`);
  }
  let content = ''; const calls = new Map(); let usage = null; let finished = false; let ended = false;
  onProgress({ phase: 'connected' });
  const responseState = responses ? responseAccumulator(onText, onToolCall) : null;
  const ingest = data => {
    if (/reasoning/.test(data.type || '')) onProgress({ phase: 'preparing' });
    if (responseState) { responseState.ingest(data); return; }
    if (data.usage) usage = data.usage;
    const choice = data.choices?.[0];
    if (choice?.finish_reason) finished = true;
    const delta = choice?.delta || choice?.message;
    if (typeof delta?.reasoning_content === 'string') onProgress({ phase: 'preparing' });
    if (typeof delta?.content === 'string') { content += delta.content; onText(delta.content); }
    for (const chunk of delta?.tool_calls || []) {
      const index = chunk.index ?? calls.size;
      const call = calls.get(index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (chunk.id) call.id = chunk.id;
      if (chunk.function?.name) call.function.name += chunk.function.name;
      if (chunk.function?.arguments) call.function.arguments += chunk.function.arguments;
      if (call.function.arguments.length > 600_000) throw new Error('Model vosita argumentlari chegarasidan oshdi.');
      calls.set(index, call);
      onToolCall({ ...call, streamKey: String(index) });
    }
  };
  try {
    if ((response.headers.get('content-type') || '').includes('application/json')) {
      const data = await response.json(); ingest(data); if (!responses) finished = true;
    } else {
      if (!response.body) throw new Error('API oqimi bo‘sh.');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let streamSize = 0;
      const frame = raw => {
        const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) return;
        if (data.trim() === '[DONE]') { if (!responses) finished = true; ended = true; return; }
        const parsed = JSON.parse(data);
        if (parsed.error) throw new Error(`API oqim xatosi: ${redact(JSON.stringify(parsed.error), [provider.key])}`);
        ingest(parsed);
        if (responseState?.value().finished) ended = true;
      };
      while (true) {
        let idleTimer;
        const { value, done } = await Promise.race([reader.read(), new Promise((_, reject) => {
          idleTimer = setTimeout(() => { reject(new Error('API oqimidan yangi ma’lumot kelmadi. Provider javobi kutish chegarasiga yetdi.')); void reader.cancel().catch(() => {}); }, config.modelIdleTimeout || 240_000);
        })]).finally(() => clearTimeout(idleTimer));
        if (done) break;
        streamSize += value.length;
        onProgress({ receivedBytes: streamSize });
        if (streamSize > 4_000_000) { await reader.cancel(); throw new Error('API javobi hajmi chegaradan oshdi.'); }
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
        let boundary;
        while (!ended && (boundary = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
        if (ended) { await reader.cancel(); break; }
      }
      buffer += decoder.decode();
      if (!ended && buffer.trim()) frame(buffer);
    }
    if (responseState) { const state = responseState.value(); content = state.content; usage = state.usage; finished = state.finished; }
    if (!finished) throw new Error('API oqimi yakunlanmasdan uzildi. Natija to‘liq bo‘lmasligi mumkin.');
    const toolCalls = responseState ? responseState.value().calls : [...calls.values()];
    if (!content && !toolCalls.length) throw new Error('Model bo‘sh javob qaytardi.');
    if (toolCalls.some(call => !call.id || !call.function.name)) throw new Error('Model vosita chaqiruvi to‘liq emas.');
    if (chatgpt && toolCalls.some(call => call.namespace && call.namespace !== 'opensi')) throw new Error('Model noma’lum vosita guruhini chaqirdi.');
    provider.markTested?.();
    return { role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
  } catch (error) {
    if (!signal?.aborted && requestDeadline?.aborted) throw new Error(timeoutMessage());
    if (provider.key && error.message?.includes(provider.key)) throw new Error(redact(error.message, [provider.key]));
    throw error;
  } finally { onUsage(responseState ? responseState.value().usage : usage); }
}
