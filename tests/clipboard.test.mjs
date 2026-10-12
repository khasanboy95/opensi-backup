import test from 'node:test';
import assert from 'node:assert/strict';
import {clipboardFiles} from '../src/clipboard.ts';

test('screenshot clipboard accepts item-only sources, avoids duplicates, and leaves text untouched',()=>{
 const screenshot=new File([new Uint8Array([137,80,78,71])],'screenshot.png',{type:'image/png'});
 const item={kind:'file',getAsFile:()=>screenshot};
 assert.deepEqual(clipboardFiles({files:[],items:[item]}),[screenshot]);
 assert.deepEqual(clipboardFiles({files:[screenshot],items:[item]}),[screenshot]);
 assert.deepEqual(clipboardFiles({files:[],items:[{kind:'string',getAsFile:()=>null}]}),[]);
 assert.deepEqual(clipboardFiles({files:[],items:[{kind:'file',getAsFile:()=>null}]}),[]);
});
