/** PIN and offline recovery workflow; adapters must supply their authenticated connection identity. */
import { randomUUID } from 'node:crypto';
import { CredentialStore, type CredentialState, type ThrottlePolicy } from './credential-store.ts';
import { LockError } from './errors.ts';
import { assertPin, canonicalRecoveryCode, createRecoveryCode, equalHash, pinVerifier,
  recoveryVerifier, type Verifier } from './secrets.ts';

/** Host-resolved deployment limits; no testing-only timing path. */
export interface CredentialPolicy extends ThrottlePolicy {
  recoveryLifetimeMs: number;
  maxPendingOperations: number;
}

interface Operation {
  connection: string;
  version: number;
  expiresAt: number;
}

interface PendingBackup extends Operation {
  pin: Verifier;
  recovery: Verifier;
}

/** Returned once, while the user is saving and confirming a new backup. */
export interface BackupChallenge {
  operationId: string;
  recoveryCode: string;
  expiresAt: number;
}

/** Credential changes revoke all consumers by increasing the durable version. */
export class Credentials {
  private readonly store: CredentialStore;
  private readonly backups = new Map<string, PendingBackup>();
  private readonly recoveryGrants = new Map<string, Operation>();
  private closed = false;
  private readonly policy: CredentialPolicy;
  private readonly clock: () => number;

  constructor(directory: string, policy: CredentialPolicy, clock: () => number = Date.now) {
    for (const value of [policy.attemptsPerWindow, policy.initialCooldownMs, policy.maxCooldownMs,
      policy.recoveryLifetimeMs, policy.maxPendingOperations]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new LockError('invalid_input');
    }
    if (policy.initialCooldownMs > policy.maxCooldownMs) throw new LockError('invalid_input');
    this.policy = Object.freeze({ ...policy });
    this.clock = clock;
    this.store = new CredentialStore(directory);
  }

  /** Non-sensitive status, not a vault list or a way to retrieve an existing backup. */
  status(): { configured: boolean; domain: string; version: number } {
    const state = this.store.read();
    return { configured: state.pin !== null, domain: state.domain, version: state.version };
  }

  /** Stage first-time enrollment; persistence occurs only after backup confirmation. */
  async setup(connection: string, pin: string): Promise<BackupChallenge> {
    const state = this.store.read();
    if (state.pin !== null) throw new LockError('already_configured');
    return this.stage(connection, state, await pinVerifier(pin));
  }

  /** Verify a daily PIN and return the exact version a content grant must be bound to. */
  async verifyPin(pin: string): Promise<number> {
    const state = this.configured();
    this.store.reserveAttempt('pin', state.version, this.clock(), this.policy);
    // Invalid syntax consumes a guess as well; it does not leak a different verification path.
    try { assertPin(pin); } catch (error) {
      if (error instanceof LockError) throw new LockError('invalid_pin');
      throw error;
    }
    const result = await pinVerifier(pin, state.pin.salt);
    if (!equalHash(result.hash, state.pin.hash)) throw new LockError('invalid_pin');
    this.store.completeAttempt('pin', state.version);
    return state.version;
  }

  /** Issue a short-lived credential-change grant, never a content-access grant. */
  beginRecovery(connection: string, input: string): { recoveryGrant: string; expiresAt: number } {
    this.checkCapacity();
    const state = this.configured();
    this.store.reserveAttempt('recovery', state.version, this.clock(), this.policy);
    const code = canonicalRecoveryCode(input, state.domain);
    if (!code || !equalHash(recoveryVerifier(code, state.domain, state.recovery.salt).hash, state.recovery.hash)) {
      throw new LockError('invalid_recovery');
    }
    this.store.completeAttempt('recovery', state.version);
    const grant = randomUUID();
    const expiresAt = this.clock() + this.policy.recoveryLifetimeMs;
    this.recoveryGrants.set(grant, { connection, version: state.version, expiresAt });
    return { recoveryGrant: grant, expiresAt };
  }

  /** Stage a replacement PIN and backup under the original recovery version. */
  async recover(connection: string, grant: string, newPin: string): Promise<BackupChallenge> {
    const operation = this.operation(this.recoveryGrants, connection, grant);
    const state = this.configured();
    const pin = await pinVerifier(newPin);
    this.operation(this.recoveryGrants, connection, grant);
    if (state.version !== operation.version) throw new LockError('stale_operation');
    return this.stage(connection, state, pin, operation.expiresAt);
  }

  /** Rotate a lost or exposed recovery code after fresh PIN verification. */
  async rotateRecovery(connection: string, pin: string): Promise<BackupChallenge> {
    const version = await this.verifyPin(pin);
    const state = this.configured();
    if (state.version !== version) throw new LockError('stale_operation');
    return this.stage(connection, state, state.pin);
  }

  /** Commit only the exact saved backup; cancellation never consumes the previous code. */
  confirmBackup(connection: string, operationId: string, input: string): { version: number } {
    const committed = this.store.committedVersion(operationId, connection);
    if (committed !== undefined) return { version: committed };
    const pending = this.operation(this.backups, connection, operationId);
    const state = this.store.read();
    const code = canonicalRecoveryCode(input, state.domain);
    if (!code || !equalHash(recoveryVerifier(code, state.domain, pending.recovery.salt).hash, pending.recovery.hash)) {
      throw new LockError('backup_mismatch');
    }
    const version = this.store.replace(pending.version, pending.pin, pending.recovery,
      operationId, connection, this.clock());
    this.clearPending();
    return { version };
  }

  /** Normal PIN changes retain the currently enrolled recovery credential. */
  async changePin(connection: string, oldPin: string, newPin: string): Promise<{ version: number }> {
    const expected = await this.verifyPin(oldPin);
    const state = this.configured();
    const pin = await pinVerifier(newPin);
    if (state.version !== expected) throw new LockError('stale_operation');
    const version = this.store.replace(expected, pin, state.recovery, randomUUID(), connection, this.clock());
    this.clearPending();
    return { version };
  }

  /** Remove only this connection's pending setup/recovery, leaving committed credentials intact. */
  cancel(connection: string, operationId: string): void {
    for (const map of [this.backups, this.recoveryGrants]) {
      const operation = map.get(operationId);
      if (operation && operation.connection !== connection) throw new LockError('wrong_connection');
      map.delete(operationId);
    }
  }

  /** Invalidate transient recovery authority on connection closure. */
  disconnect(connection: string): void {
    for (const map of [this.backups, this.recoveryGrants]) {
      for (const [id, operation] of map) if (operation.connection === connection) map.delete(id);
    }
  }

  /** Close storage and abandon all uncommitted recovery flows. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearPending();
    this.store.close();
  }

  private configured(): CredentialState & { pin: Verifier; recovery: Verifier } {
    const state = this.store.read();
    if (!state.pin || !state.recovery) throw new LockError('not_configured');
    return { ...state, pin: state.pin, recovery: state.recovery };
  }

  private stage(connection: string, state: CredentialState, pin: Verifier,
    expiresAt = this.clock() + this.policy.recoveryLifetimeMs): BackupChallenge {
    this.checkCapacity();
    if (this.store.read().version !== state.version) throw new LockError('stale_operation');
    if (expiresAt <= this.clock()) throw new LockError('expired_operation');
    const operationId = randomUUID();
    const recoveryCode = createRecoveryCode(state.domain);
    const recovery = recoveryVerifier(recoveryCode, state.domain);
    this.backups.set(operationId, { connection, version: state.version, pin, recovery, expiresAt });
    return { operationId, recoveryCode, expiresAt };
  }

  private operation<T extends Operation>(map: Map<string, T>, connection: string, id: string): T {
    if (this.closed) throw new LockError('closed');
    const op = map.get(id);
    if (!op || op.expiresAt <= this.clock()) {
      map.delete(id);
      throw new LockError('expired_operation');
    }
    if (op.connection !== connection) throw new LockError('wrong_connection');
    if (op.version !== this.store.read().version) throw new LockError('stale_operation');
    return op;
  }

  private checkCapacity(): void {
    if (this.closed) throw new LockError('closed');
    for (const map of [this.backups, this.recoveryGrants]) {
      for (const [id, op] of map) if (op.expiresAt <= this.clock()) map.delete(id);
    }
    if (this.backups.size + this.recoveryGrants.size >= this.policy.maxPendingOperations) {
      throw new LockError('too_many_operations');
    }
  }

  private clearPending(): void {
    this.backups.clear();
    this.recoveryGrants.clear();
  }
}
