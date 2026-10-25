import {test} from 'node:test';
import assert from 'node:assert/strict';
import {en,zh,createTranslator,resolveLanguage} from '../src/locales.ts';
// @ts-ignore Browser model intentionally remains native ESM.
import {PrivacyClient} from '../client/model.mjs';
import {settingsPage} from '../src/settings-page.ts';
import {apply} from '../src/index.ts';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('English and Chinese dictionaries cover the same strings and interpolate values literally',()=>{
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
  for(const value of Object.values(en)) { assert.ok(value.trim()); assert.doesNotMatch(value,/\p{Script=Han}/u); }
  assert.equal(createTranslator('en')('pinDigit',{label:'PIN',index:2}),'PIN digit 2');
  assert.equal(createTranslator('zh')('pinDigit',{label:'PIN',index:2}),'PIN第 2 位');
  assert.equal(createTranslator('en')('chatActions',{title:'{index} <test>'}),'Actions for “{index} <test>”');
  assert.equal(resolveLanguage('zh-CN'),'zh');assert.equal(resolveLanguage('en-GB'),'en');assert.equal(resolveLanguage('fr'),'en');
  assert.equal(resolveLanguage('zh-<script>'),'en');assert.equal(resolveLanguage('zh-'),'en');
  const tr=createTranslator('en');assert.equal(tr('time.minutes.one',{count:1}),'1 minute ago');assert.equal(tr('time.minutes.other',{count:2}),'2 minutes ago');
});

test('credential errors use the client locale with a safe translated fallback',async()=>{
  for(const language of ['en','zh']){
    const t=createTranslator(language);
    for(const code of ['invalid_pin','invalid_recovery','invalid_input','not_configured','already_configured','throttled','expired_operation','stale_operation','wrong_connection','backup_mismatch','too_many_operations','session_not_found','workspace_not_found','storage_invalid','closed','access_denied','access_expired','unavailable','not_locked','unknown']){
      if(code!=='unknown')assert.ok(Object.hasOwn(en,`error.${code}`),`explicit mapping for ${code}`);
      const client=new PrivacyClient(async()=>new Response(JSON.stringify({error:code,retryAfterSeconds:42}),{status:400}),t);
      await assert.rejects(client.call('status'),(error:any)=>{
        assert.equal(error.code,code);assert.equal(error.message,t(code==='unknown'?'operationFailed':`error.${code}`,{seconds:42}));return true;
      });
    }
  }
});

test('standalone settings selects a supported language without reflecting input into HTML',async()=>{
  for(const [query,header,expected] of [['','en-US','en'],['','zh-CN','zh-CN'],['?lang=en','zh-CN','en'],['?lang=zh','en-US','zh-CN'],['?lang=<script>','fr','en'],['','en;q=0.2,zh-CN;q=0.9','zh-CN'],['','zh;q=0,en;q=1','en'],['','zh;q=invalid','en'],['?lang=fr','zh','en'],['?lang=ZH-cn','en','zh-CN']]){
    const response=settingsPage(new Request(`http://localhost/api/locked-chats/settings${query}`,{headers:{'accept-language':header!}}));
    const html=await response.text();assert.ok(html.includes(`<html lang="${expected}">`));
    assert.ok(html.includes(expected==='en'?'<title>PIN and recovery code</title>':'<title>PIN 与恢复码</title>'));
    assert.ok(!html.includes('lang=<script>'));
  }
});

test('registered settings route forwards request locale through the real plugin lifecycle without a listener',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'dsh-locale-route-')),cleanups:Function[]=[],routes=new Map<string,any>();
  t.after(()=>{for(const cleanup of cleanups.reverse())cleanup();rmSync(directory,{recursive:true});});
  const ctx={
    effect:async(body:()=>AsyncGenerator<Function>)=>{for await(const cleanup of body())cleanups.push(cleanup);},
    on:()=>()=>{},logger:{warn:()=>{}},workspaceRegistry:{list:()=>[]},sessions:{list:()=>[],get:()=>undefined},sessionPersistence:{list:async()=>[]},
    tools:{register:()=>()=>{}},systemPrompt:{section:()=>()=>{}},
    connection:{fetch:{register:(route:any)=>{routes.set(route.path,route);return()=>routes.delete(route.path);}}},
  };
  await apply(ctx as any,{directory,attemptsPerWindow:5,initialCooldownMs:60_000,maxCooldownMs:900_000,recoveryLifetimeMs:300_000,maxPendingOperations:64,awayTimeoutMs:60_000,connectionLeaseMs:60_000,maxGrants:64,maxRequestBytes:16384,maxWindows:64,windowLifetimeMs:600_000,sweepIntervalMs:1000});
  const route=routes.get('/api/locked-chats/settings');assert.ok(route);
  for(const language of ['en','zh']){
    const response=await route.fetch(new Request(`http://localhost/api/locked-chats/settings?lang=${language}`));
    assert.equal(response.headers.get('content-language'),language==='zh'?'zh-CN':'en');
    assert.ok((await response.text()).includes(createTranslator(language)('settingsTitle')));
  }
});
