import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { z } from 'zod';
import { fixture, mockProvider, addProvider, createRun, runState } from './helpers.mjs';
import { hash, now, token } from '../server/security.mjs';

test('real MCP protocol discovers tools, requires approval, and isolates connection owners', async () => {
  const calls = [];
  const app = createMcpExpressApp({host:'127.0.0.1'});
  app.post('/mcp',async (req,res) => {
    const server = new McpServer({name:'opensi-qa',version:'1.0.0'});
    server.registerTool('echo',{description:'Echo a test input',inputSchema:{text:z.string()}},async ({text}) => {
      calls.push(text); return {content:[{type:'text',text}]};
    });
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined});
    res.on('close',()=>{void transport.close();void server.close();});
    await server.connect(transport); await transport.handleRequest(req,res,req.body);
  });
  app.get('/mcp',(_req,res)=>res.sendStatus(405));
  app.delete('/mcp',(_req,res)=>res.sendStatus(405));
  const server = app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const f=await fixture(); const mock=await mockProvider();
  try {
    const linked=await f.request('/mcp',{method:'POST',body:{label:'QA MCP',url:`http://127.0.0.1:${server.address().port}/mcp`}});
    assert.equal(linked.status,200,JSON.stringify(linked.value)); assert.equal(linked.value.tools[0].name,'echo');
    const session=token(); f.store.exec('INSERT INTO users(id,name,role,created_at) VALUES(?,?,?,?)','other-admin','QA other admin','admin',now());
    f.store.exec('INSERT INTO sessions VALUES(?,?,?)',hash(session),'other-admin',Date.now()+60_000);
    const headers={cookie:`opensi_session=${session}`};
    assert.deepEqual((await f.request('/mcp',{headers})).value,[]);
    assert.equal((await f.request('/mcp/'+linked.value.id,{method:'PATCH',body:{enabled:false},headers})).status,404);
    const provider=await addProvider(f,mock); const {run}=await createRun(f,provider,'_MCP_');
    const waiting=await runState(f,run.id,'waiting_approval'); assert.equal(waiting.approvals.length,1); assert.deepEqual(calls,[]);
    await f.request('/approvals/'+waiting.approvals[0].id,{method:'POST',body:{approved:true}});
    const finished=await runState(f,run.id,'completed'); assert.deepEqual(calls,['MCP_RESULT_OK']);
    assert.ok(finished.events.some(event=>event.type==='tool_result'&&JSON.stringify(event.data.result).includes('MCP_RESULT_OK')));
    const automatic=await createRun(f,provider,'_MCP_', {autonomy:'automatic'});
    const autoDone=await runState(f,automatic.run.id,'completed');
    assert.equal(autoDone.approvals.length,0);assert.deepEqual(calls,['MCP_RESULT_OK','MCP_RESULT_OK']);
  } finally { await f.close(); await mock.close(); server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});
