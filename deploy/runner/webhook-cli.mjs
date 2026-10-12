import {webhookWorker} from './webhook-runtime.mjs';
import {createInterface} from 'node:readline';
const lines=createInterface({input:process.stdin});const pending=new Map();let start;
const ready=new Promise(resolve=>{start=resolve;});let first=true;
lines.on('line',line=>{if(first){first=false;if(line.length>150000)throw Error('Input too large');start(JSON.parse(line));return;}if(line.length>3000000)return;const value=JSON.parse(line),p=pending.get(value.id);if(p){pending.delete(value.id);value.error?p.reject(Error(value.error)):p.resolve(value.result);}});
let sequence=0;
const remoteFetch=request=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});console.log('OPENSI_HTTP '+JSON.stringify({id,request}));});
const result=await webhookWorker(process.cwd(),await ready,undefined,remoteFetch);
console.log(JSON.stringify(result));lines.close();process.stdin.destroy();process.exitCode=result.exitCode;
