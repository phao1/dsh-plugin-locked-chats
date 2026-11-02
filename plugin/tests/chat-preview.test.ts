import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import {createPreviewLoader,latestChatPreview,previewRevision} from '../client/chat-preview-model.mjs';
const user=(text:string)=>({type:'event',event:{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text}]}}});
const assistant=(content:any[])=>({type:'event',event:{type:'assistant/message',data:{message:{content}}}});
function binding(entries:any[],openState='open') {return {session:{getSnapshot:()=>({openState})},eventSource:{getSnapshot:()=>({entries})}};}

test('completion refreshes preview when prompt timestamp is unchanged without reacting to reference counts',()=>{
  const row={updatedAt:100,running:true,retainedBy:{controllerOperation:1}};
  assert.notEqual(previewRevision(row),previewRevision({...row,running:false}));
  assert.equal(previewRevision(row),previewRevision({...row,retainedBy:{controllerOperation:2}}));
  assert.notEqual(previewRevision(row),previewRevision({...row,updatedAt:101}));
  assert.equal(previewRevision(undefined),'missing');
});

test('preview chooses latest readable human/model text and skips tool/thinking/system/transient data',()=>{
  const entries=[user('early human'),assistant([{type:'text',text:' final \n response  '}]),
    {type:'event',event:{type:'tool/result',data:{content:[{type:'text',text:'secret tool output'}]}}},
    {type:'event',event:{type:'user/message',data:{source:{kind:'developer'},content:[{type:'text',text:'developer injection'}]}}},
    assistant([{type:'thinking',text:'private reasoning'}]),
    {type:'transient',event:{type:'assistant/live-chunk',data:{text:'unfinished'}}}];
  assert.equal(latestChatPreview(entries),'final response');
  assert.equal(latestChatPreview([assistant([{type:'text',text:'old'}]),user('latest human')]),'latest human');
});

test('preview bounds source parsing and Unicode output, and handles attachment-only and empty history',()=>{
  let parsed=0;
  const actual=latestChatPreview([user('😀'.repeat(10000))],(text:string)=>{parsed=text.length;return text;});
  assert.ok(parsed<=4096);assert.equal(Array.from(actual).length,120);assert.ok(actual.endsWith('…'));
  assert.equal(latestChatPreview([]),'No message text yet');
  assert.equal(latestChatPreview([assistant([{type:'image'}])]),'Attachments only; no text preview');
  assert.equal(latestChatPreview([user('**hello**')],(text:string)=>text.replaceAll('**','')),'hello');
});

test('preview loader limits native references and releases each without paging or caching',async()=>{
  let active=0,peak=0,released=0,calls=0;
  const gates:Array<()=>void>=[];
  const sessions={retain:(id:string)=>{calls++;active++;peak=Math.max(peak,active);return {ready:new Promise(resolve=>gates.push(()=>resolve(binding([user(id)])))),release:()=>{active--;released++;}};}};
  const loader=createPreviewLoader(sessions,()=>true);
  const requests=['a','b','c','d','e'].map(id=>loader.load(id));
  assert.equal(calls,3);
  gates.shift()!();await new Promise(resolve=>setTimeout(resolve,0));assert.equal(calls,4);
  while(gates.length){gates.shift()!();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.deepEqual(await Promise.all(requests),['a','b','c','d','e']);assert.equal(peak,3);assert.equal(released,5);
  const again=loader.load('a');assert.equal(calls,6);gates.shift()!();assert.equal(await again,'a');loader.dispose();
});

test('revocation clears queued reads, releases active references, and discards late responses after re-unlock',async()=>{
  let unlocked=true,retained=0,released=0;const gates:Array<(value:any)=>void>=[];
  const loader=createPreviewLoader({retain:()=>{retained++;return {ready:new Promise(resolve=>gates.push(resolve)),release:()=>{released++;}};}},()=>unlocked);
  const requests=['a','b','c','d'].map(id=>loader.load(id).then(()=>assert.fail('late content'),(error:any)=>assert.equal(error.name,'AbortError')));
  unlocked=false;loader.clear();await Promise.all(requests);assert.equal(retained,3);assert.equal(released,3);
  unlocked=true;gates.forEach(resolve=>resolve(binding([user('must not leak')])));await Promise.resolve();loader.dispose();
  await assert.rejects(loader.load('x'),{name:'AbortError'});
});

test('aborted row and error history release their own references, and locked state never reads',async()=>{
  let unlocked=false,calls=0,released=0;
  const loader=createPreviewLoader({retain:()=>{calls++;return {ready:Promise.resolve(binding([],'error')),release:()=>{released++;}};}},()=>unlocked);
  await assert.rejects(loader.load('x'),{name:'AbortError'});assert.equal(calls,0);unlocked=true;
  await assert.rejects(loader.load('x'),/Preview unavailable/);assert.equal(released,1);
  const controller=new AbortController();controller.abort();await assert.rejects(loader.load('y',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls,1);loader.dispose();
});
