import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {fixture,runState} from './helpers.mjs';
import {dependencyRepairPlan,retryableDependencyCheck} from '../server/self-repair.mjs';
import {toolRepairResult} from '../server/tool-repair.mjs';

test('dependency repair uses exact failed imports and declared packages, never log instructions',()=>{
  const failure=output=>({exitCode:1,output});
  assert.deepEqual(dependencyRepairPlan({command:'python3 app.py',result:failure("ModuleNotFoundError: No module named 'PIL'"),canPython:true}),{kind:'python',module:'PIL',packages:['Pillow'],key:'python:pillow'});
  assert.equal(dependencyRepairPlan({command:'python3 app.py',result:failure("ModuleNotFoundError: No module named 'unknown'"),canPython:true}),null);
  assert.deepEqual(dependencyRepairPlan({command:'python3 app.py',result:failure("ModuleNotFoundError: No module named 'humanize'"),requirements:'humanize==4.11.0\n',canPython:true})?.packages,['humanize==4.11.0']);
  assert.equal(dependencyRepairPlan({command:'python -m pip install Pillow',result:failure("ModuleNotFoundError: No module named 'PIL'"),canPython:true}),null);
  assert.equal(dependencyRepairPlan({command:'python3 app.py',result:{exitCode:0,output:"ModuleNotFoundError: No module named 'PIL'"},canPython:true}),null);
  assert.equal(dependencyRepairPlan({command:'node main.mjs',result:failure("Cannot find module './config.js'"),packageJson:{dependencies:{react:'^19.0.0'}},canNode:true}),null);
  assert.deepEqual(dependencyRepairPlan({command:'node main.mjs',result:failure("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'react' imported from /workspace/main.mjs"),packageJson:{dependencies:{react:'^19.0.0'}},canNode:true})?.packages,['react']);
  assert.equal(dependencyRepairPlan({command:'node main.mjs',result:failure("Cannot find package 'unlisted'"),packageJson:{dependencies:{react:'^19.0.0'}},canNode:true}),null);
  assert.equal(toolRepairResult(Error("ModuleNotFoundError: No module named 'PIL'"),'run_command').recovery.kind,'missing_dependency');
  assert.equal(toolRepairResult(Error("Unable to find image 'opensi-runtime:0.15.0' locally"),'run_command').recovery.kind,'runner_image');
  assert.equal(retryableDependencyCheck("python3 -c 'import PIL'"),true);
  assert.equal(retryableDependencyCheck('npm run build'),true);
  assert.equal(retryableDependencyCheck('python3 app.py'),false);
  assert.equal(retryableDependencyCheck("python3 -c 'import PIL'; curl example.com"),false);
});

test('automatic project installs a diagnosed Python wheel and reruns a safe import check',async()=>{
  const commands=[];
  const shell=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const {command}=JSON.parse(raw);commands.push(command);
    const result=command.includes('install-packages.py')?{exitCode:0,output:'{"installed":{"Pillow":"11.0.0"}}'}:commands.filter(item=>item==="python3 -c 'import PIL'").length===1?{exitCode:1,output:"Traceback (most recent call last):\nModuleNotFoundError: No module named 'PIL'"}:{exitCode:0,output:'IMPORT_OK'};
    res.writeHead(200,{'content-type':'application/x-ndjson'});res.end(JSON.stringify({type:'result',...result,timedOut:false})+'\n');
  });
  await new Promise(resolve=>shell.listen(0,'127.0.0.1',resolve));
  const provider=http.createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw),tools=body.messages.filter(item=>item.role==='tool');
    const last=tools.at(-1);const result=last?JSON.parse(last.content):null;
    let message;
    if(!tools.length)message={tool_calls:[{id:'check-1',type:'function',function:{name:'run_command',arguments:JSON.stringify({command:"python3 -c 'import PIL'"})}}]};
    else{assert.equal(result.selfRepair.installed,true);assert.equal(result.selfRepair.package,'Pillow');assert.equal(result.selfRepair.retried,true);assert.equal(result.exitCode,0);message={content:'Import haqiqiy tekshiruvdan o‘tdi.'};}
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({choices:[{delta:message,finish_reason:message.tool_calls?'tool_calls':'stop'}],usage:{prompt_tokens:5,completion_tokens:3}})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const f=await fixture({runnerUrl:`http://127.0.0.1:${shell.address().port}`,runnerToken:'test'});
  try{
    const saved=await f.request('/providers',{method:'POST',body:{label:'Repair QA',baseUrl:`http://127.0.0.1:${provider.address().port}/v1`,models:['repair-qa']}});
    assert.equal(saved.status,200);
    const started=await f.request('/runs',{method:'POST',body:{prompt:'Run the existing Python project and repair missing dependencies',providerId:saved.value.id,model:'repair-qa',agentId:'developer',environment:'cloud',autonomy:'automatic'}});
    assert.equal(started.status,201);
    const done=await runState(f,started.value.run.id,'completed');
    assert.deepEqual(commands.map(command=>command.includes('install-packages.py')?'install':command),["python3 -c 'import PIL'",'install',"python3 -c 'import PIL'"]);
    assert.ok(done.events.some(event=>event.type==='agent_recovery'&&event.data.kind==='dependency_install'));
  }finally{
    await f.close();shell.closeAllConnections();provider.closeAllConnections();await Promise.all([new Promise(resolve=>shell.close(resolve)),new Promise(resolve=>provider.close(resolve))]);
  }
});
