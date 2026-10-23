import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Window } from 'happy-dom';
import { settingsPage } from '../src/settings-page.ts';
import { Credentials } from '../src/credentials.ts';
import { AccessGrants } from '../src/access-grants.ts';
import { CredentialApi } from '../src/api.ts';

test('settings response prevents caching, framing and third-party script execution', async () => {
  const first = settingsPage(), second = settingsPage();
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const csp = first.headers.get('content-security-policy')!;
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /connect-src 'self'/);
  assert.notEqual(csp, second.headers.get('content-security-policy'));
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)![1];
  assert.ok((await first.text()).includes(`<script nonce="${nonce}">`));
});

test('settings DOM completes enrollment, cancellation, PIN change and recovery through the real API', { timeout: 15_000 }, async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  const directory = mkdtempSync(join(tmpdir(), 'dsh-settings-dom-'));
  const credentials = new Credentials(directory, { attemptsPerWindow: 5, initialCooldownMs: 60_000,
    maxCooldownMs: 900_000, recoveryLifetimeMs: 300_000, maxPendingOperations: 64 });
  const grants = new AccessGrants({ awayTimeoutMs: 60_000, connectionLeaseMs: 60_000, maxGrants: 64 }, () => credentials.status().version);
  const api = new CredentialApi(credentials, grants, { maxRequestBytes: 16_384, maxWindows: 10, windowLifetimeMs: 600_000 });
  // Execute only our own generated page; all requests terminate in the temporary in-process API.
  const window = new Window({ url: 'http://localhost/api/locked-chats/settings', settings: {
    enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true,
    disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
  } });
  t.after(async () => { await window.happyDOM.close(); api.close(); grants.close(); credentials.close(); rmSync(directory, { recursive: true }); });
  window.fetch = async (input, init) => {
    assert.equal(String(input), '/api/locked-chats/credentials');
    const response = await api.fetch(new Request(new URL(String(input), window.location.href), {
      method: init?.method, headers: init?.headers, body: init?.body,
    }));
    return new window.Response(await response.text(), { status: response.status, headers: Object.fromEntries(response.headers) });
  };
  let exportedText = Promise.resolve('');
  window.URL.createObjectURL = blob => { exportedText = blob.text(); return 'blob:synthetic-download'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {
    assert.equal(this.download, 'dsh-locked-chats-recovery.txt');
    assert.equal(this.href, 'blob:synthetic-download');
  };
  window.document.write(await settingsPage().text());
  const doc = window.document;
  const settle = async () => {
    // Scrypt runs outside the DOM timer owner; poll an observable completion, bounded by this test's timeout.
    for (let i = 0; i < 500; i++) {
      if (!doc.querySelector<HTMLButtonElement>('#submit')!.disabled && doc.getElementById('choices')!.children.length) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('settings operation did not settle');
  };
  const click = (text: string) => {
    const button = [...doc.querySelectorAll('button')].find(button => button.textContent === text);
    assert.ok(button, `missing button ${text}`); button.click();
  };
  const submit = async (fields: Record<string, string>) => {
    for (const [name, value] of Object.entries(fields)) {
      const field = doc.querySelector(`input[name="${name}"]`); assert.ok(field); field.value = value;
    }
    doc.getElementById('form')!.dispatchEvent(new window.Event('submit', { cancelable: true }));
    await settle();
  };
  await settle();
  click('首次设置 PIN');
  await submit({ pin: '1357', confirmation: '1357' });
  assert.equal(credentials.status().configured, false);
  const firstCode = doc.querySelector<HTMLTextAreaElement>('#code')!.value;
  assert.ok(firstCode.startsWith('DSHR1:'));
  click('下载恢复文件');
  const exported = await exportedText;
  assert.equal(exported, firstCode + '\n');
  const fileInput = doc.querySelector('input[type="file"]')!;
  const files = new window.DataTransfer();
  files.items.add(new window.File([exported], 'synthetic-recovery.txt', { type: 'text/plain' }));
  fileInput.files = files.files;
  fileInput.dispatchEvent(new window.Event('change'));
  for (let i = 0; i < 100 && !doc.querySelector('input[name="recoveryCode"]')!.value; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(doc.querySelector('input[name="recoveryCode"]')!.value, firstCode);
  await submit({});
  assert.equal(credentials.status().configured, true, doc.getElementById('message')!.textContent);
  assert.equal(doc.querySelector<HTMLTextAreaElement>('#code')!.value, '');
  click('更换恢复码'); await submit({ pin: '1357' });
  click('取消'); await settle();
  assert.ok(credentials.beginRecovery('check', firstCode));
  click('修改 PIN'); await submit({ oldPin: '1357', pin: '2468', confirmation: '2468' });
  await credentials.verifyPin('2468');
  await assert.rejects(credentials.verifyPin('1357'));
  click('忘记 PIN'); await submit({ recoveryCode: firstCode });
  await submit({ pin: '9753', confirmation: '9753' });
  const secondCode = doc.querySelector<HTMLTextAreaElement>('#code')!.value;
  assert.notEqual(secondCode, firstCode);
  await submit({ recoveryCode: secondCode });
  await credentials.verifyPin('9753');
  assert.throws(() => credentials.beginRecovery('check', firstCode));
  assert.ok(credentials.beginRecovery('check', secondCode));
  click('更换恢复码'); await submit({ pin: '9753' });
  const abandonedCode = doc.querySelector<HTMLTextAreaElement>('#code')!.value;
  t.mock.timers.tick(600_001); api.sweep();
  await submit({ recoveryCode: abandonedCode });
  assert.ok(doc.getElementById('message')!.textContent.includes('窗口访问已结束'));
  assert.equal(doc.querySelector<HTMLTextAreaElement>('#code')!.value, '');
  assert.equal(doc.getElementById('choices')!.hidden, false);
  assert.ok(credentials.beginRecovery('check-preserved', secondCode));
  click('修改 PIN'); await submit({ oldPin: '9753', pin: '8642', confirmation: '8642' });
  await credentials.verifyPin('8642');
  assert.equal(window.localStorage.length, 0);
  assert.equal(window.sessionStorage.length, 0);
  assert.ok(doc.body.textContent.includes('界面隐藏版'));
});
