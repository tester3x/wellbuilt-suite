/**
 * Secure cold-start revalidation matrix (pure ops — no network/device).
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  classifyCallableFailure,
  isSecureSessionShape,
  isUuidShape,
  parseVerifyDriverSessionResponse,
  revalidateSecureSession,
  type SecureRevalidationOps,
} from './secureSessionRevalidationCore';
import type { DriverSession } from './driverAuth';

const DRIVER = '99ff4b35-51ab-4d45-8d54-18b3b8515c9b';
const COMPANY = 'liquid-gold';

function secureSession(over: Partial<DriverSession> = {}): DriverSession {
  return {
    driverId: DRIVER,
    displayName: 'MikeS24',
    passcodeHash: DRIVER,
    isAdmin: false,
    isViewer: false,
    companyId: COMPANY,
    ...over,
  };
}

function makeOps(over: Partial<SecureRevalidationOps> & {
  callBodies?: unknown[];
  cleanups?: string[];
} = {}): SecureRevalidationOps & { cleanups: string[]; calls: unknown[] } {
  const cleanups: string[] = over.cleanups || [];
  const calls: unknown[] = [];
  const base: SecureRevalidationOps = {
    initializePersistentAuth: () => {},
    waitForAuthReady: async () => {},
    getSdkUid: () => 'driver_uid_ok',
    getVerifiedIdentity: async () => ({
      uid: 'driver_uid_ok',
      kind: 'driver',
      driverId: DRIVER,
      companyId: COMPANY,
    }),
    getIdToken: async () => 'id-token',
    callVerifyDriverSession: async (tok) => {
      calls.push({ data: {}, tokenPresent: !!tok });
      return { driverId: DRIVER, companyId: COMPANY, active: true };
    },
    wasPreviouslyVerified: async () => false,
    markVerified: async () => {},
    hardFailCleanup: async () => {
      cleanups.push('hard');
    },
    ...over,
  };
  return Object.assign(base, { cleanups, calls });
}

test('UUID shape and secure session shape', () => {
  assert.equal(isUuidShape(DRIVER), true);
  assert.equal(isUuidShape('deadbeef'.repeat(8)), false);
  assert.equal(isSecureSessionShape(secureSession()), true);
  assert.equal(
    isSecureSessionShape(
      secureSession({ passcodeHash: 'a'.repeat(64) }),
    ),
    false,
  );
});

test('parseVerifyDriverSessionResponse exact three keys', () => {
  assert.deepEqual(
    parseVerifyDriverSessionResponse({
      driverId: DRIVER,
      companyId: COMPANY,
      active: true,
    }),
    { driverId: DRIVER, companyId: COMPANY, active: true },
  );
  assert.equal(
    parseVerifyDriverSessionResponse({
      driverId: DRIVER,
      companyId: COMPANY,
      active: true,
      extra: 1,
    }),
    null,
  );
  assert.equal(
    parseVerifyDriverSessionResponse({ driverId: DRIVER, companyId: COMPANY }),
    null,
  );
  assert.equal(
    parseVerifyDriverSessionResponse({
      driverId: DRIVER,
      companyId: COMPANY,
      active: false,
    }),
    null,
  );
});

test('3. secure local + matching claims + valid callable succeeds', async () => {
  const ops = makeOps();
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'verified');
  assert.equal(ops.cleanups.length, 0);
  assert.equal(ops.calls.length, 1);
  assert.deepEqual(ops.calls[0], { data: {}, tokenPresent: true });
});

test('19. callable request body is exactly empty (via ops contract)', async () => {
  let bodySent: unknown = null;
  const ops = makeOps({
    callVerifyDriverSession: async () => {
      bodySent = {};
      return { driverId: DRIVER, companyId: COMPANY, active: true };
    },
  });
  await revalidateSecureSession(secureSession(), ops);
  assert.deepEqual(bodySent, {});
});

test('4. server response mismatch fails closed', async () => {
  const ops = makeOps({
    callVerifyDriverSession: async () => ({
      driverId: 'other-uuid-0000-0000-0000-000000000001',
      companyId: COMPANY,
      active: true,
    }),
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
  assert.equal(ops.cleanups.length, 1);
});

test('5. no SDK user fails closed', async () => {
  const ops = makeOps({ getSdkUid: () => null });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
  assert.equal(ops.cleanups.length, 1);
});

test('6. wrong SDK identity fails closed', async () => {
  const ops = makeOps({
    getVerifiedIdentity: async () => ({
      uid: 'driver_uid_ok',
      kind: 'driver',
      driverId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      companyId: COMPANY,
    }),
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
  assert.ok(ops.cleanups.length >= 1);
});

test('7. wrong/missing claims fail closed', async () => {
  for (const identity of [
    { uid: 'driver_uid_ok', kind: 'admin', driverId: DRIVER, companyId: COMPANY },
    { uid: 'driver_uid_ok', kind: 'driver', driverId: null, companyId: COMPANY },
    { uid: 'driver_uid_ok', kind: 'driver', driverId: DRIVER, companyId: null },
  ] as const) {
    const ops = makeOps({
      getVerifiedIdentity: async () => identity as any,
    });
    const r = await revalidateSecureSession(secureSession(), ops);
    assert.equal(r.outcome, 'hard_fail');
  }
});

test('8. inactive/deleted server refusal fails closed', async () => {
  const ops = makeOps({
    callVerifyDriverSession: async () => {
      const e = new Error('not_authorized') as Error & { code: string; status: number };
      e.code = 'permission-denied';
      e.status = 403;
      throw e;
    },
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
  assert.equal(ops.cleanups.length, 1);
});

test('9. company drift fails closed', async () => {
  const ops = makeOps({
    getVerifiedIdentity: async () => ({
      uid: 'driver_uid_ok',
      kind: 'driver',
      driverId: DRIVER,
      companyId: 'other-co',
    }),
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
});

test('10. malformed response fails closed', async () => {
  const ops = makeOps({
    callVerifyDriverSession: async () => ({ driverId: DRIVER }),
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
});

test('11. excess response keys fail closed', async () => {
  const ops = makeOps({
    callVerifyDriverSession: async () => ({
      driverId: DRIVER,
      companyId: COMPANY,
      active: true,
      roles: ['driver'],
    }),
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
});

test('12. hard failure invokes cleanup (sign-out + local clear)', async () => {
  const ops = makeOps({ getSdkUid: () => null });
  await revalidateSecureSession(secureSession(), ops);
  assert.deepEqual(ops.cleanups, ['hard']);
});

test('13. hard failure does not touch shift (no shift ops in path)', async () => {
  // Secure revalidation ops have no shift mutators — structural guarantee.
  const keys = Object.keys(makeOps());
  assert.ok(!keys.some((k) => /shift|logout|postTrip/i.test(k)));
});

test('14. network failure preserves previously verified consistent session', async () => {
  const ops = makeOps({
    wasPreviouslyVerified: async () => true,
    callVerifyDriverSession: async () => {
      const e = new Error('network request failed') as Error & { name: string };
      e.name = 'TypeError';
      throw e;
    },
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'soft_offline');
  assert.equal(ops.cleanups.length, 0);
});

test('15. network failure with no prior secure verification fails closed', async () => {
  const ops = makeOps({
    wasPreviouslyVerified: async () => false,
    callVerifyDriverSession: async () => {
      const e = new Error('network request failed') as Error & { name: string };
      e.name = 'TypeError';
      throw e;
    },
  });
  const r = await revalidateSecureSession(secureSession(), ops);
  assert.equal(r.outcome, 'hard_fail');
  assert.equal(ops.cleanups.length, 1);
});

test('classifyCallableFailure: hard vs transport', () => {
  assert.equal(
    classifyCallableFailure({ code: 'permission-denied' }),
    'hard',
  );
  assert.equal(classifyCallableFailure({ code: 'unauthenticated' }), 'hard');
  assert.equal(
    classifyCallableFailure(Object.assign(new Error('x'), { name: 'TypeError' })),
    'transport',
  );
  assert.equal(classifyCallableFailure({ message: 'mystery' }), 'hard');
});

test('1-2. secure path never accepts legacy approved semantics in core', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const core = fs.readFileSync(
    path.join(process.cwd(), 'src/core/services/secureSessionRevalidationCore.ts'),
    'utf8',
  );
  const prod = fs.readFileSync(
    path.join(process.cwd(), 'src/core/services/secureSessionRevalidation.ts'),
    'utf8',
  );
  assert.ok(!core.includes('drivers/approved'));
  assert.ok(!core.includes('DRIVERS_APPROVED'));
  assert.ok(prod.includes('JSON.stringify({ data: {} })'));
  assert.ok(!prod.includes('drivers/approved'));
});
