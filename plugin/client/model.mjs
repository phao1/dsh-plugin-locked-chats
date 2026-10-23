/** UI filtering only: the Host's chat API is deliberately unchanged. */
export function visibleRows(catalog, hidden, archived, includeArchived = false) {
  return catalog.ids.map(id => catalog.byId[id]).filter(row => row && !hidden.has(row.id)
    && (includeArchived || !archived.has(row.id)) && row.origin !== 'subagent' && !row.blank);
}
export function visibleHits(items, hidden) { return items.filter(item => !hidden.has(item.sessionId)); }
const freshCredentialActions = new Set(['unlock', 'setup', 'beginRecovery', 'changePin', 'rotateRecovery']);
function windowEnded() {
  return Object.assign(new Error('窗口访问已结束，请重新验证或重新开始操作。'), { code: 'wrong_connection' });
}
export class PrivacyClient {
  state = { ready: false, ids: [], explicitIds: [], workspaceIds: [], configured: false, unlocked: false, error: '' };
  listeners = new Set(); windowToken = ''; accessToken = ''; opening = null; generation = 0; unlockAttempt = 0;
  constructor(fetcher = globalThis.fetch.bind(globalThis)) { this.fetcher = fetcher; }
  getSnapshot = () => this.state;
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  update(patch) { this.state = { ...this.state, ...patch }; for (const fn of this.listeners) fn(); }
  async call(action, values = {}, retryWindow = true) {
    const windowToken = this.windowToken, generation = this.generation;
    const response = await this.fetcher(new URL('api/locked-chats/credentials', globalThis.document?.baseURI ?? 'http://localhost/'), {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(windowToken ? { 'x-dsh-private-window': windowToken } : {}) },
      body: JSON.stringify({ action, ...values }),
    });
    const result = await response.json();
    if (!response.ok) {
      if (result.error === 'wrong_connection') {
        const currentWindow = generation === this.generation && windowToken === this.windowToken;
        if (currentWindow) {
          this.windowToken = ''; this.accessToken = ''; this.update({ unlocked: false });
        }
        // Only a fresh PIN/recovery verification may be retried. Never replay a
        // protected write or transfer a pending backup/recovery grant to a new window.
        if (retryWindow && freshCredentialActions.has(action) && currentWindow) {
          await this.window();
          return this.call(action, values, false);
        }
      } else if (['access_expired', 'access_denied'].includes(result.error)
        && windowToken === this.windowToken && values.accessToken === this.accessToken) {
        this.accessToken = ''; this.update({ unlocked: false });
      }
      const messages = { access_denied:'此操作需要有效的锁定聊天授权。',workspace_not_found: '此工作区已不存在，请刷新。', session_not_found: '此聊天已不存在，请刷新。', not_locked: '请先锁定此聊天。', unavailable: '功能暂不可用，请稍后重试。', invalid_recovery: '恢复码不正确或已失效。', stale_operation: '凭据已改变，请重新开始操作。', expired_operation: '操作已过期，请重新开始。', invalid_pin: 'PIN 不正确，请重试。', throttled: `尝试过多，请 ${result.retryAfterSeconds ?? 60} 秒后重试。`, backup_mismatch: '恢复码与备份不一致。', invalid_input: '请输入一致的 4 位数字 PIN。', access_expired: '访问已结束，请重新验证。', wrong_connection: windowEnded().message };
      const error = new Error(messages[result.error] ?? '操作失败，请刷新后重试。');
      error.code = result.error;
      throw error;
    }
    if (!['status', 'hiddenIds', 'openWindow', 'closeWindow'].includes(action)
      && (generation !== this.generation || windowToken !== this.windowToken)) throw windowEnded();
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
      if (!this.opening) {
        const generation = this.generation;
        const opening = this.call('openWindow').then(result => {
          if (generation !== this.generation) throw windowEnded();
          this.windowToken = result.windowToken;
        }).finally(() => { if (this.opening === opening) this.opening = null; });
        this.opening = opening;
      }
      await this.opening;
    }
  }
  async unlock(pin) {
    const attempt = ++this.unlockAttempt, generation = this.generation;
    await this.window();
    if (generation !== this.generation || attempt !== this.unlockAttempt) throw windowEnded();
    const result = await this.call('unlock', { pin });
    if (generation !== this.generation || attempt !== this.unlockAttempt) throw windowEnded();
    this.accessToken = result.accessToken; this.update({ unlocked: true });
  }
  async setHidden(sessionId, hidden) {
    const result = await this.call('setHidden', { sessionId, hidden, accessToken: this.accessToken });
    this.update(this.membership(result));
  }
  membership(result) {return {ids:result.ids||[],explicitIds:result.explicitIds||result.ids||[],workspaceIds:result.workspaceIds||[]};}
  async setWorkspaceHidden(workspaceId,hidden) {const result=await this.call('setWorkspaceHidden',{workspaceId,hidden,accessToken:this.accessToken});this.update(this.membership(result));}
  async lock() {
    this.unlockAttempt++;
    const token = this.accessToken; this.accessToken = ''; this.update({ unlocked: false });
    if (token) {
      try { await this.call('lock', { accessToken: token }); }
      catch (error) { if (!['wrong_connection', 'access_expired', 'access_denied'].includes(error.code)) throw error; }
    }
  }
  async pulse(foreground) {
    if (!this.accessToken) return;
    const accessToken = this.accessToken, windowToken = this.windowToken;
    try { await this.call('presence', { accessToken, foreground }); }
    catch { if (windowToken === this.windowToken && accessToken === this.accessToken) { this.accessToken = ''; this.update({ unlocked: false }); } }
  }
  close() {
    if (this.windowToken) void this.call('closeWindow').catch(() => {});
    this.generation++; this.unlockAttempt++; this.opening = null;
    this.accessToken = ''; this.windowToken = ''; this.update({ unlocked: false });
  }
}
