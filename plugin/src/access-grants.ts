/** Window access is transient; protecting a chat is separate durable state. */
import { randomBytes } from 'node:crypto';
import { LockError } from './errors.ts';

/** An adapter supplies an authenticated, independently established window connection. */
interface Grant {
  connection: string;
  credentialVersion: number;
  leaseUntil: number;
  awayAt: number | null;
  controller: AbortController;
}

/** Disconnect leases bound forgotten clients even if their blur notification never arrives. */
export interface AccessPolicy {
  awayTimeoutMs: number;
  connectionLeaseMs: number;
  maxGrants: number;
}

/** All content streams must check the grant and use its signal throughout transmission. */
export class AccessGrants {
  private readonly grants = new Map<string, Grant>();
  private readonly policy: AccessPolicy;
  private readonly currentVersion: () => number;
  private readonly clock: () => number;
  private closed = false;

  constructor(policy: AccessPolicy, currentVersion: () => number, clock: () => number = Date.now) {
    for (const value of [policy.awayTimeoutMs, policy.connectionLeaseMs, policy.maxGrants]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new LockError('invalid_input');
    }
    this.policy = Object.freeze({ ...policy });
    this.currentVersion = currentVersion;
    this.clock = clock;
  }

  /** Call only with the committed revision returned by successful PIN verification. */
  issue(connection: string, verifiedVersion: number): string {
    this.assertOpen();
    this.sweep();
    if (verifiedVersion < 1 || verifiedVersion !== this.currentVersion()) throw new LockError('stale_operation');
    this.disconnect(connection);
    if (this.grants.size >= this.policy.maxGrants) throw new LockError('too_many_operations');
    const token = randomBytes(32).toString('base64url');
    this.grants.set(token, { connection, credentialVersion: verifiedVersion,
      leaseUntil: this.clock() + this.policy.connectionLeaseMs, awayAt: null, controller: new AbortController() });
    return token;
  }

  /** A grant copied into a different connection does not authorize that connection. */
  authorize(connection: string, token: string): AbortSignal {
    this.assertOpen();
    const grant = this.grants.get(token);
    if (!grant || grant.connection !== connection) throw new LockError('access_denied');
    let valid: boolean;
    try { valid = this.valid(grant); } catch (error) {
      this.invalidateAll();
      throw error;
    }
    if (!valid) {
      this.revoke(token);
      throw new LockError('access_expired');
    }
    return grant.controller.signal;
  }

  /** Presence pulses renew transport liveness; returning after the deadline never revives access. */
  presence(connection: string, token: string, foreground: boolean): void {
    this.authorize(connection, token);
    const grant = this.grants.get(token);
    if (!grant) throw new LockError('access_denied');
    grant.leaseUntil = this.clock() + this.policy.connectionLeaseMs;
    grant.awayAt = foreground ? null : (grant.awayAt ?? this.clock());
  }

  /** End only this connection's viewing permission; no protection record is changed. */
  lock(connection: string, token: string): void {
    const grant = this.grants.get(token);
    if (!grant) return;
    if (grant.connection !== connection) throw new LockError('access_denied');
    this.revoke(token);
  }

  /** Revoke the signals used by downloads, event subscriptions and history reads. */
  disconnect(connection: string): void {
    for (const [token, grant] of this.grants) if (grant.connection === connection) this.revoke(token);
  }

  /** The Host lifecycle calls this periodically and after any credential revision change. */
  sweep(): void {
    this.assertOpen();
    try {
      for (const [token, grant] of this.grants) if (!this.valid(grant)) this.revoke(token);
    } catch (error) {
      // A broken credential store cannot leave previously authorized streams running.
      this.invalidateAll();
      throw error;
    }
  }

  /** Credential changes and provider disposal immediately end all local access. */
  invalidateAll(): void {
    for (const token of this.grants.keys()) this.revoke(token);
  }

  /** Teardown never persists a token or leaves a subscribed stream authorized. */
  close(): void {
    if (this.closed) return;
    this.invalidateAll();
    this.closed = true;
  }

  private valid(grant: Grant): boolean {
    const now = this.clock();
    return grant.credentialVersion === this.currentVersion() && now < grant.leaseUntil
      && (grant.awayAt === null || now < grant.awayAt + this.policy.awayTimeoutMs);
  }

  private revoke(token: string): void {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    grant?.controller.abort(new LockError('access_expired'));
  }

  private assertOpen(): void {
    if (this.closed) throw new LockError('closed');
  }
}
