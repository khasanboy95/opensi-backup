import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {packageHost,packageProxy} from '../deploy/runner/package-proxy.mjs';
import {jobArguments,validateJob} from '../deploy/runner/broker.mjs';
import {packageRequest} from '../server/packages.mjs';
import {captionSegments,youtubeAnalyze} from '../server/youtube.mjs';
import {needsApproval} from '../server/execution.mjs';

test('package install is a fixed isolated command and normal jobs retain no network',()=>{
 const job={userId:'usr_'+'a'.repeat(24),projectId:'prj_'+'b'.repeat(24),...packageRequest('python -m pip install humanize==4.11.0 rich')};validateJob(job);
 const args=jobArguments(job,'/workspaces','test','runtime','job-token','install-only');assert.equal(args[args.indexOf('--network')+1],'install-only');assert.ok(args.includes('PYTHONPATH=/workspace/.opensi-python'));assert.ok(args.includes('--read-only'));
 const shell=jobArguments({...job,kind:undefined,command:'python3 test.py'},'/workspaces','test','runtime');assert.equal(shell[shell.indexOf('--network')+1],'none');assert.ok(!shell.some(s=>String(s).includes('OPENSI_PACKAGE_PROXY')));
 for(const command of ['python -m pip install --index-url https://evil.test','python -m pip install x;id','python -m pip install https://x/a.whl','python -m pip install ../local'])assert.equal(packageRequest(command),null);
 assert.throws(()=>validateJob({...job,command:'curl http://internal'}));assert.equal(needsApproval('install_packages',{}, {autonomy:'guided'}),true);assert.equal(needsApproval('install_packages',{}, {autonomy:'automatic'}),false);
});
test('package proxy rejects other destinations and requires ephemeral grant',async()=>{
 assert.equal(packageHost('pypi.org:443'),'pypi.org');for(const h of ['127.0.0.1:443','pypi.org:80','pypi.org.evil:443','files.pythonhosted.org:4590'])assert.throws(()=>packageHost(h));
 const p=packageProxy();await new Promise(r=>p.server.listen(0,'127.0.0.1',r));try{const status=await new Promise((resolve,reject)=>{const q=http.request({host:'127.0.0.1',port:p.server.address().port,method:'CONNECT',path:'pypi.org:443'});q.on('connect',(r,s)=>{s.destroy();resolve(r.statusCode);});q.on('error',reject);q.end();});assert.equal(status,407);}finally{await new Promise(r=>p.server.close(r));}
});
test('captions use XML/VTT fallback with timestamps without fabricating absent speech',async()=>{
 assert.deepEqual(captionSegments('<transcript><text start="1.2">Hello &amp; world</text></transcript>'),[{seconds:1.2,text:'Hello & world'}]);assert.deepEqual(captionSegments('WEBVTT\n\n00:01.200 --> 00:02.500\nHello world\n'),[{seconds:1.2,text:'Hello world'}]);
 const player={videoDetails:{title:'Video'},captions:{playerCaptionsTracklistRenderer:{captionTracks:[{languageCode:'en',baseUrl:'https://www.youtube.com/api/timedtext?v=M7lc1UVf-VE'}]}}};let tries=0;
 const result=await youtubeAnalyze({url:'https://youtu.be/M7lc1UVf-VE'},undefined,async url=>new Response(url.includes('/oembed')?'{}':url.includes('/api/timedtext')?(++tries===1?'':'<transcript><text start="0">Recovered transcript</text></transcript>'):'var ytInitialPlayerResponse = '+JSON.stringify(player)));
 assert.equal(tries,2);assert.equal(result.captionFormat,'srv1');assert.equal(result.transcript[0].text,'Recovered transcript');
});
