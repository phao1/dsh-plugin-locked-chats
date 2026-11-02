import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore browser module
import {prepareNativeDraft,createDraftPreparer} from '../client/native-draft.mjs';

test('native editor session is hidden before host creation and never prompts itself',async()=>{
  const events:string[]=[];let hidden='';
  const client={state:{unlocked:true},setHidden:async(id:string,on:boolean)=>{assert.equal(on,true);hidden=id;events.push('hide');}};
  const sessions={create:async({sessionId,workspaceId}:any)=>{assert.equal(sessionId,hidden);assert.equal(workspaceId,'w');events.push('create');return sessionId;},prompt:()=>assert.fail('host composer must own sending')};
  const id=await prepareNativeDraft(client,sessions,'w');
  assert.equal(id,hidden);assert.deepEqual(events,['hide','create']);
  assert.equal(await prepareNativeDraft(client,sessions,'w',id),id);assert.equal(events.length,2);
});

test('relocking finishes the hidden reservation but refuses to mount the native draft',async()=>{
  const client={state:{unlocked:true},setHidden:async()=>{client.state.unlocked=false;}};
  let created=false;
  await assert.rejects(prepareNativeDraft(client,{create:async({sessionId}:any)=>{created=true;return sessionId;}},'w'),/Access has expired/);
  assert.equal(created,true);
  await assert.rejects(prepareNativeDraft(client,{},'w','existing'),/Verify your PIN first/);
});

test('StrictMode concurrent mounts share creation only within the same workspace',async()=>{
  const calls:string[]=[];let finish:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{finish=resolve;});
  const client={state:{unlocked:true},setHidden:async()=>{await gate;}};
  const prepare=createDraftPreparer(client,{create:async({sessionId,workspaceId}:any)=>{calls.push(workspaceId);return sessionId;}});
  const a=prepare('a'),again=prepare('a'),b=prepare('b');
  assert.equal(a,again);assert.notEqual(a,b);finish();
  const [one,two]=await Promise.all([a,b]);assert.notEqual(one,two);assert.deepEqual(calls,['a','b']);
  assert.equal(await prepare('a',one),one);assert.equal(calls.length,2);
});

test('failed preparation can be retried',async()=>{
  let attempts=0;
  const prepare=createDraftPreparer({state:{unlocked:true},setHidden:async()=>{}},{create:async({sessionId}:any)=>{if(++attempts===1)throw new Error('offline');return sessionId;}});
  await assert.rejects(prepare('a'),/offline/);assert.ok(await prepare('a'));assert.equal(attempts,2);
});
