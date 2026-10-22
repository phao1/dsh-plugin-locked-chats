import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {Window} from 'happy-dom';
import {Credentials} from '../src/credentials.ts';
import {AccessGrants} from '../src/access-grants.ts';
import {HiddenChats} from '../src/hidden-chats.ts';
import {CredentialApi} from '../src/api.ts';

test('native PIN UI auto-verifies once, reveals new PINs, and completes settings recovery using the real API', {timeout:15000},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'dsh-native-settings-'));
  const window=new Window({url:'http://localhost/'});
  const credentials=new Credentials(dir,{attemptsPerWindow:5,initialCooldownMs:60000,maxCooldownMs:900000,recoveryLifetimeMs:300000,maxPendingOperations:64});
  const grants=new AccessGrants({awayTimeoutMs:60000,connectionLeaseMs:60000,maxGrants:64},()=>credentials.status().version);
  const hidden=new HiddenChats(dir);
  const api=new CredentialApi(credentials,grants,{maxRequestBytes:16384,maxWindows:10,windowLifetimeMs:600000},hidden);
  const pending=await credentials.setup('seed','1357');credentials.confirmBackup('seed',pending.operationId,pending.recoveryCode);
  const channels:MessageChannel[]=[];
  class TestChannel extends MessageChannel {constructor(){super();channels.push(this);}}
  const originals=new Map<string,any>();
  for(const [name,value] of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,MessageChannel:TestChannel,fetch:async(input:any,init:any)=>api.fetch(new Request(input,init))})){
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  let root:any;
  t.after(async()=>{if(root)await runtime.act(()=>root.unmount());api.close();grants.close();credentials.close();hidden.close();await window.happyDOM.close();for(const channel of channels){channel.port1.close();channel.port2.close();}for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}rmSync(dir,{recursive:true});});
  const outfile=join(dir,'component.mjs'), pluginRoot=fileURLToPath(new URL('../',import.meta.url));
  await build({stdin:{contents:`export {CredentialSettings} from './client/credential-settings.mjs';export {createElement,act,useState} from 'react';export {PinCells,useAutoVerifyPin} from './client/pin-input.mjs';export {createRoot} from 'react-dom/client';`,resolveDir:pluginRoot},bundle:true,platform:'node',format:'esm',outfile,alias:{react:resolve(pluginRoot,'node_modules/react')},plugins:[{name:'native-primitives-test',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'primitives',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`import {createElement as h,forwardRef} from 'react';export const Button=({variant,...props})=>h('button',props);export const Input=forwardRef((props,ref)=>h('input',{...props,ref}));`,resolveDir:pluginRoot}));}}]});
  const runtime=await import(pathToFileURL(outfile).href);
  const container=window.document.createElement('div');window.document.body.append(container);
  root=runtime.createRoot(container);let changes=0;
  await runtime.act(async()=>root.render(runtime.createElement(runtime.CredentialSettings,{onChanged:async()=>{changes++;}})));
  const click=async(text:string)=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);await runtime.act(async()=>button.click());};
  const submit=async(values:Record<string,string>)=>{
    await runtime.act(async()=>{for(const [name,value]of Object.entries(values)){const field=container.querySelector(`input[name="${name}"]`);assert.ok(field,name);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new window.Event('input',{bubbles:true}));}});
    await runtime.act(async()=>{container.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});
    for(let i=0;i<300 && container.querySelector('button[disabled]');i++)await runtime.act(async()=>{await new Promise(r=>setTimeout(r,10));});
  };
  await click('修改 PIN');await click('查看新 PIN');assert.equal(container.querySelector('input[name=pin]')!.type,'text');assert.equal(container.querySelector('input[name=confirmation]')!.type,'text');assert.equal(container.querySelector('input[name=oldPin]')!.type,'password');await click('隐藏新 PIN');assert.equal(container.querySelector('input[name=pin]')!.type,'password');await submit({oldPin:'1357',pin:'2468',confirmation:'2468'});await credentials.verifyPin('2468');assert.equal(changes,1);
  await click('忘记 PIN');await submit({recoveryCode:pending.recoveryCode});await click('查看新 PIN');assert.equal(container.querySelector('input[name=pin]')!.type,'text');await submit({pin:'9753',confirmation:'9753'});
  const code=(container.querySelector('input[aria-label="新恢复码"]') as any)?.value;assert.ok(code?.startsWith('DSHR1:'));assert.notEqual(code,pending.recoveryCode);
  await credentials.verifyPin('2468');await submit({recoveryCode:code});await credentials.verifyPin('9753');assert.equal(changes,2);
  await click('更换恢复码');await submit({pin:'9753'});await click('取消');assert.ok(credentials.beginRecovery('verify',code));
  const attempts:string[]=[];let edited='unchanged';
  function Probe({pin,enabled=true,reveal=false}:any){runtime.useAutoVerifyPin(pin,enabled,()=>{attempts.push(pin);});return runtime.createElement(runtime.PinCells,{label:'PIN',value:pin,onChange:(value:string)=>{edited=value;},allowReveal:reveal});}
  const render=async(props:any)=>runtime.act(async()=>root.render(runtime.createElement(Probe,props)));
  await render({pin:'123'});assert.equal(attempts.length,0);
  await render({pin:'1234'});assert.deepEqual(attempts,['1234']);
  await render({pin:'1234'});assert.equal(attempts.length,1);
  await render({pin:''});await render({pin:'1234'});assert.equal(attempts.length,2);
  await render({pin:'5678',enabled:false,reveal:true});assert.equal(attempts.length,2);
  await click('查看 PIN');assert.ok([...container.querySelectorAll('input')].every(input=>input.type==='text'));
  await click('隐藏 PIN');assert.ok([...container.querySelectorAll('input')].every(input=>input.type==='password'));
  await render({pin:' 234',enabled:false});await runtime.act(async()=>container.querySelector('input')!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',bubbles:true})));assert.equal(edited,'unchanged');
  await render({pin:'12 4',enabled:false});await runtime.act(async()=>container.querySelectorAll('input')[2]!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',bubbles:true})));assert.equal(edited,'1  4');


});
