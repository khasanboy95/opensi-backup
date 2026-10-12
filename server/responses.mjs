export function responsesInput(messages, chatgpt = false) {
  return messages.flatMap(message => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content }];
    const items = [];
    if (message.content) {
      const content = Array.isArray(message.content) ? message.content.map(part => part.type === 'image_url' ?
        { type: 'input_image', image_url: part.image_url.url } : { type: 'input_text', text: part.text || '' }) : message.content;
      items.push({ role: chatgpt && message.role === 'system' ? 'developer' : message.role, content });
    }
    for (const call of message.tool_calls || []) items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments, ...(chatgpt ? { namespace: 'opensi' } : {}) });
    return items;
  });
}

export function responseAccumulator(onText, onToolCall = () => {}) {
  let content = ''; let usage = null; let finished = false;
  const calls = new Map();
  const callItem = item => {
    const previous = calls.get(item.id) || { id: item.call_id || '', type: 'function', function: { name: item.name || '', arguments: '' } };
    if (item.call_id) previous.id = item.call_id;
    if (item.name) previous.function.name = item.name;
    if (item.namespace) previous.namespace = item.namespace;
    if (typeof item.arguments === 'string') previous.function.arguments = item.arguments;
    calls.set(item.id, previous);
    onToolCall({ ...previous, streamKey: item.id });
  };
  const normalizeUsage = data => data ? { prompt_tokens: data.input_tokens, completion_tokens: data.output_tokens } : null;
  const snapshot = response => {
    usage = normalizeUsage(response.usage) || usage;
    const text = (response.output || []).filter(item => item.type === 'message').flatMap(item => item.content || [])
      .filter(part => part.type === 'output_text').map(part => part.text || '').join('');
    if (text) {
      if (text.startsWith(content)) onText(text.slice(content.length));
      content = text;
    }
    for (const item of response.output || []) if (item.type === 'function_call') callItem(item);
    if (response.status === 'completed') finished = true;
    if (response.status === 'incomplete' || response.status === 'failed') throw new Error(`Responses javobi yakunlanmadi: ${response.error?.code || ''} ${response.incomplete_details?.reason || response.error?.message || response.status}${response.error?.code?.startsWith('subscription_sharing_') ? ' · ChatGPT limitlari: https://chatgpt.com/settings/usage' : ''}`);
  };
  return {
    ingest(data) {
      if (data.type === 'response.output_text.delta') { content += data.delta || ''; onText(data.delta || ''); }
      if (data.type === 'response.output_item.added' || data.type === 'response.output_item.done') {
        if (data.item?.type === 'function_call') callItem(data.item);
      }
      if (data.type === 'response.function_call_arguments.delta') {
        const call = calls.get(data.item_id) || { id: '', type: 'function', function: { name: '', arguments: '' } };
        call.function.arguments += data.delta || '';
        if (call.function.arguments.length > 600_000) throw new Error('Model vosita argumentlari chegarasidan oshdi.');
        calls.set(data.item_id, call);
        onToolCall({ ...call, streamKey: data.item_id });
      }
      if (data.type === 'response.function_call_arguments.done') {
        const call = calls.get(data.item_id);
        if (call) { call.function.arguments = data.arguments; if (data.name) call.function.name = data.name; }
        if (call) onToolCall({ ...call, streamKey: data.item_id });
      }
      if (['response.completed','response.incomplete','response.failed'].includes(data.type)) snapshot(data.response);
      if (!data.type && data.output) snapshot(data);
    },
    value: () => ({ content, calls: [...calls.values()], usage, finished }),
  };
}
