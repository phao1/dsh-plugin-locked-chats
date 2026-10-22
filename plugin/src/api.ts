/** Dedicated user-initiated credential API; secrets never enter model-tool arguments. */
import { randomBytes } from 'node:crypto';
import { Credentials } from './credentials.ts';
import { AccessGrants } from './access-grants.ts';
import { LockError } from './errors.ts';
import type { WorkspaceLocks } from './workspace-locks.ts';
import type { HiddenChats } from './hidden-chats.ts';

interface WindowConnection { expiresAt: number }

/** Bounds apply before JSON parsing, and window handles remain process-local. */
export interface ApiPolicy {
  maxRequestBytes: number;
  maxWindows: number;
  windowLifetimeMs: number;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new LockError('invalid_input');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') throw new LockError('invalid_input');
  return value;
}

function matchingPin(input: Record<string, unknown>): string {
  const pin = string(input.pin);
  if (pin !== string(input.confirmation)) throw new LockError('invalid_input');
  return pin;
}

/** Transport adapters must mount this only beneath the Host's authenticated owner route. */
export class CredentialApi {
  private readonly credentials: Credentials;
  private readonly grants: AccessGrants;
  private readonly windows = new Map<string, WindowConnection>();
  private readonly policy: ApiPolicy;
  private closed = false;
  private readonly hidden: HiddenChats | undefined;
  private readonly locks: WorkspaceLocks | undefined;

  constructor(credentials: Credentials, grants: AccessGrants, policy: ApiPolicy, hidden?: HiddenChats, locks?: WorkspaceLocks) {
    this.locks = locks;
    this.hidden = hidden;
    this.credentials = credentials;
    this.grants = grants;
    this.policy = Object.freeze({ ...policy });
  }

  /** Handle one bounded JSON command after Host authentication and origin checks. */
  async fetch(request: Request): Promise<Response> {
    try {
      if (this.closed) throw new LockError('closed');
      if (request.method !== 'POST'
        || request.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json') {
        return this.response({ error: 'invalid_input' }, 400);
      }
      const input = await this.read(request);
      const action = string(input.action);
      if (action === 'status') {
        return this.response({ ...this.credentials.status(), chatProtectionReady: false, uiHidingReady: this.hidden !== undefined });
      }
      // IDs are used to filter the ordinary UI, not a security boundary. No titles are stored here.
      if (action === 'hiddenIds' && this.hidden) return this.response(this.locks ? await this.locks.snapshot() : { ids: this.hidden.list(), explicitIds:this.hidden.list(), workspaceIds:[] });
      this.sweep();
      if (action === 'openWindow') {
        if (this.windows.size >= this.policy.maxWindows) throw new LockError('too_many_operations');
        const windowToken = randomBytes(32).toString('base64url');
        this.windows.set(windowToken, { expiresAt: Date.now() + this.policy.windowLifetimeMs });
        return this.response({ windowToken });
      }
      const connection = request.headers.get('x-dsh-private-window');
      const window = connection ? this.windows.get(connection) : undefined;
      if (!connection || !window) throw new LockError('wrong_connection');
      window.expiresAt = Date.now() + this.policy.windowLifetimeMs;
      let result: unknown;
      switch (action) {
        case 'setHidden': {
          if (!this.hidden || typeof input.hidden !== 'boolean') throw new LockError('invalid_input');
          this.grants.authorize(connection, string(input.accessToken));
          this.hidden.set(string(input.sessionId), input.hidden);
          result = this.locks ? await this.locks.snapshot() : { ids: this.hidden.list(), explicitIds:this.hidden.list(), workspaceIds:[] };
          break;
        }
        case 'setWorkspaceHidden': {
          if(!this.locks || typeof input.hidden!=='boolean')throw new LockError('invalid_input');
          this.grants.authorize(connection,string(input.accessToken));
          this.locks.setWorkspace(string(input.workspaceId),input.hidden);
          result=await this.locks.snapshot();break;
        }
        case 'setup': result = await this.credentials.setup(connection, matchingPin(input)); break;
        case 'confirmBackup':
          result = this.credentials.confirmBackup(connection, string(input.operationId), string(input.recoveryCode));
          this.grants.invalidateAll();
          break;
        case 'unlock': {
          const version = await this.credentials.verifyPin(string(input.pin));
          // PIN hashing yields: a closed or expired window must not acquire a new grant afterward.
          if (this.closed || this.windows.get(connection) !== window || window.expiresAt <= Date.now()) {
            throw new LockError('wrong_connection');
          }
          result = { accessToken: this.grants.issue(connection, version), version };
          break;
        }
        case 'beginRecovery': result = this.credentials.beginRecovery(connection, string(input.recoveryCode)); break;
        case 'recover': result = await this.credentials.recover(connection, string(input.recoveryGrant), matchingPin(input)); break;
        case 'rotateRecovery': result = await this.credentials.rotateRecovery(connection, string(input.pin)); break;
        case 'changePin':
          result = await this.credentials.changePin(connection, string(input.oldPin), matchingPin(input));
          this.grants.invalidateAll();
          break;
        case 'cancel': this.credentials.cancel(connection, string(input.operationId)); result = {}; break;
        case 'presence':
          if (typeof input.foreground !== 'boolean') throw new LockError('invalid_input');
          this.grants.presence(connection, string(input.accessToken), input.foreground);
          result = {};
          break;
        case 'lock': this.grants.lock(connection, string(input.accessToken)); result = {}; break;
        case 'closeWindow': this.disconnect(connection); result = {}; break;
        default: throw new LockError('invalid_input');
      }
      return this.response(result);
    } catch (error) {
      if (error instanceof LockError) return this.response({ error: error.code, retryAfterSeconds: error.retryAfterSeconds },
        error.code === 'throttled' ? 429 : error.code === 'invalid_input' ? 400 : 403);
      // Unknown storage or parser failures carry neither exception text nor paths to the browser.
      return this.response({ error: 'unavailable' }, 503);
    }
  }

  /** Expire abandoned browser windows and continuously revoke stale stream signals. */
  sweep(): void {
    for (const [token, connection] of this.windows) if (connection.expiresAt <= Date.now()) this.disconnect(token);
    this.grants.sweep();
  }

  /** Dispose the adapter before its credential store is closed. */
  close(): void {
    this.closed = true;
    for (const token of this.windows.keys()) this.disconnect(token);
  }

  private disconnect(token: string): void {
    this.windows.delete(token);
    this.credentials.disconnect(token);
    this.grants.disconnect(token);
  }

  private async read(request: Request): Promise<Record<string, unknown>> {
    if (!request.body) throw new LockError('invalid_input');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > this.policy.maxRequestBytes) {
          await reader.cancel();
          throw new LockError('invalid_input');
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    try { return record(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) {
      if (error instanceof SyntaxError) throw new LockError('invalid_input');
      throw error;
    }
  }

  private response(value: unknown, status = 200): Response {
    return Response.json(value, { status, headers: { 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' } });
  }
}
