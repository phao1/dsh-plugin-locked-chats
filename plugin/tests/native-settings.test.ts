import {createTranslator} from '../src/locales.ts';
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

for(const language of ['en','zh']) test(`native PIN UI auto-verification and real API recovery (${language})`, {timeout:15000},async t=>{
  const tr=createTranslator(language);
  t.mock.timers.enable({apis:['Date'],now:1_800_000_000_000});
  const dir=mkdtempSync(join(tmpdir(),'dsh-native-settings-'));
  const window=new Window({url:'http://localhost/'});
  const credentials=new Credentials(dir,{attemptsPerWindow:5,initialCooldownMs:60000,maxCooldownMs:900000,recoveryLifetimeMs:300000,maxPendingOperations:64});
  const grants=new AccessGrants({awayTimeoutMs:60000,connectionLeaseMs:60000,maxGrants:64},()=>credentials.status().version);
  const hidden=new HiddenChats(dir);
  const api=new CredentialApi(credentials,grants,{maxRequestBytes:16384,maxWindows:10,windowLifetimeMs:600000},hidden);
  const pending=await credentials.setup('seed','1357');credentials.confirmBackup('seed',pending.operationId,pending.recoveryCode);
  const channels:MessageChannel[]=[];
  class TestChannel extends MessageChannel {constructor(){super();channels.push(this);}}
  const requests:string[]=[];
  const originals=new Map<string,any>();
  for(const [name,value] of Object.entries({window,document:window.document,navigator:window.navigator,HTMLElement:window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,MessageChannel:TestChannel,fetch:async(input:any,init:any)=>{requests.push(JSON.parse(init.body).action);return api.fetch(new Request(input,init));}})){
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
  }
  let root:any;
  t.after(async()=>{if(root)await runtime.act(()=>root.unmount());api.close();grants.close();credentials.close();hidden.close();await window.happyDOM.close();for(const channel of channels){channel.port1.close();channel.port2.close();}for(const [name,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name);}rmSync(dir,{recursive:true});});
  const outfile=join(dir,'component.mjs'), pluginRoot=fileURLToPath(new URL('../',import.meta.url));
  await build({stdin:{contents:`export {installLocalization} from './client/localization.mjs';export {WorkspaceLockControl,WorkspaceUnlockControl} from './client/vault-controls.mjs';export {CredentialSettings} from './client/credential-settings.mjs';export {createElement,act,useState} from 'react';export {PinCells,useAutoVerifyPin} from './client/pin-input.mjs';export {createRoot} from 'react-dom/client';`,resolveDir:pluginRoot},bundle:true,platform:'node',format:'esm',outfile,alias:{react:resolve(pluginRoot,'node_modules/react')},plugins:[{name:'native-primitives-test',setup(b){b.onResolve({filter:/^@deepseek-ai\/dsh-client-ui-primitives$/},()=>({path:'primitives',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:`import {createElement as h,forwardRef} from 'react';export const Modal=({open,title,description,children,footer})=>open?h('section',{role:'dialog'},h('h2',null,title),h('p',null,description),children,footer):null;export const IconFolderCloseRegular=()=>null;export const IconChevronDownOutlineRegular=()=>null;export const Button=({variant,...props})=>h('button',props);export const Input=forwardRef((props,ref)=>h('input',{...props,ref}));`,resolveDir:pluginRoot}));}}]});
  const runtime=await import(pathToFileURL(outfile).href);
  const container=window.document.createElement('div');window.document.body.append(container);
  root=runtime.createRoot(container);let changes=0;
  let snapshot={active:language,revision:0};const listeners=new Set<()=>void>();
  const dictionaries:any={};const effects:Function[]=[];
  const locale={
    register:(_ns:string,dicts:any)=>{Object.assign(dictionaries,dicts);return()=>{for(const key of Object.keys(dicts))delete dictionaries[key];};},
    bind:()=> (key:string,values:any)=>createTranslator(snapshot.active)(key,values),
    subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn);},getSnapshot:()=>snapshot,
  };
  const localized=runtime.installLocalization({locale,effect:(fn:Function)=>effects.push(fn())});
  const Settings=localized.wrap(runtime.CredentialSettings);
  const switchLanguage=async(active:string)=>runtime.act(async()=>{snapshot={active,revision:snapshot.revision+1};for(const fn of listeners)fn();});
  t.after(()=>{for(const dispose of effects)dispose();});
  await runtime.act(async()=>root.render(runtime.createElement(Settings,{onChanged:async()=>{changes++;}})));
  const click=async(text:string)=>{const button=[...container.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(button,text);await runtime.act(async()=>button.click());};
  const submit=async(values:Record<string,string>)=>{
    await runtime.act(async()=>{for(const [name,value]of Object.entries(values)){const field=container.querySelector(`input[name="${name}"]`);assert.ok(field,name);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(field,value);field.dispatchEvent(new window.Event('input',{bubbles:true}));}});
    await runtime.act(async()=>{container.querySelector('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));});
    for(let i=0;i<300 && container.querySelector('button[disabled]');i++)await runtime.act(async()=>{await new Promise(r=>setTimeout(r,10));});
  };
  await click(tr('changePin'));await click(tr('showNewPin'));assert.equal(container.querySelector('input[name=pin]')!.type,'text');assert.equal(container.querySelector('input[name=confirmation]')!.type,'text');assert.equal(container.querySelector('input[name=oldPin]')!.type,'password');await click(tr('hideNewPin'));assert.equal(container.querySelector('input[name=pin]')!.type,'password');await submit({oldPin:'1357',pin:'2468',confirmation:'2468'});await credentials.verifyPin('2468');assert.equal(changes,1);
  await click(tr('forgotPin'));await submit({recoveryCode:pending.recoveryCode});await click(tr('showNewPin'));assert.equal(container.querySelector('input[name=pin]')!.type,'text');await submit({pin:'9753',confirmation:'9753'});
  const code=(container.querySelector(`input[aria-label="${tr('newRecovery')}"]`) as any)?.value;assert.ok(code?.startsWith('DSHR1:'));assert.notEqual(code,pending.recoveryCode);
  await credentials.verifyPin('2468');await submit({recoveryCode:code});await credentials.verifyPin('9753');assert.equal(changes,2);
  await click(tr('rotateRecovery'));await submit({pin:'9753'});await click(tr('cancel'));assert.ok(credentials.beginRecovery('verify',code));
  // Leave a backup form open past its window lifetime, then start again without reloading.
  await click(tr('rotateRecovery'));await submit({pin:'9753'});
  const abandoned=(container.querySelector(`input[aria-label="${tr('newRecovery')}"]`) as any).value;
  t.mock.timers.tick(600_001);api.sweep();
  await submit({recoveryCode:abandoned});
  assert.ok(container.textContent.includes(tr('error.wrong_connection')));
  assert.equal(container.querySelector(`input[aria-label="${tr('newRecovery')}"]`),null);
  assert.ok(credentials.beginRecovery('check-old-backup',code));
  await click(tr('changePin'));await submit({oldPin:'9753',pin:'8642',confirmation:'8642'});
  await credentials.verifyPin('8642');assert.equal(changes,3);
  // Fresh verification transparently opens a replacement window after another idle period.
  t.mock.timers.tick(600_001);api.sweep();
  await click(tr('changePin'));await submit({oldPin:'8642',pin:'9753',confirmation:'9753'});
  await credentials.verifyPin('9753');assert.equal(changes,4);
  // Switching the native source preserves the open form and its entered values.
  await click(tr('changePin'));
  await runtime.act(async()=>{const field=container.querySelector('input[name=pin]')!;Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')!.set!.call(field,'1234');field.dispatchEvent(new window.Event('input',{bubbles:true}));});
  const fieldBefore=container.querySelector('input[name=pin]');
  const other=language==='en'?'zh':'en';await switchLanguage(other);
  assert.equal(container.querySelector('input[name=pin]'),fieldBefore);assert.equal(fieldBefore!.value,'1234');
  assert.ok(container.textContent.includes(createTranslator(other)('newPin')));assert.equal(changes,4);
  await switchLanguage(language);
  await submit({oldPin:'0000',pin:'1234',confirmation:'1234'});
  assert.ok(container.textContent.includes(tr('error.invalid_pin')));
  const requestCount=requests.length;
  await switchLanguage(other);
  assert.ok(container.textContent.includes(createTranslator(other)('error.invalid_pin')));
  assert.equal(requests.length,requestCount,'a locale switch cannot replay verification');
  await switchLanguage(language);await click(tr('cancel'));
  await click(tr('rotateRecovery'));await submit({pin:'9753'});
  const backupField=container.querySelector(`input[aria-label="${tr('newRecovery')}"]`)!;
  const backupValue=backupField.value,backupRequests=requests.length;
  await switchLanguage(other);
  assert.equal(container.querySelector(`input[aria-label="${createTranslator(other)('newRecovery')}"]`),backupField);
  assert.equal(backupField.value,backupValue);assert.equal(requests.length,backupRequests);
  await switchLanguage(language);await click(tr('cancel'));
  const attempts:string[]=[];let edited='unchanged';
  function Probe({pin,enabled=true,reveal=false}:any){runtime.useAutoVerifyPin(pin,enabled,()=>{attempts.push(pin);});return runtime.createElement(runtime.PinCells,{label:'PIN',value:pin,onChange:(value:string)=>{edited=value;},allowReveal:reveal});}
  const render=async(props:any)=>runtime.act(async()=>root.render(runtime.createElement(localized.Localized,null,runtime.createElement(Probe,props))));
  await render({pin:'123'});assert.equal(attempts.length,0);
  await render({pin:'1234'});assert.deepEqual(attempts,['1234']);
  await render({pin:'1234'});assert.equal(attempts.length,1);
  await render({pin:''});await render({pin:'1234'});assert.equal(attempts.length,2);
  await render({pin:'5678',enabled:false,reveal:true});assert.equal(attempts.length,2);
  await click(tr('showPin'));assert.ok([...container.querySelectorAll('input')].every(input=>input.type==='text'));
  await click(tr('hidePin'));assert.ok([...container.querySelectorAll('input')].every(input=>input.type==='password'));
  await render({pin:' 234',enabled:false});await runtime.act(async()=>container.querySelector('input')!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',bubbles:true})));assert.equal(edited,'unchanged');
  await render({pin:'12 4',enabled:false});await runtime.act(async()=>container.querySelectorAll('input')[2]!.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Backspace',bubbles:true})));assert.equal(edited,'1  4');
  const title='<img src=x onerror=alert(1)> {count} $&';let locked='';
  const controlClient={setWorkspaceHidden:async(id:string,hidden:boolean)=>{locked=id+':'+hidden;}};
  await runtime.act(async()=>root.render(runtime.createElement(localized.Localized,null,runtime.createElement(runtime.WorkspaceLockControl,{client:controlClient,workspaces:[{workspaceId:'w',title}],lockedIds:[],onLocked:async()=>{},renderPicker:({onPick}:any)=>runtime.createElement('button',{onClick:()=>onPick('w')},'pick')}))));
  await click(tr('lockWorkspace'));await click('pick');
  assert.ok(container.textContent.includes(tr('lockWorkspaceDescription')));assert.equal(container.querySelector('img'),null);
  const confirm=[...container.querySelectorAll('button')].filter(b=>b.textContent===tr('lockWorkspace')).at(-1)!;
  await runtime.act(async()=>confirm.click());assert.equal(locked,'w:true');
  await runtime.act(async()=>root.render(runtime.createElement(localized.Localized,null,runtime.createElement(runtime.WorkspaceUnlockControl,{client:controlClient,workspaceId:'w',title}))));
  await click(tr('unlockWorkspace'));assert.ok(container.textContent.includes(tr('unlockWorkspaceDescription',{title})));assert.equal(container.querySelector('img'),null);
  await click(tr('cancel'));assert.equal(locked,'w:true');
  await click(tr('unlockWorkspace'));
  const remove=[...container.querySelectorAll('button')].filter(b=>b.textContent===tr('unlockWorkspace')).at(-1)!;
  await runtime.act(async()=>remove.click());assert.equal(locked,'w:false');
  // Two simultaneously mounted scopes retain independent language and cleanup.
  const secondSnapshot={active:other,revision:0};let secondDisposed=false;
  const second=runtime.installLocalization({locale:{register:()=>()=>{secondDisposed=true;},bind:()=>createTranslator(other),subscribe:()=>()=>{},getSnapshot:()=>secondSnapshot},effect:(fn:Function)=>effects.push(fn())});
  await runtime.act(async()=>root.render(runtime.createElement('div',null,
    runtime.createElement(localized.Localized,null,runtime.createElement(runtime.PinCells,{label:'First',value:'',onChange:()=>{},allowReveal:true})),
    runtime.createElement(second.Localized,null,runtime.createElement(runtime.PinCells,{label:'Second',value:'',onChange:()=>{},allowReveal:true})))));
  assert.ok(container.querySelector(`input[aria-label="${tr('pinDigit',{label:'First',index:1})}"]`));
  assert.ok(container.querySelector(`input[aria-label="${createTranslator(other)('pinDigit',{label:'Second',index:1})}"]`));
  const disposeSecond=effects.pop()!;disposeSecond();assert.equal(secondDisposed,true);
  await switchLanguage(other);assert.equal(container.querySelectorAll(`input[aria-label="${createTranslator(other)('pinDigit',{label:'First',index:1})}"]`).length,1);
});
