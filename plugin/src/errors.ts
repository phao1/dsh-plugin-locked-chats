/** Public error codes contain no credential, user text or filesystem path. */
export type LockErrorCode =
  | 'invalid_pin' | 'invalid_recovery' | 'invalid_input' | 'not_configured'
  | 'already_configured' | 'throttled' | 'expired_operation' | 'stale_operation'
  | 'wrong_connection' | 'backup_mismatch' | 'too_many_operations'
  | 'session_not_found' | 'workspace_not_found'
  | 'storage_invalid' | 'closed' | 'access_denied' | 'access_expired';

/** Controlled failures suitable for mapping to locale-owned UI messages. */
export class LockError extends Error {
  readonly code: LockErrorCode;
  readonly retryAfterSeconds: number;

  constructor(code: LockErrorCode, retryAfterSeconds = 0) {
    super(code);
    this.name = 'LockError';
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
