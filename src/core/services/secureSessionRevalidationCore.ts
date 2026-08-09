/**
 * Pure secure-session revalidation decision core (no React Native imports).
 */
import type { DriverSession } from './driverAuth';

export const VERIFY_DRIVER_SESSION_CALLABLE = 'verifyDriverSession';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidShape(value: string): boolean {
  return UUID_RE.test(value);
}

export function isSecureSessionShape(session: DriverSession): boolean {
  return (
    !!session.driverId &&
    session.passcodeHash === session.driverId &&
    isUuidShape(session.driverId)
  );
}

export type VerifyDriverSessionSuccess = {
  driverId: string;
  companyId: string;
  active: true;
};

export type TransportFailureClass = 'hard' | 'transport';

export function classifyCallableFailure(err: unknown): TransportFailureClass {
  const any = err as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
    status?: unknown;
  };
  const code = String(any?.code ?? '').toLowerCase();
  const msg = String(any?.message ?? '').toLowerCase();
  const name = String(any?.name ?? '');
  const status = typeof any?.status === 'number' ? any.status : undefined;

  if (
    code.includes('unauthenticated') ||
    code.includes('permission-denied') ||
    code.includes('invalid-argument') ||
    msg === 'unauthenticated' ||
    msg === 'not_authorized' ||
    msg === 'invalid_request' ||
    status === 401 ||
    status === 403
  ) {
    return 'hard';
  }
  if (
    name === 'AbortError' ||
    name === 'TypeError' ||
    code.includes('unavailable') ||
    code.includes('deadline') ||
    code.includes('resource-exhausted') ||
    code.includes('internal') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch') ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500)
  ) {
    return 'transport';
  }
  return 'hard';
}

export function parseVerifyDriverSessionResponse(
  raw: unknown,
): VerifyDriverSessionSuccess | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 3) return null;
  if (!('driverId' in o && 'companyId' in o && 'active' in o)) return null;
  if (typeof o.driverId !== 'string' || !o.driverId) return null;
  if (typeof o.companyId !== 'string' || !o.companyId) return null;
  if (o.active !== true) return null;
  return { driverId: o.driverId, companyId: o.companyId, active: true };
}

export type SecureRevalidationOps = {
  initializePersistentAuth(): void;
  waitForAuthReady(): Promise<void>;
  getSdkUid(): string | null;
  getVerifiedIdentity(forceRefresh: boolean): Promise<{
    uid: string;
    kind: string | null;
    driverId: string | null;
    companyId: string | null;
  } | null>;
  getIdToken(forceRefresh: boolean): Promise<string | null>;
  callVerifyDriverSession(idToken: string): Promise<unknown>;
  wasPreviouslyVerified(): Promise<boolean>;
  markVerified(): Promise<void>;
  hardFailCleanup(): Promise<void>;
};

export type SecureRevalidationResult =
  | { outcome: 'verified' }
  | { outcome: 'soft_offline' }
  | { outcome: 'hard_fail'; reason: string };

export async function revalidateSecureSession(
  session: DriverSession,
  ops: SecureRevalidationOps,
): Promise<SecureRevalidationResult> {
  if (!session.driverId || !session.companyId) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'missing_local_ids' };
  }

  try {
    ops.initializePersistentAuth();
    await ops.waitForAuthReady();
  } catch {
    const prior = await ops.wasPreviouslyVerified();
    if (prior) return { outcome: 'soft_offline' };
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'auth_init_failed' };
  }

  const uid = ops.getSdkUid();
  if (!uid) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'no_sdk_user' };
  }

  let identity: Awaited<ReturnType<SecureRevalidationOps['getVerifiedIdentity']>>;
  try {
    identity = await ops.getVerifiedIdentity(true);
  } catch (err) {
    if (classifyCallableFailure(err) === 'transport') {
      const prior = await ops.wasPreviouslyVerified();
      if (prior && ops.getSdkUid()) {
        return { outcome: 'soft_offline' };
      }
    }
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'claims_unavailable' };
  }

  if (!identity) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'no_identity' };
  }
  if (identity.kind !== 'driver') {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'wrong_kind' };
  }
  if (identity.driverId !== session.driverId) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'driver_mismatch' };
  }
  if (identity.companyId !== session.companyId) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'company_mismatch' };
  }
  if (identity.uid !== uid) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'uid_mismatch' };
  }

  let idToken: string | null;
  try {
    idToken = await ops.getIdToken(true);
  } catch (err) {
    if (classifyCallableFailure(err) === 'transport') {
      const prior = await ops.wasPreviouslyVerified();
      if (prior) return { outcome: 'soft_offline' };
    }
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'token_unavailable' };
  }
  if (!idToken) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'no_token' };
  }

  let raw: unknown;
  try {
    raw = await ops.callVerifyDriverSession(idToken);
  } catch (err) {
    if (classifyCallableFailure(err) === 'transport') {
      const prior = await ops.wasPreviouslyVerified();
      if (prior) return { outcome: 'soft_offline' };
      await ops.hardFailCleanup();
      return { outcome: 'hard_fail', reason: 'transport_unverified' };
    }
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'callable_refused' };
  }

  const parsed = parseVerifyDriverSessionResponse(raw);
  if (!parsed) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'malformed_response' };
  }
  if (parsed.driverId !== session.driverId || parsed.companyId !== session.companyId) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'response_mismatch' };
  }
  if (parsed.active !== true) {
    await ops.hardFailCleanup();
    return { outcome: 'hard_fail', reason: 'inactive' };
  }

  await ops.markVerified();
  return { outcome: 'verified' };
}
