/** UI filtering only: the Host's chat API is deliberately unchanged. */
export function visibleRows(catalog, hidden, archived, includeArchived = false) {
  return catalog.ids.map(id => catalog.byId[id]).filter(row => row && !hidden.has(row.id)
    && (includeArchived || !archived.has(row.id)) && row.origin !== 'subagent' && !row.blank);
}
export function visibleHits(items, hidden) { return items.filter(item => !hidden.has(item.sessionId)); }
export class PrivacyClient {
  state = { ready: false, ids: [], explicitIds: [], workspaceIds: [], configured: false, unlocked: false, error: '' };
  listeners = new Set(); windowToken = ''; accessToken = ''; opening = null;
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; }
  getSnapshot = () => this.state;
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  update(patch) { this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }
  async call(action, values = {}) {
    const response = await this.fetcher(new URL('api/locked-chats/credentials', globalThis.document?.baseURI ?? 'http://localhost/'), {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(this.windowToken ? { 'x-dsh-private-window': this.windowToken } : {}) },
      body: JSON.stringify({ action, ...values }),
    });
    const result = await response.json();
    if (!response.ok) {
      const messages = { access_denied:'此操作需要有效的锁定聊天授权。',workspace_not_found: '此工作区已不存在，请刷新。', session_not_found: '此聊天已不存在，请刷新。', not_locked: '请先锁定此聊天。', unavailable: '功能暂不可用，请稍后重试。', invalid_recovery: '恢复码不正确或已失效。', stale_operation: '凭据已改变，请重新开始操作。', expired_operation: '操作已过期，请重新开始。', invalid_pin: 'PIN 不正确，请重试。', throttled: `尝试过多，请 ${result.retryAfterSeconds ?? 60} 秒后重试。`, backup_mismatch: '恢复码与备份不一致。', invalid_input: '请输入一致的 4 位数字 PIN。', access_expired: '访问已结束，请重新验证。', wrong_connection: '窗口已过期，请刷新页面。' };
      const error = new Error(messages[result.error] ?? '操作失败，请刷新后重试。');
      error.code = result.error;
      throw error;
    }
    return result;
  }
  async refresh() {
    try {
      const [status, hidden] = await Promise.all([this.call('status'), this.call('hiddenIds')]);
      this.update({ ready: true, ...this.membership(hidden), configured: status.configured, error: '' });
    } catch (error) { this.accessToken = ''; this.update({ ready: false, unlocked: false, error: error.message }); }
  }
  async window() {
    if (!this.windowToken) {
      this.opening ??= this.call('openWindow').then(result => { this.windowToken = result.windowToken; }).finally(() => { this.opening = null; });
      await this.opening;
    }
  }
  async unlock(pin) { await this.window(); const result = await this.call('unlock', { pin }); this.accessToken = result.accessToken; this.update({ unlocked: true }); }
  async setHidden(sessionId, hidden) {
    const result = await this.call('setHidden', { sessionId, hidden, accessToken: this.accessToken });
    this.update(this.membership(result));
  }
  membership(result) {return {ids:result.ids||[],explicitIds:result.explicitIds||result.ids||[],workspaceIds:result.workspaceIds||[]};}
  async setWorkspaceHidden(workspaceId,hidden) {const result=await this.call('setWorkspaceHidden',{workspaceId,hidden,accessToken:this.accessToken});this.update(this.membership(result));}
  async lock() {
    const token = this.accessToken; this.accessToken = ''; this.update({ unlocked: false });
    if (token) await this.call('lock', { accessToken: token });
  }
  async pulse(foreground) {
    if (!this.accessToken) return;
    try { await this.call('presence', { accessToken: this.accessToken, foreground }); }
    catch { this.accessToken = ''; this.update({ unlocked: false }); }
  }
  close() {
    if (this.windowToken) void this.call('closeWindow').catch(() => {});
    this.accessToken = ''; this.windowToken = ''; this.update({ unlocked: false });
  }
}
