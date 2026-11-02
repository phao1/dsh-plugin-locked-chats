import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Window} from 'happy-dom';

test('mounted preview updates from user text to settled assistant text without a timestamp change',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-live-preview-')),window=new Window({url:'http://localhost/'});
  const channels:MessageChannel[]=[];class TestChannel extends MessageChannel{constructor(){super();channels.push(this);}}
  const originals=new Map<string,any>();
  for(const[name,value]of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,MessageChannel:TestChannel})){
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  let root:any,runtime:any,loader:any;
  t.after(async()=>{if(root)await runtime.act(()=>root.unmount());loader?.dispose();await window.happyDOM.close();for(const channel of channels){channel.port1.close();channel.port2.close();}for(const[name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}rmSync(dir,{recursive:true});});
  const pluginRoot=fileURLToPath(new URL('../',import.meta.url)),outfile=join(dir,'component.mjs');
  await build({stdin:{contents:`export {TranslationProvider} from './client/localization.mjs';export {createTranslator} from './src/locales.ts';export {ChatPreview,createChatPreviewLoader} from './client/chat-preview.mjs';export {createElement,act} from 'react';export {createRoot} from 'react-dom/client';`,resolveDir:pluginRoot},bundle:true,platform:'node',format:'esm',outfile,alias:{react:resolve(pluginRoot,'node_modules/react')},plugins:[{name:'plain-text-fixture',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'primitives',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`export const extractMarkdownPlainText=text=>text;`}));}}]});
  runtime=await import(pathToFileURL(outfile).href);
  const listeners=new Set<()=>void>();let unlocked=true,retained=0,released=0,language='en',openState='open';
  let catalog:any={byId:{chat:{id:'chat',updatedAt:100,running:true}}};
  let entries:any[]=[{type:'event',event:{type:'user/message',data:{source:{kind:'user'},content:[{type:'text',text:'用户问题'}]}}}];
  const sessions={list:{getSnapshot:()=>catalog,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);}},retain:()=>{retained++;return{ready:Promise.resolve({session:{getSnapshot:()=>({openState})},eventSource:{getSnapshot:()=>({entries})}}),release:()=>{released++;}};}};
  loader=runtime.createChatPreviewLoader(sessions,()=>unlocked,(key:string,values:any)=>runtime.createTranslator(language)(key,values));
  const container=window.document.createElement('div');window.document.body.append(container);root=runtime.createRoot(container);
  await runtime.act(async()=>root.render(runtime.createElement(runtime.ChatPreview,{loader,sessionId:'chat',revision:100,unlocked})));
  assert.equal(container.textContent,'用户问题');assert.equal(retained,1);assert.equal(released,1);
  entries=[...entries,{type:'event',event:{type:'assistant/message',data:{message:{content:[{type:'text',text:'完整助手回复'}]}}}}];
  await runtime.act(async()=>{catalog={byId:{chat:{...catalog.byId.chat,running:false}}};for(const fn of listeners)fn();});
  assert.equal(container.textContent,'完整助手回复');assert.equal(retained,2);assert.equal(released,2);
  await runtime.act(async()=>{catalog={byId:{chat:{...catalog.byId.chat,retainedBy:{controllerOperation:1}}}};for(const fn of listeners)fn();});
  assert.equal(retained,2,'reference publications must not reopen a preview');
  // Placeholders and already displayed errors follow language; user text above stays verbatim.
  const translatedRender=()=>root.render(runtime.createElement(runtime.TranslationProvider,{value:runtime.createTranslator(language)},runtime.createElement(runtime.ChatPreview,{loader,sessionId:'chat',revision:100,unlocked})));
  entries=[];await runtime.act(async()=>{catalog={byId:{chat:{...catalog.byId.chat,updatedAt:101}}};for(const fn of listeners)fn();});
  assert.equal(container.textContent,'No message text yet');
  language='zh';await runtime.act(async()=>translatedRender());assert.equal(container.textContent,'暂无正文');
  openState='error';await runtime.act(async()=>{catalog={byId:{chat:{...catalog.byId.chat,updatedAt:102}}};for(const fn of listeners)fn();});
  assert.equal(container.textContent,'摘要暂不可用');
  language='en';await runtime.act(async()=>translatedRender());assert.equal(container.textContent,'Preview unavailable');
  unlocked=false;loader.clear();await runtime.act(async()=>root.render(runtime.createElement(runtime.ChatPreview,{loader,sessionId:'chat',revision:100,unlocked})));
  assert.equal(container.textContent,'');
});
