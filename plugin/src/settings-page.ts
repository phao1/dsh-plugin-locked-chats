import { randomBytes } from 'node:crypto';
import {createTranslator,en,zh,resolveLanguage} from './locales.ts';

/** Owner-authenticated settings surface. Never embeds stored or generated credentials in HTML. */
export function settingsPage(request?: Request): Response {
  const language=pageLanguage(request),t=createTranslator(language);
  const nonce = randomBytes(24).toString('base64');
  return new Response(`<!doctype html><html lang="${language==='zh'?'zh-CN':'en'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t("settingsTitle")}</title><style nonce="${nonce}">
:root{color-scheme:light dark;--lc-bg:#fff;--lc-fg:#202020;--lc-muted:#777;--lc-soft:#f6f7f8;--lc-line:#e9e9e9;--lc-action:#181818;--lc-action-text:#fff}@media(prefers-color-scheme:dark){:root{--lc-bg:#171717;--lc-fg:#eee;--lc-muted:#a0a0a0;--lc-soft:#232323;--lc-line:#333;--lc-action:#eee;--lc-action-text:#171717}}body{font:14px/1.65 system-ui,-apple-system,sans-serif;background:var(--lc-bg);color:var(--lc-fg);margin:0}main{max-width:520px;margin:64px auto;padding:32px}h1{font-size:24px;font-weight:600;letter-spacing:-.5px;margin:0 0 24px}h2{font-size:17px}label{display:block;margin:18px 0 8px;color:var(--lc-muted)}input,textarea,button{font:inherit;box-sizing:border-box}input,textarea{width:100%;padding:11px 12px;border:1px solid var(--lc-line);border-radius:10px;background:var(--lc-bg);color:var(--lc-fg);margin-top:6px}input:focus,textarea:focus{outline:2px solid var(--lc-muted);outline-offset:2px}textarea{min-height:100px;font-size:13px}button{padding:9px 16px;margin:12px 8px 0 0;border:1px solid var(--lc-line);border-radius:10px;background:var(--lc-action);color:var(--lc-action-text);cursor:pointer}button:hover{opacity:.85}button:disabled{opacity:.5;cursor:wait}#cancel{background:transparent;color:var(--lc-fg)}.notice{padding:14px 16px;background:var(--lc-soft);border-radius:10px;color:var(--lc-muted);font-size:13px}.muted{color:var(--lc-muted);font-size:13px}#message{min-height:24px;white-space:pre-wrap;color:var(--lc-muted)}nav{margin:18px 0}[hidden]{display:none!important}@media(max-width:600px){main{margin:24px auto;padding:24px}}
</style><main><h1>${t("settingsTitle")}</h1>
<p class="notice">${t("standaloneNotice")}</p>
<p class="muted">${t("recoveryAdvice")}</p>
<p id="message" role="status" aria-live="polite">${t("connecting")}</p><nav id="choices" hidden></nav>
<form id="form" hidden autocomplete="off"><div id="fields"></div><button id="submit" type="submit">${t("continue")}</button><button id="cancel" type="button">${t("cancel")}</button></form>
<section id="backup" hidden><h2>${t("saveNewRecovery")}</h2><p>${t("backupAdvice")}</p><textarea id="code" readonly aria-label="${t("newRecovery")}"></textarea><button id="download" type="button">${t("downloadRecovery")}</button><p>${t("backupPrompt")}</p></section>
<p class="muted">${t("pageFootnote")}</p></main>
<script nonce="${nonce}">${`const messages=${JSON.stringify(language==='zh'?zh:en).replace(/</g,'\\u003c')};`}${SETTINGS_SCRIPT}</script></html>`, { headers: {
    'content-language': language==='zh'?'zh-CN':'en', 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  } });
}

/** A standalone page has no client locale service; use a supported query or browser preference. */
function pageLanguage(request?: Request): 'en' | 'zh' {
  if(!request)return 'en';
  const requested=new URL(request.url).searchParams.get('lang');
  if(requested!==null)return resolveLanguage(requested);
  const accepted=(request.headers.get('accept-language')??'').split(',').map((entry,index)=>{
    const [tag='',...parameters]=entry.trim().split(';');
    const quality=parameters.find(parameter=>parameter.trim().startsWith('q='));
    const q=quality===undefined?1:Number(quality.trim().slice(2));
    return {tag,q,index};
  }).filter(({tag,q})=>/^(?:en|zh)(?:-[a-z0-9]+)*$/i.test(tag)&&Number.isFinite(q)&&q>0&&q<=1)
    .sort((a,b)=>b.q-a.q||a.index-b.index);
  return resolveLanguage(accepted[0]?.tag);
}

// Browser-only code uses textContent and form controls, never user-controlled HTML.
export const SETTINGS_SCRIPT = String.raw`
'use strict';
const el = id => document.getElementById(id);
let windowToken, configured = false, action, operation, recoveryGrant, busy = false;
const t=(key,values={})=>(messages[key]??messages.operationFailed).replace(/\{(\w+)\}/g,(placeholder,name)=>String(values[name]??placeholder));
function say(text) { el('message').textContent = text; }
async function call(payload) {
  let response,result;
  try {
    response = await fetch('/api/locked-chats/credentials', { method:'POST', cache:'no-store', credentials:'same-origin', headers:{ 'content-type':'application/json', ...(windowToken ? {'x-dsh-private-window':windowToken} : {}) }, body:JSON.stringify(payload) });
    result = await response.json();
  } catch { throw new Error(t('connectionFailed')); }
  if (!response.ok) {
    if (result.error === 'wrong_connection') windowToken = undefined;
    const error = new Error(t('error.'+result.error,{seconds:result.retryAfterSeconds??60}));
    error.code = result.error; throw error;
  }
  return result;
}
async function failed(error) {
  if (['wrong_connection','expired_operation','stale_operation','already_configured'].includes(error.code)) {
    home();
    try { configured = (await call({action:'status'})).configured; home(); } catch {}
  }
  say(error instanceof Error ? error.message : t("operationFailed"));
}
function controls(locked) { busy = locked; document.querySelectorAll('button').forEach(button => { button.disabled = locked; }); }
function wipe() { el('fields').replaceChildren(); el('code').value = ''; el('backup').hidden = true; el('form').hidden = true; operation = undefined; recoveryGrant = undefined; action = undefined; }
function input(name, label, pin = false) {
  const wrapper = document.createElement('label'); wrapper.textContent = label;
  const field = document.createElement('input'); field.name = name; field.required = true; field.autocomplete = 'off'; field.type = 'password';
  if (pin) { field.inputMode = 'numeric'; field.pattern = '[0-9]{4}'; field.minLength = 4; field.maxLength = 4; } else field.maxLength = 256;
  wrapper.append(field); el('fields').append(wrapper);
}
function recoveryFile() {
  const wrapper = document.createElement('label'); wrapper.textContent = t("importRecovery");
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.txt,text/plain';
  file.onchange = async () => {
    const selected = file.files && file.files[0]; if (!selected) return;
    const target = el('fields').querySelector('input[name="recoveryCode"]');
    try {
      if (selected.size > 1024) throw Object.assign(new Error(t("fileTooLarge")),{localized:true});
      const code = (await selected.text()).trim();
      if (!/^DSHR1:[a-f0-9-]+:[A-Za-z2-7]+:[a-fA-F0-9]{8}$/.test(code) || code.length > 256) throw Object.assign(new Error(t("fileInvalid")),{localized:true});
      if (target && target.isConnected) { target.value = code; say(t("importedRecovery")); }
    } catch (error) { if (target && target.isConnected) say(error?.localized ? error.message : t("fileReadFailed")); }
    finally { file.value = ''; }
  };
  wrapper.append(file); el('fields').append(wrapper);
}
function show(next) {
  action = next; el('fields').replaceChildren(); el('choices').hidden = true; el('form').hidden = false;
  if (next === 'beginRecovery' || next === 'confirmBackup') {
    input('recoveryCode', next === 'confirmBackup' ? t("enterSavedRecovery") : t("recoveryCode"));
    recoveryFile();
  }
  else {
    if (next === 'changePin') input('oldPin', t("currentPin"), true);
    input('pin', next === 'rotateRecovery' ? t("currentPin") : t("newPin"), true);
    if (next !== 'rotateRecovery') input('confirmation', t("confirmNewPin"), true);
  }
  el('fields').querySelector('input').focus();
}
function home() {
  wipe(); el('choices').replaceChildren(); el('choices').hidden = false;
  const options = configured ? [['changePin',t("changePin")],['beginRecovery',t("forgotPin")],['rotateRecovery',t("rotateRecovery")]] : [['setup',t("setupPin")]];
  for (const [mode, text] of options) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = () => { say(''); show(mode); }; el('choices').append(button); }
}
el('form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; controls(true); say(t("processing"));
  const payload = Object.fromEntries(new FormData(el('form'))); payload.action = action;
  if (action === 'confirmBackup') payload.operationId = operation;
  if (action === 'recover') payload.recoveryGrant = recoveryGrant;
  try {
    if (!windowToken) windowToken = (await call({action:'openWindow'})).windowToken;
    const result = await call(payload);
    if (action === 'beginRecovery') { recoveryGrant = result.recoveryGrant; show('recover'); say(t("recoveryVerified")); }
    else if (['setup','recover','rotateRecovery'].includes(action)) {
      operation = result.operationId; el('code').value = result.recoveryCode; el('backup').hidden = false;
      show('confirmBackup'); el('form').before(el('backup')); say(t("saveBeforeConfirm"));
    } else { configured = true; home(); say(t("pageCredentialsUpdated")); }
  } catch (error) { await failed(error); }
  finally { el('form').querySelectorAll('input').forEach(field => { field.value = ''; }); controls(false); }
};
el('cancel').onclick = async () => {
  if (busy) return; controls(true);
  try { if (operation) await call({action:'cancel', operationId:operation}); home(); say(t("cancelled")); }
  catch (error) { await failed(error); }
  finally { controls(false); }
};
el('download').onclick = () => {
  const url = URL.createObjectURL(new Blob([el('code').value+'\n'], {type:'text/plain;charset=utf-8'}));
  const link = document.createElement('a'); link.href = url; link.download = 'dsh-locked-chats-recovery.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener('pagehide', () => {
  if (windowToken) fetch('/api/locked-chats/credentials', {method:'POST', keepalive:true, credentials:'same-origin', headers:{'content-type':'application/json','x-dsh-private-window':windowToken}, body:JSON.stringify({action:'closeWindow'})}).catch(() => {});
  wipe(); windowToken = undefined;
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
(async () => {
  try { const state = await call({action:'status'}); configured = state.configured; windowToken = (await call({action:'openWindow'})).windowToken; home(); say(configured ? t("configured") : t("notConfigured")); }
  catch (error) { say(error instanceof Error ? error.message : t("connectionFailed")); }
})();
`;
