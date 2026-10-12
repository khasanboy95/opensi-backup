import test from 'node:test';
import assert from 'node:assert/strict';
import {readableWebPage,xNewsRequirement,observedXPosts} from '../server/web-research.mjs';

test('HTML research keeps exact source links and excludes script or unsafe links',()=>{
  const page=readableWebPage('<script>hidden post</script><a href="/OpenAI/status/12345678901?ref=feed">AI &amp; news</a><a href="javascript:alert(1)">bad</a><p>Article &quot;one&quot;</p>','https://x.com/home');
  assert.equal(page.text.includes('hidden post'),false);
  assert.deepEqual(page.links,[{url:'https://x.com/OpenAI/status/12345678901?ref=feed',title:'AI & news'}]);
  assert.match(page.text,/Article "one"/);
});

test('X-specific news tasks require posts observed in source tools, not project prose',()=>{
  assert.deepEqual(xNewsRequirement('x.com ga kirib 10 ta AI yangiligini ol'),{count:10});
  assert.deepEqual(xNewsRequirement('x.com ga kirib 10 ai yangiligini ol'),{count:10});
  assert.equal(xNewsRequirement('10 ta AI yangilikni rasmiy bloglardan ol'),null);
  const messages=[
    {role:'assistant',tool_calls:[{id:'c1',function:{name:'http_get'}},{id:'c2',function:{name:'write_file'}}]},
    {role:'tool',tool_call_id:'c1',content:JSON.stringify({url:'https://x.com/Fake/status/12345678904',links:[{url:'https://x.com/OpenAI/status/12345678901?ref=a'},{url:'https://x.com/OpenAI/status/12345678901?ref=b'},{url:'https://x.com/GoogleDeepMind/status/12345678902'}]})},
    {role:'tool',tool_call_id:'c2',content:JSON.stringify({content:'https://x.com/Fake/status/12345678903'})},
  ];
  assert.deepEqual(observedXPosts(messages),['https://x.com/OpenAI/status/12345678901','https://x.com/GoogleDeepMind/status/12345678902']);
});
