import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fixture, createRun, runState } from './helpers.mjs';
import { guardedLookup, privateAddress } from '../server/security.mjs';
import { responsesInput } from '../server/responses.mjs';

test('connection-time DNS validation rejects rebinding and mapped IPv6', async () => {
  assert.equal(privateAddress('::ffff:7f00:1'),true);
  await new Promise(resolve=>guardedLookup('attacker.example',{all:true},error=>{assert.ok(error);resolve();},async()=>[{address:'127.0.0.1',family:4}]));
  await new Promise(resolve=>guardedLookup('public.example',{all:true},(error,addresses)=>{assert.equal(error,null);assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]);resolve();},async()=>[{address:'8.8.8.8',family:4}]));
});
test('Responses input preserves tool call IDs and user images', () => {
  const result=responsesInput([{role:'user',content:[{type:'text',text:'inspect'},{type:'image_url',image_url:{url:'data:image/png;base64,TEST'}}]},
    {role:'assistant',content:null,tool_calls:[{id:'call-1',function:{name:'read_file',arguments:'{"path":"a.txt"}'}}]},
    {role:'tool',tool_call_id:'call-1',content:'actual result'}]);
  assert.equal(result[0].content[1].type,'input_image'); assert.equal(result[1].call_id,'call-1'); assert.equal(result[2].call_id,'call-1');
});
test('Responses streaming adapter executes actual files and records native token usage', async () => {
  const f=await fixture(); const requests=[];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'qa-model'}]}));return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
    assert.equal(req.url,'/v1/responses');assert.equal(body.store,false);
    const first=!body.input.some(item=>item.type==='function_call_output');
    const args=JSON.stringify({path:'responses.txt',content:'Responses tools work'});
    const call={id:'fc_qa',type:'function_call',call_id:'call_qa',name:'write_file',arguments:args};
    const output=first?[call]:[{id:'msg_qa',type:'message',role:'assistant',content:[{type:'output_text',text:'Responses tayyor.'}]}];
    res.writeHead(200,{'content-type':'text/event-stream'});
    const send=data=>res.write(`event: ${data.type}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`);
    if(first){send({type:'response.output_item.added',item:{...call,arguments:''}});send({type:'response.function_call_arguments.delta',item_id:'fc_qa',delta:args.slice(0,15)});send({type:'response.function_call_arguments.delta',item_id:'fc_qa',delta:args.slice(15)});send({type:'response.output_item.done',item:call});}
    else{send({type:'response.output_text.delta',delta:'Responses '});send({type:'response.output_text.delta',delta:'tayyor.'});}
    send({type:'response.completed',response:{status:'completed',output,usage:{input_tokens:17,output_tokens:13}}});res.end();
  });
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const result=await f.request('/providers',{method:'POST',body:{label:'QA Responses',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,protocol:'responses'}});assert.equal(result.status,200);
    const {run,project}=await createRun(f,result.value,'Responses test');const finished=await runState(f,run.id,'completed');
    assert.equal((await f.request(`/projects/${project.id}/file?path=responses.txt`)).value.content,'Responses tools work');
    assert.deepEqual(finished.usage,{input:34,output:26,unknown:0});assert.equal(requests.length,2);assert.ok(requests[1].input.some(item=>item.type==='function_call_output'&&item.call_id==='call_qa'));
  }finally{await f.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
