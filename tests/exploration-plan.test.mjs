import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationUrl,explorationPlan,internalLinks,explorationEntry,normalizeSiteUrl} from '../server/site-exploration.mjs';
import {observeBrowser,navigatePage} from '../connector/browser-engine.mjs';
test('navigation keeps SPA categories and pagination, strips trackers and excludes mutations',()=>{
 assert.equal(navigationUrl('https://example.com','/#/students/archived'),'https://example.com/#/students/archived');
 assert.equal(navigationUrl('https://example.com','/students?page=2&utm_source=ad'),'https://example.com/students?page=2');
 for(const u of ['/logout','/de%6cete','/data?token=secret','https://evil.test/','/api?action=delete','/#/delete','/setup.exe'])assert.equal(navigationUrl('https://example.com',u),null,u);
 assert.equal(internalLinks('https://example.com',[{url:'/x#title'},{url:'/x#footer'}]).length,1);
});
test('source URL presentation is normalized without changing the host or weakening navigation restrictions',()=>{
 for(const input of [' example.com/catalog ','<https://example.com/catalog>','[Sayt](https://example.com/catalog)','"https://example.com/catalog"','//example.com/catalog','http://example.com/catalog'])assert.equal(normalizeSiteUrl(input),'https://example.com/catalog');
 for(const input of ['', 'example.com bad', 'https://example.com\\@evil.test','file:///secret','javascript:alert(1)','https://user:pass@example.com','https://example.com:8443'])assert.throws(()=>normalizeSiteUrl(input),{code:'SITE_URL_INVALID'});
 assert.deepEqual(explorationEntry('example.com/login'),{url:'https://example.com/login',login:true});
 assert.equal(navigationUrl('https://example.com','/login'),null);
 assert.throws(()=>explorationPlan('https://example.com/login'),{code:'SITE_LOGIN_REQUIRED'});
 for(const input of ['https://example.com/logout','https://example.com/data?token=private','https://example.com/login?token=private','https://example.com/setup.exe'])assert.throws(()=>explorationEntry(input),{code:'SITE_CRAWL_BLOCKED'});
 const plan=explorationPlan('example.com');const root=plan.next();plan.visited.push(root);plan.discover(root,[{url:'/category'},{url:'/authorize'}]);assert.equal(plan.next().url,'https://example.com/category');assert.equal(plan.next(),undefined);
});
test('live viewers reuse a capture frame without competing with its browser operation',async()=>{
 const frame={url:'https://example.com',image:'frame',revision:'r1'},s={capturing:true,cached:frame,activity:{phase:'capturing',frame:2},page:{evaluate(){throw Error('viewer must not inspect an active capture');}}};
 assert.deepEqual(await observeBrowser(s,{live:true}),{...frame,activity:s.activity});
});
test('read-only navigation retries a transient connection once but never retries denied actions',async()=>{
 let calls=0;await navigatePage({goto:async()=>{if(!calls++)throw Error('net::ERR_NAME_NOT_RESOLVED');}},'https://example.com');assert.equal(calls,2);
 calls=0;await assert.rejects(navigatePage({goto:async()=>{calls++;throw Error('net::ERR_ACCESS_DENIED');}},'https://example.com'));assert.equal(calls,1);
 await assert.rejects(navigatePage({goto:async()=>({status:()=>403})},'https://example.com'),{status:424});
 await assert.rejects(navigatePage({goto:async()=>{throw Error('net::ERR_HTTP_RESPONSE_CODE_FAILURE');}},'https://example.com'),{status:424});
});

test('a timed-out blank page fails clearly while already visible content remains usable',async()=>{
 let calls=0;const blank={goto:async()=>{calls++;throw Error('Timeout 15000ms exceeded');},evaluate:async()=>false,waitForFunction:async()=>{throw Error('Timeout');}};
 await assert.rejects(navigatePage(blank,'https://example.com'),{status:424});assert.equal(calls,2);
 calls=0;const visible={goto:async()=>{calls++;throw Error('Timeout 15000ms exceeded');},evaluate:async()=>true};
 await navigatePage(visible,'https://example.com');assert.equal(calls,1);
});
test('exploration discovers nested categories once, bounds depth and preserves unfinished queue',()=>{
 const p=explorationPlan('https://example.com',{maxPages:2,maxDepth:1});const root=p.next();p.visited.push(root);
 p.discover(root,[{url:'/catalog'},{url:'/catalog'},{url:'/news'}]);const category=p.next();assert.equal(category.depth,1);p.visited.push(category);p.discover(category,[{url:'/catalog/details'}]);
 assert.equal(p.next(),null);assert.equal(p.queue[0].url,'https://example.com/news');assert.equal(p.depthLimited,1);assert.equal(p.snapshot().visited,2);
});
