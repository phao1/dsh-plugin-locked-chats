/** SQLite owns cross-process credential revisions and persistent attempt counters. */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LockError } from './errors.ts';
import { PIN_ALGORITHM, type Verifier } from './secrets.ts';

/** One storage root has one durable privacy credential domain. */
export interface CredentialState {
  domain: string;
  version: number;
  pin: Verifier | null;
  recovery: Verifier | null;
}

/** Deployment parameters for attempts, not cryptographic algorithm choices. */
export interface ThrottlePolicy {
  attemptsPerWindow: number;
  initialCooldownMs: number;
  maxCooldownMs: number;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new LockError('storage_invalid');
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new LockError('storage_invalid');
  }
  return value;
}

function verifier(salt: unknown, hash: unknown): Verifier {
  if (typeof salt !== 'string' || !/^[0-9a-f]{32}$/.test(salt)
    || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
    throw new LockError('storage_invalid');
  }
  return { salt, hash };
}

/** No chat data is stored here; every credential replacement is one SQLite transaction. */
export class CredentialStore {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(directory: string) {
    if (!isAbsolute(directory)) throw new LockError('invalid_input');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, 'credentials.sqlite');
    this.db = new DatabaseSync(path);
    try {
      chmodSync(path, 0o600);
      this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
      const schema = this.db.prepare('PRAGMA user_version').get();
      const version = integer(schema?.user_version);
      if (version !== 0 && version !== 1) throw new LockError('storage_invalid');
      this.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS credential (
            id INTEGER PRIMARY KEY CHECK (id = 1), domain TEXT NOT NULL,
            version INTEGER NOT NULL, algorithm TEXT NOT NULL,
            pin_salt TEXT, pin_hash TEXT, recovery_salt TEXT, recovery_hash TEXT
          );
          CREATE TABLE IF NOT EXISTS attempts (
            kind TEXT PRIMARY KEY, count INTEGER NOT NULL, blocked_until INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS committed (
            id TEXT PRIMARY KEY, connection TEXT NOT NULL, version INTEGER NOT NULL,
            committed_at INTEGER NOT NULL
          );
        `);
        if (version === 0) {
          this.db.prepare('INSERT INTO credential VALUES (1, ?, 0, ?, NULL, NULL, NULL, NULL)')
            .run(randomUUID(), PIN_ALGORITHM);
          this.db.exec('PRAGMA user_version = 1');
        }
        this.read();
      });
    } catch (error) {
      this.db.close();
      this.closed = true;
      throw error;
    }
  }

  /** Read current committed state; malformed or missing records never mean unconfigured. */
  read(): CredentialState {
    this.assertOpen();
    const row = this.db.prepare('SELECT * FROM credential WHERE id = 1').get();
    if (!row || row.algorithm !== PIN_ALGORITHM) throw new LockError('storage_invalid');
    const domain = text(row.domain);
    if (!/^[0-9a-f-]{36}$/.test(domain)) throw new LockError('storage_invalid');
    const version = integer(row.version);
    if (version === 0) {
      if ([row.pin_salt, row.pin_hash, row.recovery_salt, row.recovery_hash].some(v => v !== null)) {
        throw new LockError('storage_invalid');
      }
      return { domain, version, pin: null, recovery: null };
    }
    return { domain, version, pin: verifier(row.pin_salt, row.pin_hash),
      recovery: verifier(row.recovery_salt, row.recovery_hash) };
  }

  /** Reserve an attempt before expensive verification, bounding simultaneous guesses. */
  reserveAttempt(kind: 'pin' | 'recovery', version: number, now: number, policy: ThrottlePolicy): void {
    this.transaction(() => {
      if (this.read().version !== version) throw new LockError('stale_operation');
      const row = this.db.prepare('SELECT count, blocked_until FROM attempts WHERE kind = ?').get(kind);
      const count = row ? integer(row.count) : 0;
      const until = row ? integer(row.blocked_until) : 0;
      if (until > now) throw new LockError('throttled', Math.ceil((until - now) / 1000));
      const nextCount = count + 1;
      const atLimit = nextCount % policy.attemptsPerWindow === 0;
      const multiplier = 2 ** Math.min(30, Math.floor(nextCount / policy.attemptsPerWindow) - 1);
      const nextUntil = atLimit ? now + Math.min(policy.maxCooldownMs, policy.initialCooldownMs * multiplier) : until;
      this.db.prepare('INSERT OR REPLACE INTO attempts VALUES (?, ?, ?)').run(kind, nextCount, nextUntil);
    });
  }

  /** A successful attempt clears only its own entry and only under the same revision. */
  completeAttempt(kind: 'pin' | 'recovery', version: number): void {
    this.transaction(() => {
      if (this.read().version !== version) throw new LockError('stale_operation');
      this.db.prepare('DELETE FROM attempts WHERE kind = ?').run(kind);
    });
  }

  /** Return a retry receipt; an operation identifier confers no content access. */
  committedVersion(operationId: string, connection: string): number | undefined {
    this.assertOpen();
    const row = this.db.prepare('SELECT connection, version FROM committed WHERE id = ?').get(operationId);
    if (!row) return undefined;
    if (row.connection !== connection) throw new LockError('wrong_connection');
    return integer(row.version);
  }

  /** CAS couples the new PIN, recovery verifier, revision and idempotent receipt. */
  replace(expected: number, pin: Verifier, recovery: Verifier, operationId: string,
    connection: string, now: number): number {
    return this.transaction(() => {
      const existing = this.committedVersion(operationId, connection);
      if (existing !== undefined) return existing;
      if (this.read().version !== expected) throw new LockError('stale_operation');
      const version = expected + 1;
      this.db.prepare(`UPDATE credential SET version = ?, pin_salt = ?, pin_hash = ?,
        recovery_salt = ?, recovery_hash = ? WHERE id = 1`)
        .run(version, pin.salt, pin.hash, recovery.salt, recovery.hash);
      this.db.prepare('INSERT INTO committed VALUES (?, ?, ?, ?)').run(operationId, connection, version, now);
      this.db.exec('DELETE FROM attempts');
      return version;
    });
  }

  /** Teardown settles synchronously; reopening never restores in-memory authorizations. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  private assertOpen(): void {
    if (this.closed) throw new LockError('closed');
  }

  private transaction<T>(work: () => T): T {
    this.assertOpen();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (rollbackError) {
        // Unknown storage state cannot be reused for verification or initialization.
        this.close();
        throw new AggregateError([error, rollbackError], 'credential transaction unavailable');
      }
      throw error;
    }
  }
}
