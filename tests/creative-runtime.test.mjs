import test from 'node:test';
import assert from 'node:assert/strict';
import {teamRoster,teamBriefing} from '../server/orchestration.mjs';
import {youtubeId,playerData,youtubeAnalyze} from '../server/youtube.mjs';
import http from 'node:http';
import {fixture,runState} from './helpers.mjs';

test('automatic runner waits for concurrent specialists and merges their advice into main context with usage',async()=>{
 const f=await fixture();const calls=[],pending=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);calls.push(body);
  const send=text=>{res.writeHead(200,{'content-type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content:text},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2}})}\n\ndata: [DONE]\n\n`);};
  if(body.messages[0].content.includes('read-only OpenSI specialist')){pending.push(()=>send('Advice from '+body.model));if(pending.length===2)pending.forEach(fn=>fn());}
  else send('Team context received.');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const p=await f.request('/providers',{method:'POST',body:{label:'Parallel test',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,models:['qa-sol','qa-pro']}});assert.equal(p.status,200);
 const created=await f.request('/runs',{method:'POST',body:{prompt:'Build Python game architecture: '+ 'Plan the rendering, input, storage and verification components with clear interfaces. '.repeat(5),providerId:'auto',model:'auto',agentId:'developer',environment:'cloud',autonomy:'automatic'}});assert.equal(created.status,201);
 const result=await runState(f,created.value.run.id,'completed');assert.equal(pending.length,2);assert.equal(calls.length,3);
 assert.match(calls[2].messages[0].content,/Advice from qa-sol/);assert.match(calls[2].messages[0].content,/Advice from qa-pro/);
 assert.equal(result.events.filter(e=>e.type==='team_result').length,1);
 assert.equal(f.store.one('SELECT SUM(input_tokens+output_tokens) AS n FROM usage WHERE run_id=?',created.value.run.id).n,15);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await f.close();}
});

test('team chooses distinct enabled specialists and executes consultations concurrently',async()=>{
 const providers=[{id:'a',enabled:true,protocol:'openai',models:['code-sol','qa-pro']},{id:'b',enabled:true,protocol:'openai',models:['other-pro']},{id:'off',enabled:false,models:['off-pro']}];
 const roster=teamRoster(providers,'Python game yarat');assert.equal(roster.length,2);assert.equal(new Set(roster.map(m=>m.providerId)).size,2);assert.equal(teamRoster(providers,'Salom').length,0);
 let started=0;const releases=[];
 const work=teamBriefing(roster,async m=>{started++;await new Promise(r=>releases.push(r));return m.role;});
 assert.equal(started,2);releases.forEach(r=>r());const result=await work;assert.equal(result.length,2);assert.equal(result[0].answer,'build');
 const partial=await teamBriefing(roster,async m=>{if(m.role==='review')throw Error('provider down');return 'plan';});assert.equal(partial[0].answer,'plan');assert.ok(partial[1].error);
});

test('YouTube input validation and balanced player JSON extraction',()=>{
 assert.equal(youtubeId('https://youtu.be/M7lc1UVf-VE'),'M7lc1UVf-VE');
 assert.equal(youtubeId('https://www.youtube.com/shorts/M7lc1UVf-VE'),'M7lc1UVf-VE');
 for(const v of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE','http://youtube.com/watch?v=M7lc1UVf-VE','https://127.0.0.1/watch?v=M7lc1UVf-VE'])assert.throws(()=>youtubeId(v));
 assert.deepEqual(playerData('var ytInitialPlayerResponse = {"videoDetails":{"title":"a } b"}};'),{videoDetails:{title:'a } b'}});
});

test('YouTube analysis keeps transcript evidence and unavailable content explicit',async()=>{
 const fixture={videoDetails:{title:'Verified title',author:'Author',lengthSeconds:'42',shortDescription:'Description'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=M7lc1UVf-VE'}]}}};
 const fetcher=async url=>new Response(url.includes('/oembed')?'{}':url.includes('/api/timedtext')?JSON.stringify({events:[{tStartMs:1000,segs:[{utf8:'Hello world'}]}]}):'var ytInitialPlayerResponse = '+JSON.stringify(fixture)+';');
 const result=await youtubeAnalyze({url:'https://youtu.be/M7lc1UVf-VE'},undefined,fetcher);assert.equal(result.title,'Verified title');assert.deepEqual(result.transcript,[{seconds:1,text:'Hello world'}]);assert.equal(result.durationSeconds,42);
 const missing=await youtubeAnalyze({url:'https://youtu.be/M7lc1UVf-VE'},undefined,async()=>new Response('{}'));assert.equal(missing.transcript.length,0);assert.match(missing.limitations.join(' '),/transkripti olinmadi/);
});
