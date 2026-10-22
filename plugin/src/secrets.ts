/** Credential encoding and verification; no encryption of chat files is implied. */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { base32nopad } from '@scure/base';
import { LockError } from './errors.ts';

/** Parameters travel with PIN records so incompatible records fail closed. */
export const PIN_ALGORITHM = 'scrypt-n16384-r8-p1-32-v1';

/** Salt and verifier are safe to persist; neither is a usable recovery code. */
export interface Verifier { salt: string; hash: string }

/** Reject non-ASCII digits and implicit trimming at the user-input boundary. */
export function assertPin(pin: string): void {
  if (!/^[0-9]{4}$/.test(pin)) throw new LockError('invalid_input');
}

/** Derive a PIN verifier without occupying the JavaScript event loop. */
export async function pinVerifier(pin: string, salt = randomBytes(16).toString('hex')): Promise<Verifier> {
  assertPin(pin);
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(pin, Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, result) => error ? reject(error) : resolve(result));
  });
  const hash = key.toString('hex');
  key.fill(0);
  return { salt, hash };
}

/** Compare fixed-size hex verifiers without a content-dependent comparison. */
export function equalHash(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Create an independent 256-bit bearer recovery credential, scoped to one domain. */
export function createRecoveryCode(domain: string): string {
  const secret = base32nopad.encode(randomBytes(32));
  const body = `DSHR1:${domain}:${secret}`;
  return `${body}:${digest(body).slice(0, 8)}`;
}

/** Canonical input accepts surrounding whitespace and Base32 letter case only. */
export function canonicalRecoveryCode(input: string, domain: string): string | undefined {
  if (input.length > 256) return undefined;
  const parts = input.trim().split(':');
  if (parts.length !== 4 || parts[0] !== 'DSHR1' || parts[1] !== domain) return undefined;
  const secret = parts[2]?.toUpperCase();
  if (!secret || !/^[A-Z2-7]{52}$/.test(secret)) return undefined;
  try {
    if (base32nopad.decode(secret).length !== 32) return undefined;
  } catch {
    // A malformed encoded credential is an invalid input, never a recovery attempt success.
    return undefined;
  }
  const body = `DSHR1:${domain}:${secret}`;
  if (parts[3]?.toLowerCase() !== digest(body).slice(0, 8)) return undefined;
  return `${body}:${digest(body).slice(0, 8)}`;
}

/** A high-entropy recovery code uses a salted, domain-separated one-way verifier. */
export function recoveryVerifier(code: string, domain: string, salt = randomBytes(16).toString('hex')): Verifier {
  return { salt, hash: digest(`dsh-locked-chats/recovery/v1\0${domain}\0${salt}\0${code}`) };
}
