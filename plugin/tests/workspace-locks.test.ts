import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HiddenChats } from '../src/hidden-chats.ts';
import { WorkspaceLocks } from '../src/workspace-locks.ts';
import type { LockSessionHeader, LockWorkspace, WorkspaceLockHost } from '../src/workspace-locks.ts';
import { LockError } from '../src/errors.ts';
import { Credentials } from '../src/credentials.ts';
import { AccessGrants } from '../src/access-grants.ts';
import { CredentialApi } from '../src/api.ts';

function fixture(t:TestContext,legacy?:(directory:string,cwd:string)=>void){
  const directory=mkdtempSync(join(tmpdir(),'dsh-workspace-locks-'));
  const cwd=join(directory,'work');mkdirSync(cwd);
  const headers=new Map<string,LockSessionHeader>();
  const live=new Map<string,{header:LockSessionHeader}>();
  const workspaces:LockWorkspace[]=[{id:'workspace',path:cwd,sessionIds:[]}];
  legacy?.(directory,cwd);
  const store=new HiddenChats(directory);
  const host:WorkspaceLockHost={
    workspaceRegistry:{list:()=>workspaces},
    sessions:{list:()=>[...live.values()],get:id=>live.get(id)},
    sessionPersistence:{list:async()=>[...headers.values()].map(header=>({header}))},
  };
  const locks=new WorkspaceLocks(store,host);
  const add=(header:LockSessionHeader,running=false)=>{headers.set(header.id,header);if(running)live.set(header.id,{header});locks.observeHeader(header);};
  t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
  return {directory,cwd,headers,live,workspaces,store,host,locks,add};
}
const error=(code:string)=>(value:unknown)=>value instanceof LockError&&value.code===code;

test('workspace lock inherits to current, future and nested sessions; removing it preserves individual locks',async t=>{
  const f=fixture(t);
  f.add({id:'current',cwd:f.cwd});
  f.add({id:'individual',cwd:f.cwd});f.store.set('individual',true);
  f.add({id:'public',cwd:join(f.directory,'other')});
  f.locks.setWorkspace('workspace',true);
  assert.deepEqual((await f.locks.snapshot()).ids,['current','individual']);
  f.add({id:'future',cwd:f.cwd},true);
  f.add({id:'child',cwd:join(f.directory,'different-child-cwd'),parentSession:'future'},true);
  f.add({id:'grandchild',parentSession:'child'});
  assert.equal(f.locks.isLockedId('future'),true);
  assert.equal(f.locks.isLockedId('grandchild'),true);
  f.locks.setWorkspace('workspace',false);
  assert.deepEqual((await f.locks.snapshot()).ids,['individual']);
  assert.deepEqual(f.store.list(),['individual']);
});

test('workspace membership and canonical path survive registry changes and store reload',async t=>{
  const f=fixture(t),alias=join(f.directory,'alias');symlinkSync(f.cwd,alias);
  f.workspaces[0]={id:'workspace',path:alias,sessionIds:['member']};
  f.add({id:'member'});f.add({id:'path',cwd:realpathSync(f.cwd)});
  f.locks.setWorkspace('workspace',true);
  assert.equal(f.locks.isLockedId('member'),true);
  assert.equal(f.locks.isLockedId('path'),true);
  f.workspaces.length=0;
  assert.equal(f.locks.isLockedId('path'),true);
  const reopened=new HiddenChats(f.directory);
  try{
    assert.deepEqual(reopened.listWorkspaces(),[{id:'workspace',path:realpathSync(f.cwd)}]);
    assert.equal((await new WorkspaceLocks(reopened,f.host).snapshot()).ids.includes('path'),true);
  }finally{reopened.close();}
  assert.throws(()=>f.locks.setWorkspace('missing',true),error('workspace_not_found'));
  f.locks.setWorkspace('workspace',false);
  assert.deepEqual(f.store.listWorkspaces(),[]);
});

test('locked ancestor protects a child even when the ancestor header is no longer listed; unknown sessions fail closed',async t=>{
  const f=fixture(t);f.store.set('missing-parent',true);
  f.add({id:'child',parentSession:'missing-parent'});
  assert.equal(f.locks.isLockedId('child'),true);
  assert.throws(()=>f.locks.isLockedId('unknown'),error('session_not_found'));
  assert.deepEqual((await f.locks.snapshot()).ids,['child','missing-parent']);
});

test('memory resolver rejects unresolved and cyclic ancestry instead of writing ordinary memory',async t=>{
  const f=fixture(t);
  f.add({id:'unknown-child',parentSession:'missing'});
  f.add({id:'cycle-a',parentSession:'cycle-b'});f.add({id:'cycle-b',parentSession:'cycle-a'});
  assert.throws(()=>f.locks.isLockedId('unknown-child'),error('session_not_found'));
  assert.throws(()=>f.locks.isLockedId('cycle-a'),error('session_not_found'));
  f.add({id:'protected-child',cwd:f.cwd,parentSession:'missing'});f.locks.setWorkspace('workspace',true);
  assert.equal(f.locks.isLockedId('protected-child'),true);
  f.add({id:'ordinary-root'});f.add({id:'ordinary-child',parentSession:'ordinary-root'});
  assert.equal(f.locks.isLockedId('ordinary-child'),false);
});

test('legacy recycle-bin roots migrate to explicit locks without exposing descendants or changing host data',async t=>{
  const f=fixture(t,(directory,cwd)=>{
    const legacy=new DatabaseSync(join(directory,'hidden-chats.sqlite'));
    legacy.exec(`CREATE TABLE hidden_chats(id TEXT PRIMARY KEY);
      CREATE TABLE hidden_workspaces(id TEXT PRIMARY KEY,path TEXT NOT NULL);
      CREATE TABLE trashed_chats(id TEXT PRIMARY KEY,deleted_at INTEGER NOT NULL);
      INSERT INTO hidden_chats(id) VALUES ('explicit'),('overlap');
      INSERT INTO trashed_chats(id,deleted_at) VALUES ('parent',100),('child',200),('overlap',300);`);
    legacy.prepare('INSERT INTO hidden_workspaces(id,path) VALUES (?,?)').run('workspace',realpathSync(cwd));
    legacy.close();
    writeFileSync(join(directory,'session.jsonl'),'original session and attachment references\n');
  });
  f.add({id:'parent',cwd:f.cwd});f.add({id:'child',parentSession:'parent'});f.add({id:'grandchild',parentSession:'child'});
  f.add({id:'workspace-only',cwd:f.cwd});f.add({id:'public'});
  f.workspaces[0]={id:'workspace',path:f.cwd,sessionIds:['parent','workspace-only']};
  const hostBefore=structuredClone({headers:[...f.headers.values()],workspaces:f.workspaces});
  assert.deepEqual(f.store.list(),['child','explicit','overlap','parent']);
  assert.deepEqual(f.store.listWorkspaces(),[{id:'workspace',path:realpathSync(f.cwd)}]);
  const snapshot=await f.locks.snapshot();
  assert.deepEqual(snapshot.ids,['child','explicit','grandchild','overlap','parent','workspace-only']);
  assert.equal('trashIds' in snapshot,false);
  f.add({id:'future-child',parentSession:'parent'});
  assert.equal(f.locks.isLockedId('future-child'),true);
  f.locks.setWorkspace('workspace',false);
  assert.equal(f.locks.isLockedId('parent'),true);
  assert.equal(f.locks.isLockedId('workspace-only'),false);
  assert.equal(readFileSync(join(f.directory,'session.jsonl'),'utf8'),'original session and attachment references\n');
  assert.deepEqual([...f.headers.values()].slice(0,5),hostBefore.headers);
  assert.deepEqual(f.workspaces,hostBefore.workspaces);
  const check=new DatabaseSync(join(f.directory,'hidden-chats.sqlite'));
  try{assert.equal(check.prepare("SELECT 1 FROM sqlite_master WHERE name='trashed_chats'").get(),undefined);}finally{check.close();}
  // Reopening cannot resurrect a lock that the user subsequently removed.
  f.store.set('parent',false);f.store.set('child',false);
  const reopened=new HiddenChats(f.directory);
  try{
    assert.deepEqual(reopened.list(),['explicit','overlap']);
    assert.deepEqual((await new WorkspaceLocks(reopened,f.host).snapshot()).ids,['explicit','overlap']);
  }finally{reopened.close();}
});

test('failed legacy migration keeps the previous markers and refuses startup',t=>{
  const directory=mkdtempSync(join(tmpdir(),'dsh-lock-migration-failure-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const filename=join(directory,'hidden-chats.sqlite'),legacy=new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE hidden_chats(id TEXT PRIMARY KEY);
    INSERT INTO hidden_chats(id) VALUES ('still-locked');
    CREATE TABLE trashed_chats(unknown_column TEXT);
    INSERT INTO trashed_chats(unknown_column) VALUES ('legacy-protected');`);
  legacy.close();
  assert.throws(()=>new HiddenChats(directory));
  const check=new DatabaseSync(filename);
  try{
    assert.deepEqual(check.prepare('SELECT id FROM hidden_chats').all().map(row=>row.id),['still-locked']);
    assert.deepEqual(check.prepare('SELECT unknown_column FROM trashed_chats').all().map(row=>row.unknown_column),['legacy-protected']);
  }finally{check.close();}
});

test('workspace and chat unlocking requires PIN authorization; retired recycle-bin APIs reject without mutation',async t=>{
  const f=fixture(t);f.add({id:'parent',cwd:f.cwd});f.add({id:'child',parentSession:'parent'});
  const credentials=new Credentials(f.directory,{attemptsPerWindow:5,initialCooldownMs:60000,maxCooldownMs:900000,recoveryLifetimeMs:300000,maxPendingOperations:64});
  const grants=new AccessGrants({awayTimeoutMs:60000,connectionLeaseMs:60000,maxGrants:64},()=>credentials.status().version);
  const api=new CredentialApi(credentials,grants,{maxRequestBytes:16384,maxWindows:64,windowLifetimeMs:600000},f.store,f.locks);
  t.after(()=>{api.close();grants.close();credentials.close();});
  const challenge=await credentials.setup('setup','7319');credentials.confirmBackup('setup',challenge.operationId,challenge.recoveryCode);
  const call=async(body:Record<string,unknown>,windowToken?:string)=>{
    const response=await api.fetch(new Request('http://localhost/api/locked-chats/credentials',{method:'POST',headers:{'content-type':'application/json',...(windowToken?{'x-dsh-private-window':windowToken}:{})},body:JSON.stringify(body)}));
    return {status:response.status,body:await response.json()};
  };
  const {windowToken}=(await call({action:'openWindow'})).body;
  const {accessToken}=(await call({action:'unlock',pin:'7319'},windowToken)).body;
  assert.equal((await call({action:'setWorkspaceHidden',workspaceId:'workspace',hidden:true},windowToken)).status,400);
  const locked=await call({action:'setWorkspaceHidden',workspaceId:'workspace',hidden:true,accessToken},windowToken);
  assert.equal(locked.status,200);assert.deepEqual(locked.body.workspaceIds,['workspace']);assert.deepEqual(locked.body.ids,['child','parent']);
  assert.equal('trashIds' in locked.body,false);
  await call({action:'setHidden',sessionId:'parent',hidden:true,accessToken},windowToken);
  for(const action of ['trashList','trashSession','restoreSession']){
    const rejected=await call({action,sessionId:'parent',confirmation:'parent',accessToken},windowToken);
    assert.equal(rejected.status,400);assert.equal(rejected.body.error,'invalid_input');
  }
  assert.deepEqual(f.store.list(),['parent']);
  assert.deepEqual(f.store.listWorkspaces().map(row=>row.id),['workspace']);
  await call({action:'setWorkspaceHidden',workspaceId:'workspace',hidden:false,accessToken},windowToken);
  assert.deepEqual((await call({action:'hiddenIds'})).body.ids,['child','parent']);
  const released=await call({action:'setHidden',sessionId:'parent',hidden:false,accessToken},windowToken);
  assert.equal(released.status,200);assert.deepEqual(released.body.ids,[]);
  assert.equal(f.headers.size,2);
  await call({action:'lock',accessToken},windowToken);
  assert.equal((await call({action:'setHidden',sessionId:'parent',hidden:true,accessToken},windowToken)).status,403);
  assert.deepEqual(f.store.list(),[]);
});
