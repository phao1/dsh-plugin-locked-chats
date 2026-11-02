/** Host plugin entry. Credential endpoints do not claim to protect dsh chats by themselves. */
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import Schema from '@deepseek-ai/schemastery';
import { Credentials } from './credentials.ts';
import { AccessGrants } from './access-grants.ts';
import { CredentialApi } from './api.ts';
import { settingsPage } from './settings-page.ts';
import { HiddenChats } from './hidden-chats.ts';
import { WorkspaceLocks, type WorkspaceLockHost, type LockSessionHeader } from './workspace-locks.ts';
import { IsolatedMemory, registerMemoryTools, type MemoryHost } from './memory-isolation.ts';

export const name = 'locked-chats';
export const inject = ['connection', 'workspaceRegistry', 'sessions', 'sessionPersistence', 'tools', 'systemPrompt'];

/** Protection-domain location and user-facing lifecycle limits. */
export interface Config {
  directory: string;
  attemptsPerWindow: number;
  initialCooldownMs: number;
  maxCooldownMs: number;
  recoveryLifetimeMs: number;
  maxPendingOperations: number;
  awayTimeoutMs: number;
  connectionLeaseMs: number;
  maxGrants: number;
  maxRequestBytes: number;
  maxWindows: number;
  windowLifetimeMs: number;
  sweepIntervalMs: number;
}

export const Config: Schema<Config> = Schema.object({
  directory: Schema.string().required(),
  attemptsPerWindow: Schema.natural().min(1).default(5),
  initialCooldownMs: Schema.natural().min(1).default(60_000),
  maxCooldownMs: Schema.natural().min(1).default(900_000),
  recoveryLifetimeMs: Schema.natural().min(1).default(300_000),
  maxPendingOperations: Schema.natural().min(1).default(64),
  awayTimeoutMs: Schema.natural().min(1).default(60_000),
  connectionLeaseMs: Schema.natural().min(1).default(60_000),
  maxGrants: Schema.natural().min(1).default(64),
  maxRequestBytes: Schema.natural().min(1024).default(16_384),
  maxWindows: Schema.natural().min(1).default(64),
  windowLifetimeMs: Schema.natural().min(1).default(600_000),
  sweepIntervalMs: Schema.natural().min(1).default(1000),
});

/** Register the owner-only credential API and release transport before closing storage. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  // Cordis unloads sibling effects concurrently. One ordered effect keeps every
  // transport/tool detached before its backing SQLite stores are closed.
  await ctx.effect(async function* () {
    const credentials = new Credentials(config.directory, config);
    yield () => credentials.close();
    const grants = new AccessGrants(config, () => credentials.status().version);
    yield () => grants.close();
    const hidden = new HiddenChats(config.directory);
    yield () => hidden.close();
    const host = ctx as unknown as WorkspaceLockHost & MemoryHost & {
      on(event: 'session/created', listener: (session: {header: LockSessionHeader}) => void): () => void;
    };
    const locks = new WorkspaceLocks(hidden, {
      workspaceRegistry: host.workspaceRegistry, sessions: host.sessions, sessionPersistence: host.sessionPersistence,
    });
    const memory = new IsolatedMemory(config.directory, id => locks.isLockedId(id));
    yield () => memory.close();
    const api = new CredentialApi(credentials, grants, config, hidden, locks);
    yield () => api.close();
    // Observe creation before asynchronous listing. Live headers are available
    // before session/created and may be needed by a new descendant during refresh.
    yield host.on('session/created', session => locks.observeHeader(session.header));
    await locks.refresh();
    const timer = setInterval(() => {
      try { api.sweep(); } catch {
        // All grants have already been revoked. Retain no sensitive exception in diagnostic logs.
        ctx.logger.warn('locked-chats: credential storage unavailable; access revoked');
      }
    }, config.sweepIntervalMs);
    timer.unref();
    yield () => { clearInterval(timer); };
    yield registerMemoryTools(host, memory);
    yield ctx.connection.fetch.register({ path: '/api/locked-chats/credentials', methods: ['POST'],
      requestBody: 'streaming', fetch: request => api.fetch(request) });
    yield ctx.connection.fetch.register({ path: '/api/locked-chats/settings', methods: ['GET'],
      requestBody: 'buffered', fetch: async request => settingsPage(request) });
  }, 'locked-chats: ordered storage and transport lifecycle');
}
