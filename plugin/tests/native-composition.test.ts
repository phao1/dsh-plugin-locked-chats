import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
// @ts-ignore: framework-independent browser modules.
import { composeBrowser } from '../client/slot-composition.mjs';
// @ts-ignore
import { hiddenFamily, projectCatalog, preserveHiddenOrder } from '../client/projection.mjs';

test('native composition retains component, store, locale, menu hooks, dynamic extensions and unloads cleanly', async () => {
  const slots = new SlotCore();
  const register = slots.register.bind(slots) as Function;
  register({name:'root',children:{'sidebar.workspaces':{kind:'single',scope:'root'}}}, () => null);
  const native = () => null, item = () => null, extension = () => null;
  const store = {}, hooks = {hooks:{menuOpenState:()=>[true,()=>{}]}}, inject = () => ({startSession:()=>{}});
  register({name:'sidebar.workspaces',store,inject,locale:'workspace',children:{'native.menu':{kind:'list',scope:'root',inject:hooks}}},native);
  register({name:'native.menu',id:'rename',order:200},item);
  const original = slots.entries('sidebar.workspaces')[0];
  const stop = composeBrowser(slots, (component:Function, props:object)=>({component,props}), (component:Function, props:object)=>({component,props}));
  await Promise.resolve();
  const wrapper = slots.entriesOfSlot('sidebar.workspaces')[0]!;
  assert.equal(wrapper.store,store); assert.equal(wrapper.inject,inject); assert.equal(wrapper.locale,'workspace');
  assert.equal(slots.entries('sidebar.workspaces').includes(original!),true);
  assert.equal(wrapper.children?.['locked-chats.composed.native.menu']?.inject,hooks);
  const forwarded = (wrapper.component as Function)({wide:true,renderSlot:(key:string)=>key});
  assert.equal(forwarded.component,native);
  assert.equal(forwarded.props.renderSlot('native.menu',{}),'locked-chats.composed.native.menu');
  assert.throws(()=>forwarded.props.renderSlot('unknown',{}));
  const child = slots.entriesOfSlot('locked-chats.composed.native.menu')[0]!;
  assert.equal((child.component as Function)({sessionId:'a'}).component,item);
  const remove = register({name:'native.menu',id:'extension',order:250},extension);
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(slots.entriesOfSlot('locked-chats.composed.native.menu').map(e=>e.options.id),['rename','extension']);
  remove(); await Promise.resolve(); await Promise.resolve();
  assert.equal(slots.entriesOfSlot('locked-chats.composed.native.menu').length,1);
  stop(); await Promise.resolve();
  assert.equal(slots.entriesOfSlot('sidebar.workspaces')[0],original);
  assert.equal(slots.entriesOfSlot('native.menu').length,1);
  assert.equal(slots.entriesOfSlot('locked-chats.composed.native.menu').length,0);
});

test('filtered native tree suppresses descendants and preserves host snapshots and hidden drag positions', () => {
  const catalog={ids:['a','secret','b','child'],byId:{a:{id:'a'},secret:{id:'secret'},b:{id:'b'},child:{id:'child',parentId:'secret'}},projectionsBySession:{secret:{title:'private'}}};
  const hidden=hiddenFamily(catalog,['secret']);
  assert.deepEqual(projectCatalog(catalog,hidden).ids,['a','b']);
  assert.deepEqual(Object.keys(projectCatalog(catalog,hidden).byId),['a','b']);
  assert.deepEqual(projectCatalog(catalog,hidden).projectionsBySession,{});
  assert.equal(catalog.ids.length,4);
  assert.deepEqual(preserveHiddenOrder(['b','a'],['a','secret','b'],hidden),['b','secret','a']);
  assert.deepEqual(preserveHiddenOrder(['b','secret','a'],['a','secret','b'],hidden),['b','secret','a']);
});
