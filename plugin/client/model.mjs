import {createTranslator,en} from '../src/locales.ts';
/** UI filtering only: the Host's chat API is deliberately unchanged. */
export function visibleRows(catalog, hidden, archived, includeArchived = false) {
  return catalog.ids.map(id => catalog.byId[id]).filter(row => row && !hidden.has(row.id)
    && (includeArchived || !archived.has(row.id)) && row.origin !== 'subagent' && !row.blank);
}
export function visibleHits(items, hidden) { return items.filter(item => !hidden.has(item.sessionId)); }
const freshCredentialActions = new Set(['unlock', 'setup', 'beginRecovery', 'changePin', 'rotateRecovery']);
function windowEnded(t) {
  return Object.assign(new Error(t('error.wrong_connection')), { code: 'wrong_connection' });
}
export class PrivacyClient {
  state = { ready: false, ids: [], explicitIds: [], workspaceIds: [], configured: false, unlocked: false, error: '' };
  listeners = new Set(); windowToken = ''; accessToken = ''; opening = null; generation = 0; unlockAttempt = 0;
  constructor(fetcher = globalThis.fetch.bind(globalThis), t=createTranslator('en')) { this.fetcher = fetcher; this.t=t; }
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
      const key=Object.hasOwn(en,`error.${result.error}`)?`error.${result.error}`:'operationFailed';
      const error = new Error(this.t(key,{seconds:result.retryAfterSeconds??60}));
      error.retryAfterSeconds=result.retryAfterSeconds??60;
      error.code = result.error;
      throw error;
    }
    if (!['status', 'hiddenIds', 'openWindow', 'closeWindow'].includes(action)
      && (generation !== this.generation || windowToken !== this.windowToken)) throw windowEnded(this.t);
    return result;
  }
  async refresh() {
    try {
      const [status, hidden] = await Promise.all([this.call('status'), this.call('hiddenIds')]);
      this.update({ ready: true, ...this.membership(hidden), configured: status.configured, error: '' });
    } catch (error) { this.accessToken = ''; this.update({ ready: false, unlocked: false, error }); }
  }
  async window() {
    if (!this.windowToken) {
      if (!this.opening) {
        const generation = this.generation;
        const opening = this.call('openWindow').then(result => {
          if (generation !== this.generation) throw windowEnded(this.t);
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
    if (generation !== this.generation || attempt !== this.unlockAttempt) throw windowEnded(this.t);
    const result = await this.call('unlock', { pin });
    if (generation !== this.generation || attempt !== this.unlockAttempt) throw windowEnded(this.t);
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
