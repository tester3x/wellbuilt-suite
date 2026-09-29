/**
 * Production ETC start outbox and adapter.
 * Run: npx tsx --test src/core/services/etcStart/etcStartFlow.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { isExplicitStartShiftSuccess } from '../workPeriodAuthority/shiftSessionGuards';
import {
  attachEtcHandoff,
  etcHandoffThatCannotFailShift,
  mayEmitEtcStart,
  reconcileEtcOnResume,
} from './attachEtcHandoff';
import { ETC_RELEASE_IDENTITY, isEtcDispatchConfigured } from './etcReleaseIdentity';
import { resetEtcNoticeForTests, currentEtcNotice } from './etcNoticeStore';
import {
  ETC_PROVIDER_AUTHORITY,
  ETC_REQUEST_BUNDLE_KEY,
  ETC_REQUEST_MAX_AGE_MS,
  ETC_RESULT_BUNDLE_KEY,
  ETC_START_INTENT_BUNDLE_KEY,
  encodeEtcStartRequest,
  etcDriverText,
  type EtcMethod,
} from './etcStartProtocol';
import { settleEnforcedShiftClaim } from './enforcedStartBoundary';
import { ensurePreTripGate } from '../dvirGate/dvirGateService';
import { listEtcStartsForDriver, memoryEtcKv, type EtcKv } from './etcStartOutbox';
import type { EtcPort, EtcPortResult } from './etcStartDispatch';

const HERE = dirname(fileURLToPath(import.meta.url));
const verified = {
  verified: true,
  etcPackageName: 'test.etc.package',
  etcCertSha256: 'ab'.repeat(32),
};

function memory() {
  return memoryEtcKv();
}

function port(handler: (method: EtcMethod, payload: string) => Promise<EtcPortResult> | EtcPortResult) {
  const calls: { method: EtcMethod; payload: string }[] = [];
  const impl: EtcPort = {
    available: true,
    async call(method, payload) {
      calls.push({ method, payload });
      return echoStoredRequest(await handler(method, payload), payload);
    },
  };
  return { calls, impl };
}

function echoStoredRequest(result: EtcPortResult, payload: string): EtcPortResult {
  if (!result.ok) return result;
  const startIntent = result.startIntent ?? 'absent';
  if (result.response == null || typeof result.response !== 'object' || Array.isArray(result.response)) {
    return { ...result, startIntent };
  }
  const body = result.response as Record<string, unknown>;
  if ('requestId' in body) return { ...result, startIntent };
  const echoed = JSON.parse(payload) as Record<string, unknown>;
  return {
    ...result,
    startIntent,
    response: { ...echoed, ...body },
  };
}

function okResponse(
  over: Record<string, unknown> = {},
  startIntent: 'absent' | 'present' | 'sent' = 'absent',
): EtcPortResult {
  return {
    ok: true,
    startIntent,
    pendingIntentCreatorPackage: startIntent === 'absent' ? null : verified.etcPackageName,
    response: {
      state: 'prepared',
      hos: 'not_started',
      gps: 'starting',
      observedAtMs: 10,
      ...over,
    },
  };
}

const base = {
  companyId: 'co-1' as string | null,
  driverId: 'drv-1',
  periodId: '2026-09-28_120000',
  nowMs: 1_700_000_000_000,
};

async function start(over: Partial<Parameters<typeof attachEtcHandoff>[0]> = {}) {
  const kv = over.kv ?? memory();
  const bridge = port(async () => okResponse());
  const result = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    timeoutMs: 50,
    newRequestId: () => 'req-once',
    ...over,
  });
  return { result, kv, bridge };
}

test('release identity is unverified and dispatch stays disabled', () => {
  assert.equal(ETC_RELEASE_IDENTITY.verified, false);
  assert.equal(ETC_RELEASE_IDENTITY.etcPackageName, null);
  assert.equal(ETC_RELEASE_IDENTITY.etcCertSha256, null);
  assert.equal(isEtcDispatchConfigured(ETC_RELEASE_IDENTITY), false);
  const src = readFileSync(join(HERE, 'etcReleaseIdentity.ts'), 'utf8');
  assert.equal(/\b[0-9a-f]{64}\b/i.test(src), false);
  assert.equal(src.includes('com.wellbuilt.electronictimecard'), false);
});

test('request payload is the exact contract object and allows null companyId', () => {
  const encoded = encodeEtcStartRequest({
    protocolVersion: 1,
    action: 'start_hos',
    requestId: 'abc',
    companyId: null,
    driverId: 'drv',
    suiteShiftId: 'period',
    requestedAtMs: 5,
  });
  assert.deepEqual(JSON.parse(encoded), {
    protocolVersion: 1,
    action: 'start_hos',
    requestId: 'abc',
    companyId: null,
    driverId: 'drv',
    suiteShiftId: 'period',
    requestedAtMs: 5,
  });
  assert.ok(encoded.length < 8192);
  assert.equal(ETC_PROVIDER_AUTHORITY, 'com.wellbuilt.electronictimecard.suitehos');
  assert.equal(ETC_REQUEST_BUNDLE_KEY, 'payload');
  assert.equal(ETC_RESULT_BUNDLE_KEY, 'payload');
  assert.equal(ETC_START_INTENT_BUNDLE_KEY, 'startIntent');
});

test('server claim failure does not write or call ETC', async () => {
  const kv = memory();
  let reads = 0;
  const wrapped: EtcKv = {
    async getItem(key) {
      reads += 1;
      return kv.getItem(key);
    },
    setItem: (key, value) => kv.setItem(key, value),
  };
  const bridge = port(async () => okResponse());
  const result = await attachEtcHandoff({
    claim: { ok: false, reason: 'server_unverifiable:down' },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv: wrapped,
    port: bridge.impl,
    identity: verified,
  });
  assert.equal(result.blocksShift, false);
  assert.equal(result.transport, 'skipped');
  assert.equal(result.request, null);
  assert.equal(reads, 0);
  assert.equal(bridge.calls.length, 0);
  assert.equal(mayEmitEtcStart({ branch: 'enforced', claimOk: false, generationCurrent: true }), false);
});

test('binding failure does not emit an ETC start', async () => {
  const { result, bridge, kv } = await start({
    claim: { ok: false, reason: 'binding_failed' },
  });
  assert.equal(result.transport, 'skipped');
  assert.equal(result.reason, 'binding_failed');
  assert.equal(bridge.calls.length, 0);
  assert.equal((await listEtcStartsForDriver(kv, base.driverId, base.companyId)).length, 0);
});

test('stale generation does not write', async () => {
  const kv = memory();
  let writes = 0;
  const wrapped: EtcKv = {
    getItem: (key) => kv.getItem(key),
    async setItem(key, value) {
      writes += 1;
      await kv.setItem(key, value);
    },
  };
  const result = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: false,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv: wrapped,
    port: port(async () => okResponse()).impl,
    identity: verified,
  });
  assert.equal(result.reason, 'stale_generation');
  assert.equal(writes, 0);
  assert.equal(mayEmitEtcStart({ branch: 'enforced', claimOk: true, generationCurrent: false }), false);
  assert.equal(mayEmitEtcStart({ branch: 'legacy', claimOk: true, generationCurrent: true }), false);
});

test('generation that goes stale before the write does not create a request', async () => {
  const kv = memory();
  let live = true;
  let writes = 0;
  const wrapped: EtcKv = {
    async getItem(key) {
      live = false;
      return kv.getItem(key);
    },
    async setItem(key, value) {
      writes += 1;
      await kv.setItem(key, value);
    },
  };
  const bridge = port(async () => okResponse());
  const result = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    isCurrent: () => live,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv: wrapped,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => 'should-not-matter',
  });
  assert.equal(result.reason, 'stale_generation');
  assert.equal(writes, 0);
  assert.equal(bridge.calls.length, 0);
});

test('accepted period is stored once before dispatch and retries reuse it', async () => {
  const kv = memory();
  const order: string[] = [];
  const wrapped: EtcKv = {
    getItem: (key) => kv.getItem(key),
    async setItem(key, value) {
      order.push(`write:${key}`);
      await kv.setItem(key, value);
    },
  };
  let n = 0;
  const bridge = port(async (method) => {
    order.push(`call:${method}`);
    return okResponse();
  });
  const first = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: null,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv: wrapped,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => `req-${++n}`,
  });
  const second = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: null,
    driverId: base.driverId,
    nowMs: base.nowMs + 5_000,
    activityVisible: true,
    kv: wrapped,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => {
      throw new Error('second id');
    },
  });
  assert.equal(order[0].startsWith('write:'), true);
  assert.ok(order.indexOf('call:prepareStart') > 0);
  assert.equal(first.request?.requestId, 'req-1');
  assert.equal(first.request?.companyId, null);
  assert.equal(first.request?.requestedAtMs, base.nowMs);
  assert.equal(encodeEtcStartRequest(first.request!), encodeEtcStartRequest(second.request!));
  assert.equal(bridge.calls.length, 2);
  assert.equal(bridge.calls[0].payload, bridge.calls[1].payload);
  assert.equal((await listEtcStartsForDriver(kv, base.driverId, null)).length, 1);
  assert.equal(bridge.calls.some((call) => call.method === 'cancelStart'), false);
});

test('unverified signing, missing native, permission, and absence do not fail the shift or start HOS', async () => {
  resetEtcNoticeForTests();
  const hidden = await start({ identity: ETC_RELEASE_IDENTITY });
  assert.equal(hidden.bridge.calls.length, 0);
  assert.equal(hidden.result.reason, 'signing_unverified');
  assert.equal(hidden.result.hos, 'unknown');
  assert.equal(hidden.result.blocksShift, false);
  assert.equal(hidden.result.driverText.includes('started'), false);
  assert.equal(currentEtcNotice(), hidden.result.driverText);

  const absentPort = port(async () => ({ ok: false, reason: 'absent' }));
  absentPort.impl.available = false;
  const absent = await start({ port: absentPort.impl, newRequestId: () => 'absent-req' });
  assert.equal(absent.bridge.calls.length, 0);
  assert.equal(absent.result.reason, 'native_unavailable');
  assert.equal(absent.result.hos, 'unknown');

  for (const reason of ['permission_denied', 'untrusted', 'absent'] as const) {
    const bridge = port(async () => ({ ok: false, reason }));
    const result = await attachEtcHandoff({
      claim: { ok: true, periodId: `period-${reason}` },
      generationCurrent: true,
      companyId: base.companyId,
      driverId: base.driverId,
      nowMs: base.nowMs,
      activityVisible: true,
      kv: memory(),
      port: bridge.impl,
      identity: verified,
      newRequestId: () => `id-${reason}`,
    });
    assert.equal(result.blocksShift, false);
    assert.equal(result.hos, 'unknown');
    assert.equal(result.state, 'unknown');
    assert.equal(result.driverText.includes('started'), false);
    assert.equal(isExplicitStartShiftSuccess({ ok: true, etc: result }), true);
  }
});

test('timeout is unknown, keeps the same request, and the next attempt reconciles', async () => {
  const kv = memory();
  const bridge = port(() => new Promise(() => {}));
  const timed = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    timeoutMs: 20,
    newRequestId: () => 'timeout-req',
  });
  assert.equal(timed.reason, 'timeout');
  assert.equal(timed.hos, 'unknown');
  assert.equal(timed.state, 'unknown');
  assert.equal(timed.blocksShift, false);
  assert.equal(etcDriverText({ hos: timed.hos, gps: timed.gps }).includes('started'), false);
  const again = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs + 1000,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    timeoutMs: 20,
    newRequestId: () => {
      throw new Error('new id');
    },
  });
  assert.equal(again.request?.requestId, 'timeout-req');
  assert.equal(again.request?.requestedAtMs, base.nowMs);
  assert.deepEqual(bridge.calls.map((call) => call.method), ['prepareStart', 'getStartStatus']);
  assert.equal(bridge.calls[0].payload, bridge.calls[1].payload);
});

test('an ended ETC result is reconciled and does not prepare another start', async () => {
  const kv = memory();
  const bridge = port(async (method) => {
    if (method === 'prepareStart') {
      return okResponse({ state: 'completed', hos: 'already_active', gps: 'ready' });
    }
    return okResponse({ state: 'completed', hos: 'already_active', gps: 'ready' });
  });
  await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => 'ended-req',
  });
  const second = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs + 1000,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => {
      throw new Error('new id');
    },
  });
  assert.equal(second.hos, 'already_active');
  assert.equal(second.transport, 'reconciled');
  assert.deepEqual(bridge.calls.map((call) => call.method), ['prepareStart', 'getStartStatus']);
  assert.equal(second.driverText.includes('started'), true);
});

test('expired and future-skewed requests are reconciled, never rewritten', async () => {
  const kv = memory();
  const bridge = port(async (method) => okResponse(
    method === 'getStartStatus'
      ? { state: 'expired', hos: 'unknown', gps: 'unknown' }
      : {},
  ));
  await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => 'aged-req',
  });
  const expired = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs + ETC_REQUEST_MAX_AGE_MS + 1,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => {
      throw new Error('new id');
    },
  });
  assert.equal(expired.request?.requestedAtMs, base.nowMs);
  assert.equal(expired.transport, 'reconciled');
  assert.equal(bridge.calls.at(-1)?.method, 'getStartStatus');

  const skewKv = memory();
  const skewBridge = port(async () => okResponse());
  await attachEtcHandoff({
    claim: { ok: true, periodId: 'skew-period' },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: 100_000,
    activityVisible: true,
    kv: skewKv,
    port: skewBridge.impl,
    identity: verified,
    newRequestId: () => 'skew-req',
  });
  const skewed = await attachEtcHandoff({
    claim: { ok: true, periodId: 'skew-period' },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: 100_000 - 60_000,
    activityVisible: true,
    kv: skewKv,
    port: skewBridge.impl,
    identity: verified,
  });
  assert.equal(skewed.request?.requestedAtMs, 100_000);
  assert.equal(skewBridge.calls.at(-1)?.method, 'getStartStatus');
});

test('process restore and resume only reconcile an existing receipt', async () => {
  const kv = memory();
  const bridge = port(async () => okResponse({ state: 'processing', hos: 'unknown', gps: 'starting' }));
  await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => 'restore-req',
  });
  const before = bridge.calls.length;
  const resumed = await reconcileEtcOnResume({
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs + 2000,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
  });
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0].request?.requestId, 'restore-req');
  assert.equal(bridge.calls[before].method, 'getStartStatus');
  assert.equal(bridge.calls.filter((call) => call.method === 'prepareStart').length, 1);
  assert.equal((await listEtcStartsForDriver(kv, base.driverId, base.companyId)).length, 1);

  const empty = memory();
  let writes = 0;
  const wrapped: EtcKv = {
    getItem: (key) => empty.getItem(key),
    async setItem(key, value) {
      writes += 1;
      await empty.setItem(key, value);
    },
  };
  const idle = port(async () => okResponse());
  const none = await reconcileEtcOnResume({
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv: wrapped,
    port: idle.impl,
    identity: verified,
  });
  assert.deepEqual(none, []);
  assert.equal(writes, 0);
  assert.equal(idle.calls.length, 0);
});

test('hidden Activity and a mismatched PendingIntent creator do not count as HOS started', async () => {
  const hidden = await start({ activityVisible: false });
  assert.equal(hidden.bridge.calls.length, 0);
  assert.equal(hidden.result.reason, 'activity_not_visible');
  assert.equal(hidden.result.hos, 'unknown');
  assert.ok(hidden.result.request);

  const bridge = port(async () => ({
    ok: true,
    startIntent: 'sent',
    pendingIntentCreatorPackage: 'not.the.etc.package',
    response: { state: 'completed', hos: 'started', gps: 'ready', observedAtMs: 9 },
  }));
  const forged = await start({ port: bridge.impl, newRequestId: () => 'forged' });
  assert.equal(forged.result.hos, 'unknown');
  assert.equal(forged.result.driverText.includes('not confirmed'), true);
  assert.equal(forged.result.blocksShift, false);
});

test('GPS readiness is reported separately from HOS and does not close the shift', async () => {
  const bridge = port(async () => okResponse({
    state: 'completed',
    hos: 'started',
    gps: 'unavailable',
    gpsObservedAtMs: 77,
    observedAtMs: 88,
    etcShiftId: 'etc-1',
  }));
  const { result } = await start({ port: bridge.impl, newRequestId: () => 'gps-req' });
  assert.equal(result.hos, 'started');
  assert.equal(result.gps, 'unavailable');
  assert.equal(result.etcShiftId, 'etc-1');
  assert.equal(result.gpsObservedAtMs, 77);
  assert.match(result.driverText, /started/);
  assert.match(result.driverText, /GPS is not ready/);
  assert.equal(result.blocksShift, false);
  assert.equal(isExplicitStartShiftSuccess({ ok: true, etc: result }), true);
});

test('a throwing handoff still cannot fail the Suite shift', async () => {
  const result = await etcHandoffThatCannotFailShift(async () => {
    throw new Error('kv down');
  });
  assert.equal(result.blocksShift, false);
  assert.equal(result.hos, 'unknown');
  assert.equal(result.driverText.includes('started'), false);
});

test('AuthContext emits only from the enforced success path', () => {
  const root = join(HERE, '..', '..', '..');
  const auth = readFileSync(join(root, 'core/context/AuthContext.tsx'), 'utf8');
  const start = auth.indexOf('const startShift = useCallback');
  const legacy = auth.indexOf('// ── Legacy / inert:', start);
  const afterLegacy = auth.indexOf('const returnInFlight', legacy);
  const enforced = auth.slice(start, legacy);
  const legacyBody = auth.slice(legacy, afterLegacy);
  assert.match(enforced, /settleEnforcedShiftClaim\(/);
  assert.ok(enforced.indexOf('if (!claim.ok)') < enforced.indexOf('settleEnforcedShiftClaim'));
  assert.equal(enforced.includes('attachEtcHandoff'), false);
  assert.equal(legacyBody.includes('attachEtcHandoff'), false);
  assert.equal(legacyBody.includes('settleEnforcedShiftClaim'), false);
  assert.equal(legacyBody.includes('mayEmitEtcStart'), false);
  const row = readFileSync(join(root, 'ui/shared/ActionCardRow.tsx'), 'utf8');
  const confirm = row.slice(row.indexOf('const handleStartConfirm'), row.indexOf('const handleReturnToYard'));
  const success = confirm.indexOf('if (!isExplicitStartShiftSuccess(result))');
  const pre = confirm.indexOf('ensurePreTripGate({ alertOnBlock: true })');
  assert.ok(success > -1 && pre > success);
});

test('wire keys are payload and startIntent, and visibility does not enable dispatch', () => {
  const repo = join(HERE, '..', '..', '..', '..');
  const kt = readFileSync(join(repo, 'modules/suite-etc-hos/android/src/main/java/expo/modules/suiteetchos/SuiteEtcHosModule.kt'), 'utf8');
  assert.match(kt, /putString\("payload"/);
  assert.match(kt, /getString\("payload"/);
  assert.match(kt, /getParcelable\("startIntent"/);
  assert.equal(kt.includes('"pendingIntent"'), false);
  assert.equal(kt.includes('"request"'), false);
  assert.equal(kt.includes('"result"'), false);
  const require = createRequire(import.meta.url);
  const { applyEtcPackageVisibility, ETC_SOURCE_APPLICATION_ID, ETC_PROVIDER_AUTHORITY: authority } = require(join(repo, 'modules/suite-etc-hos/etcVisibility.js'));
  const manifest = applyEtcPackageVisibility({ queries: [{}] });
  const queries = manifest.queries[0];
  assert.equal(queries.provider.some((entry: { $: Record<string, string> }) => entry.$['android:authorities'] === authority), true);
  assert.equal(queries.package.some((entry: { $: Record<string, string> }) => entry.$['android:name'] === ETC_SOURCE_APPLICATION_ID), true);
  assert.equal(ETC_SOURCE_APPLICATION_ID, 'com.wellbuilt.electronictimecard');
  assert.equal(isEtcDispatchConfigured(ETC_RELEASE_IDENTITY), false);
});

test('an echoed company id or timestamp mismatch is not an HOS start', async () => {
  for (const mutate of [
    (body: Record<string, unknown>) => ({ ...body, companyId: body.companyId === null ? 'other' : null }),
    (body: Record<string, unknown>) => ({ ...body, requestedAtMs: Number(body.requestedAtMs) + 1 }),
  ]) {
    const kv = memory();
    const bridge = port(async (_method, payload) => {
      const echoed = JSON.parse(payload) as Record<string, unknown>;
      return {
        ok: true as const,
        startIntent: 'absent' as const,
        pendingIntentCreatorPackage: null,
        response: {
          ...mutate(echoed),
          state: 'completed',
          hos: 'started',
          gps: 'ready',
          observedAtMs: 4,
        },
      };
    });
    const first = await attachEtcHandoff({
      claim: { ok: true, periodId: base.periodId },
      generationCurrent: true,
      companyId: null,
      driverId: base.driverId,
      nowMs: base.nowMs,
      activityVisible: true,
      kv,
      port: bridge.impl,
      identity: verified,
      newRequestId: () => 'echo-req',
    });
    assert.equal(first.hos, 'unknown');
    assert.equal(first.reason, 'echo_mismatch');
    assert.equal(first.blocksShift, false);
    assert.equal(first.driverText.includes('not confirmed'), true);
    const again = await attachEtcHandoff({
      claim: { ok: true, periodId: base.periodId },
      generationCurrent: true,
      companyId: null,
      driverId: base.driverId,
      nowMs: base.nowMs + 1000,
      activityVisible: true,
      kv,
      port: bridge.impl,
      identity: verified,
      newRequestId: () => {
        throw new Error('new id');
      },
    });
    assert.equal(again.request?.requestId, 'echo-req');
    assert.equal(again.request?.requestedAtMs, base.nowMs);
    assert.equal(again.request?.companyId, null);
    assert.deepEqual(bridge.calls.map((call) => call.method), ['prepareStart', 'getStartStatus']);
    assert.equal(bridge.calls[0].payload, bridge.calls[1].payload);
  }
});

test('completed ETC status is valid with or without a start token', async () => {
  const without = await start({
    port: port(async () => okResponse({
      state: 'completed',
      hos: 'started',
      gps: 'ready',
      observedAtMs: 3,
    }, 'absent')).impl,
    newRequestId: () => 'no-token',
  });
  assert.equal(without.result.hos, 'started');
  assert.equal(without.result.state, 'completed');
  assert.equal(without.result.blocksShift, false);

  const withToken = await start({
    port: port(async () => okResponse({
      state: 'completed',
      hos: 'already_active',
      gps: 'ready',
      observedAtMs: 4,
    }, 'sent')).impl,
    newRequestId: () => 'with-token',
  });
  assert.equal(withToken.result.hos, 'already_active');
  assert.equal(withToken.result.state, 'completed');
  assert.equal(withToken.result.blocksShift, false);
});

test('a sent token without a terminal result is not proof the service ran', async () => {
  const kv = memory();
  const bridge = port(async () => okResponse({
    state: 'processing',
    hos: 'not_started',
    gps: 'starting',
    observedAtMs: 6,
  }, 'sent'));
  const first = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => 'observe-req',
  });
  assert.equal(first.reason, 'observation_unconfirmed');
  assert.equal(first.hos, 'unknown');
  assert.equal(first.driverText.includes('not confirmed'), true);
  const second = await attachEtcHandoff({
    claim: { ok: true, periodId: base.periodId },
    generationCurrent: true,
    companyId: base.companyId,
    driverId: base.driverId,
    nowMs: base.nowMs + 500,
    activityVisible: true,
    kv,
    port: bridge.impl,
    identity: verified,
    newRequestId: () => {
      throw new Error('new id');
    },
  });
  assert.equal(second.request?.requestedAtMs, base.nowMs);
  assert.deepEqual(bridge.calls.map((call) => call.method), ['prepareStart', 'getStartStatus']);
  assert.equal(bridge.calls[0].payload, bridge.calls[1].payload);
});

test('a token that was not sent and a malformed or null response are unknown', async () => {
  const unsent = await start({
    port: port(async () => okResponse({
      state: 'completed',
      hos: 'started',
      gps: 'ready',
      observedAtMs: 8,
    }, 'present')).impl,
    newRequestId: () => 'unsent',
  });
  assert.equal(unsent.result.hos, 'unknown');
  assert.equal(unsent.result.reason, 'start_intent_not_sent');
  assert.equal(unsent.result.blocksShift, false);

  for (const reason of ['malformed_response', 'absent', 'illegal_argument', 'token_send_failed'] as const) {
    const kv = memory();
    const bridge = port(async () => ({ ok: false as const, reason }));
    const result = await attachEtcHandoff({
      claim: { ok: true, periodId: `period-${reason}` },
      generationCurrent: true,
      companyId: base.companyId,
      driverId: base.driverId,
      nowMs: base.nowMs,
      activityVisible: true,
      kv,
      port: bridge.impl,
      identity: verified,
      newRequestId: () => `id-${reason}`,
    });
    assert.equal(result.hos, 'unknown');
    assert.equal(result.blocksShift, false);
    assert.equal(result.driverText.includes('started'), false);
    const stored = await listEtcStartsForDriver(kv, base.driverId, base.companyId);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].request.requestId, `id-${reason}`);
    assert.equal(stored[0].request.requestedAtMs, base.nowMs);
    assert.notEqual(stored[0].lastHos, 'started');
  }

  const nullBody = await start({
    port: port(async () => ({
      ok: true as const,
      startIntent: 'absent' as const,
      response: null,
    })).impl,
    newRequestId: () => 'null-body',
  });
  assert.equal(nullBody.result.hos, 'unknown');
  assert.equal(nullBody.result.reason, 'echo_mismatch');
  assert.equal(nullBody.result.blocksShift, false);
});

test('ETC import failure after an accepted claim keeps the Suite shift and Pre-Trip', async () => {
  resetEtcNoticeForTests();
  const binding = { periodId: '2026-09-29_153000', originLocalDate: '2026-09-29' };
  const kv = memory();
  let loads = 0;
  const result = await settleEnforcedShiftClaim({
    claim: { ok: true, periodId: binding.periodId, originLocalDate: binding.originLocalDate, claimed: true },
    binding,
    isCurrent: () => true,
    companyId: null,
    driverId: base.driverId,
    activityVisible: true,
    nowMs: base.nowMs,
    kv,
    loadEtc: async () => {
      loads += 1;
      throw new Error('cannot load ETC module');
    },
  });
  assert.equal(loads, 1);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(isExplicitStartShiftSuccess(result), true);
  assert.equal(result.etc.hos, 'unknown');
  assert.equal(result.etc.blocksShift, false);
  assert.equal(result.etc.driverText.includes('not confirmed'), true);
  assert.equal(result.binding, binding);
  assert.equal(binding.periodId, '2026-09-29_153000');
  assert.equal((await listEtcStartsForDriver(kv, base.driverId, null)).length, 0);
  assert.equal(currentEtcNotice(), result.etc.driverText);

  const launched: string[] = [];
  const gate = await ensurePreTripGate({
    kv: {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    sha256Hex: async (value) => value,
    getCurrentShiftId: async () => result.binding.periodId,
    isShiftActive: () => true,
    openUrl: async (url) => {
      launched.push(url);
    },
    alert: () => {},
  }, { alertOnBlock: true });
  assert.equal(gate.shiftId, binding.periodId);
  assert.equal(gate.launched, true);
  assert.match(launched[0], /phase=pre_trip/);
  assert.match(launched[0], new RegExp(binding.periodId));
});

test('a rejected claim returns failure and does not load or emit ETC', async () => {
  const kv = memory();
  let loads = 0;
  const result = await settleEnforcedShiftClaim({
    claim: { ok: false, reason: 'server_unverifiable:down' },
    binding: null,
    isCurrent: () => true,
    companyId: base.companyId,
    driverId: base.driverId,
    activityVisible: true,
    kv,
    loadEtc: async () => {
      loads += 1;
      throw new Error('should not load');
    },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'server_unverifiable:down');
  assert.equal(loads, 0);
  assert.equal((await listEtcStartsForDriver(kv, base.driverId, base.companyId)).length, 0);
  assert.equal(isExplicitStartShiftSuccess(result), false);
});
