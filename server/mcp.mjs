import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { validateUrl, redact, guardedFetch } from './security.mjs';

export async function connectMcp(connection, config, vault) {
  await validateUrl(connection.url, { allowLocal: config.localAuth });
  const key = vault.decrypt(connection.secret || '');
  const client = new Client({ name: 'opensi', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(connection.url), {
    requestInit: { headers: key ? { Authorization: `Bearer ${key}` } : {}, redirect: 'error' },
    fetch: (input, options) => guardedFetch(input, { ...options, redirect: 'error' }, { allowLocal: config.localAuth }),
  });
  try {
    await client.connect(transport, { timeout: 20_000 });
    const listed = await client.listTools({}, { timeout: 20_000 });
    return { client, tools: listed.tools.slice(0, 24), close: () => client.close() };
  } catch (error) { await client.close().catch(() => {}); throw new Error(`MCP ulanmadi: ${redact(error.message, [key])}`); }
}

export async function mcpTools(store, config, vault, userId) {
  const sessions = [];
  const tools = [];
  const lookup = new Map();
  const warnings = [];
  for (const connection of store.all('SELECT * FROM mcp_connections WHERE enabled=1 AND user_id=?', userId)) {
    try {
      const session = await connectMcp(connection, config, vault); sessions.push(session);
      for (const [index, tool] of session.tools.entries()) {
        const name = `mcp_${connection.id.slice(-8)}_${index}`;
        tools.push({ type: 'function', function: { name,
          description: `${connection.label}: ${String(tool.description || tool.name).slice(0, 500)}. Foydalanuvchi tasdiqlashi kerak.`,
          parameters: tool.inputSchema || { type: 'object', properties: {} } } });
        lookup.set(name, { session, original: tool.name, label: connection.label });
      }
    } catch (error) { warnings.push(error.message); }
  }
  return { tools: tools.slice(0, 32), lookup, warnings, close: async () => { await Promise.allSettled(sessions.map(session => session.close())); } };
}
