import {fixture,mockProvider} from '../tests/helpers.mjs';
import {writeFile} from 'node:fs/promises';
const f=await fixture();f.config.appUrl=f.base;const mock=await mockProvider();const p=(await f.request('/providers',{method:'POST',body:{label:'QA model',baseUrl:mock.base,apiKey:mock.secret,models:['qa-model']}})).value;
await writeFile('.codex-creative-qa.json',JSON.stringify({url:f.base,providerId:p.id}));console.log(f.base);
process.on('SIGINT',async()=>{await mock.close();await f.close();process.exit(0);});
