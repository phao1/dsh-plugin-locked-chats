import { randomBytes } from 'node:crypto';

/** Owner-authenticated settings surface. Never embeds stored or generated credentials in HTML. */
export function settingsPage(): Response {
  const nonce = randomBytes(24).toString('base64');
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PIN 与恢复码</title><style nonce="${nonce}">
:root{color-scheme:light dark;--lc-bg:#fff;--lc-fg:#202020;--lc-muted:#777;--lc-soft:#f6f7f8;--lc-line:#e9e9e9;--lc-action:#181818;--lc-action-text:#fff}@media(prefers-color-scheme:dark){:root{--lc-bg:#171717;--lc-fg:#eee;--lc-muted:#a0a0a0;--lc-soft:#232323;--lc-line:#333;--lc-action:#eee;--lc-action-text:#171717}}body{font:14px/1.65 system-ui,-apple-system,sans-serif;background:var(--lc-bg);color:var(--lc-fg);margin:0}main{max-width:520px;margin:64px auto;padding:32px}h1{font-size:24px;font-weight:600;letter-spacing:-.5px;margin:0 0 24px}h2{font-size:17px}label{display:block;margin:18px 0 8px;color:var(--lc-muted)}input,textarea,button{font:inherit;box-sizing:border-box}input,textarea{width:100%;padding:11px 12px;border:1px solid var(--lc-line);border-radius:10px;background:var(--lc-bg);color:var(--lc-fg);margin-top:6px}input:focus,textarea:focus{outline:2px solid var(--lc-muted);outline-offset:2px}textarea{min-height:100px;font-size:13px}button{padding:9px 16px;margin:12px 8px 0 0;border:1px solid var(--lc-line);border-radius:10px;background:var(--lc-action);color:var(--lc-action-text);cursor:pointer}button:hover{opacity:.85}button:disabled{opacity:.5;cursor:wait}#cancel{background:transparent;color:var(--lc-fg)}.notice{padding:14px 16px;background:var(--lc-soft);border-radius:10px;color:var(--lc-muted);font-size:13px}.muted{color:var(--lc-muted);font-size:13px}#message{min-height:24px;white-space:pre-wrap;color:var(--lc-muted)}nav{margin:18px 0}[hidden]{display:none!important}@media(max-width:600px){main{margin:24px auto;padding:24px}}
</style><main><h1>PIN 与恢复码</h1>
<p class="notice">界面隐藏版：设置 PIN 后，请从聊天菜单选择“锁定聊天”。此功能不加密数据，不限制原始 API；记忆隔离与生物识别尚未实现。</p>
<p class="muted">PIN 用于日常验证。忘记 PIN 时可以使用恢复码重设；两者均丢失时无法恢复访问。请把恢复码保存在密码管理器或自行保管的恢复文件中。</p>
<p id="message" role="status" aria-live="polite">正在连接…</p><nav id="choices" hidden></nav>
<form id="form" hidden autocomplete="off"><div id="fields"></div><button id="submit" type="submit">继续</button><button id="cancel" type="button">取消</button></form>
<section id="backup" hidden><h2>保存新的恢复码</h2><p>此码可以重设 PIN。不要分享给他人，也不要保存在插件数据目录中。确认完成前，原有凭据仍然有效。</p><textarea id="code" readonly aria-label="新恢复码"></textarea><button id="download" type="button">下载恢复文件</button><p>保存后，请在下方重新输入或粘贴备份的恢复码，再提交确认。</p></section>
<p class="muted">关闭或刷新页面会放弃未确认的操作。此页面不把凭据写入浏览器持久存储。</p></main>
<script nonce="${nonce}">${SETTINGS_SCRIPT}</script></html>`, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
    'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
  } });
}

// Browser-only code uses textContent and form controls, never user-controlled HTML.
export const SETTINGS_SCRIPT = String.raw`
'use strict';
const el = id => document.getElementById(id);
let windowToken, configured = false, action, operation, recoveryGrant, busy = false;
const messages = { invalid_pin:'PIN 不正确，或不是 4 位数字。', invalid_recovery:'恢复码无效。', invalid_input:'请检查输入，两次 PIN 必须一致。', backup_mismatch:'备份内容不一致，请重新输入保存的恢复码。', stale_operation:'凭据已发生变化，请刷新页面后重试。', expired_operation:'操作已过期，请取消后重新开始。', wrong_connection:'窗口授权已失效，请刷新页面。', unavailable:'凭据服务暂不可用，请稍后重试。', already_configured:'已设置 PIN，请刷新页面。', too_many_operations:'操作过多，请稍后重试。' };
function say(text) { el('message').textContent = text; }
async function call(payload) {
  const response = await fetch('/api/locked-chats/credentials', { method:'POST', cache:'no-store', credentials:'same-origin', headers:{ 'content-type':'application/json', ...(windowToken ? {'x-dsh-private-window':windowToken} : {}) }, body:JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error === 'throttled' ? '尝试次数过多，请在 '+result.retryAfterSeconds+' 秒后重试。' : (messages[result.error] || '操作失败，请刷新页面重试。'));
  return result;
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
  const wrapper = document.createElement('label'); wrapper.textContent = '导入恢复文件（可选）';
  const file = document.createElement('input'); file.type = 'file'; file.accept = '.txt,text/plain';
  file.onchange = async () => {
    const selected = file.files && file.files[0]; if (!selected) return;
    const target = el('fields').querySelector('input[name="recoveryCode"]');
    try {
      if (selected.size > 1024) throw new Error('恢复文件过大，请选择下载的恢复码文本文件。');
      const code = (await selected.text()).trim();
      if (!/^DSHR1:[a-f0-9-]+:[A-Za-z2-7]+:[a-fA-F0-9]{8}$/.test(code) || code.length > 256) throw new Error('文件不是有效的恢复码文本，请重新选择。');
      if (target && target.isConnected) { target.value = code; say('已导入恢复码，请点击继续验证。'); }
    } catch (error) { if (target && target.isConnected) say(error instanceof Error ? error.message : '无法读取恢复文件。'); }
    finally { file.value = ''; }
  };
  wrapper.append(file); el('fields').append(wrapper);
}
function show(next) {
  action = next; el('fields').replaceChildren(); el('choices').hidden = true; el('form').hidden = false;
  if (next === 'beginRecovery' || next === 'confirmBackup') {
    input('recoveryCode', next === 'confirmBackup' ? '输入已保存的新恢复码' : '恢复码');
    recoveryFile();
  }
  else {
    if (next === 'changePin') input('oldPin', '当前 PIN', true);
    input('pin', next === 'rotateRecovery' ? '当前 PIN' : '新 PIN（4 位数字）', true);
    if (next !== 'rotateRecovery') input('confirmation', '再次输入新 PIN', true);
  }
  el('fields').querySelector('input').focus();
}
function home() {
  wipe(); el('choices').replaceChildren(); el('choices').hidden = false;
  const options = configured ? [['changePin','修改 PIN'],['beginRecovery','忘记 PIN'],['rotateRecovery','更换恢复码']] : [['setup','首次设置 PIN']];
  for (const [mode, text] of options) { const button = document.createElement('button'); button.type = 'button'; button.textContent = text; button.onclick = () => { say(''); show(mode); }; el('choices').append(button); }
}
el('form').onsubmit = async event => {
  event.preventDefault(); if (busy) return; controls(true); say('正在处理…');
  const payload = Object.fromEntries(new FormData(el('form'))); payload.action = action;
  if (action === 'confirmBackup') payload.operationId = operation;
  if (action === 'recover') payload.recoveryGrant = recoveryGrant;
  try {
    const result = await call(payload);
    if (action === 'beginRecovery') { recoveryGrant = result.recoveryGrant; show('recover'); say('恢复码已验证，请设置新 PIN。'); }
    else if (['setup','recover','rotateRecovery'].includes(action)) {
      operation = result.operationId; el('code').value = result.recoveryCode; el('backup').hidden = false;
      show('confirmBackup'); el('form').before(el('backup')); say('请先保存恢复码；确认备份后才会更新凭据。');
    } else { configured = true; home(); say('凭据已更新。请返回锁定聊天专区重新验证。'); }
  } catch (error) { say(error instanceof Error ? error.message : '操作失败。'); }
  finally { el('form').querySelectorAll('input').forEach(field => { field.value = ''; }); controls(false); }
};
el('cancel').onclick = async () => {
  if (busy) return; controls(true);
  try { if (operation) await call({action:'cancel', operationId:operation}); home(); say('已取消，原有凭据未改变。'); }
  catch (error) { say(error instanceof Error ? error.message : '取消失败，请关闭页面。'); }
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
  try { const state = await call({action:'status'}); configured = state.configured; windowToken = (await call({action:'openWindow'})).windowToken; home(); say(configured ? '已设置 PIN 和恢复码。' : '尚未设置 PIN。'); }
  catch (error) { say(error instanceof Error ? error.message : '无法连接。'); }
})();
`;
