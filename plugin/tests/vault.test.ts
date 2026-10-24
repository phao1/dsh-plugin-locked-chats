import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
// @ts-ignore: browser module
import { mountWorkspaceEntry } from '../client/entry-placement.mjs';
// @ts-ignore: browser module
import { vaultGroups } from '../client/vault.mjs';

test('entry sits after the native heading, survives views, and removes only its own DOM', async () => {
  const window=new Window(),doc=window.document;
  const container=doc.createElement('section');doc.body.append(container);
  container.innerHTML='<div><div class="_sectionHeader_abc"><button>native menu</button></div><div id="list"><button>native row</button></div></div>';
  const root=container.firstElementChild!,header=root.firstElementChild!,list=root.lastElementChild!,menu=header.firstElementChild!;
  let clicks=0;menu.addEventListener('click',()=>clicks++);
  let target:any;
  const stop=mountWorkspaceEntry(container,(node:any)=>{target=node;});
  assert.equal(header.nextElementSibling,target);assert.equal(target.nextElementSibling,list);
  (menu as any).click();assert.equal(clicks,1);
  const next=header.cloneNode(true);header.replaceWith(next);
  await window.happyDOM.whenAsyncComplete();
  assert.equal(root.firstElementChild,next);assert.equal(root.children[1],target);assert.equal(root.lastElementChild,list);
  stop();assert.equal(root.children.length,2);assert.equal(root.lastElementChild,list);
  await window.happyDOM.close();
});

test('unknown host heading falls back without modifying native contents',async()=>{
  const window=new Window(),container=window.document.createElement('div');
  container.innerHTML='<div><header>changed host</header><main>rows</main></div>';
  const before=container.innerHTML;let target='unset';
  const stop=mountWorkspaceEntry(container,(node:any)=>{target=node;});
  assert.equal(target,null);assert.equal(container.innerHTML,before);stop();await window.happyDOM.close();
});

test('vault groups only locked members, preserving workspace data and independent chats',()=>{
  const catalog={byId:{a:{id:'a'},b:{id:'b'},c:{id:'c'}}};
  const workspaces=[{workspaceId:'p',title:'Project',sessionIds:['a','b']}];
  assert.deepEqual(vaultGroups(catalog,['a','c','missing'],workspaces),[
    {id:'p',title:'Project',rows:[{id:'a'}]},{id:'',title:'Standalone chats',rows:[{id:'c'}]},
  ]);
  assert.deepEqual(workspaces[0]?.sessionIds,['a','b']);
  assert.deepEqual(vaultGroups(catalog,[],workspaces),[]);
});

test('empty native editor drafts stay hidden without appearing as phantom chats',()=>{
  const catalog={byId:{draft:{id:'draft',blank:true},sent:{id:'sent',blank:false}}};
  assert.deepEqual(vaultGroups(catalog,['draft','sent'],[{workspaceId:'w',title:'Work',sessionIds:['draft','sent']}]),[
    {id:'w',title:'Work',rows:[{id:'sent',blank:false}]},
  ]);
  assert.deepEqual(vaultGroups(catalog,['draft'],[{workspaceId:'w',title:'Work',sessionIds:['draft']}]),[]);
});

 test('private navigation shares native scroll seat and follows replacement without moving rows',async()=>{
  const window=new Window(),doc=window.document,container=doc.createElement('div');doc.body.append(container);
  container.innerHTML='<div><div class="x_sectionHeader">heading</div><div class="x_listArea"><div class="x_list" role="tree"><div data-row-key="a">native</div></div></div></div>';
  const list=container.querySelector('.x_list')!,row=list.firstElementChild;let target:any;
  const stop=mountWorkspaceEntry(container,(node:any)=>{target=node;});
  assert.equal(target.parentElement,list);assert.equal(list.firstElementChild,target);assert.equal(list.lastElementChild,row);
  const next=doc.createElement('div');next.className='x_list';next.innerHTML='<div>search result</div>';list.replaceWith(next);
  await window.happyDOM.whenAsyncComplete();assert.equal(target.parentElement,next);assert.equal(next.firstElementChild,target);
  stop();assert.equal(next.children.length,1);assert.equal(next.textContent,'search result');await window.happyDOM.close();
});
