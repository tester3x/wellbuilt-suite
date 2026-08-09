import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  buildHandoffOpenDiag,
  buildHandoffRequestDiag,
  classifyAuthMechanism,
  formatHandoffDiagConsole,
  returnHostFromUrl,
  setHandoffDiagEmitter,
  emitHandoffDiag,
  type DvirHandoffDiagEvent,
} from './dvirHandoffDiag';

test('returnHostFromUrl never returns query or credentials', () => {
  assert.equal(
    returnHostFromUrl('wellbuilt-suite://dvir-complete?token=SECRET&hash=abc'),
    'wellbuilt-suite://dvir-complete',
  );
  assert.equal(returnHostFromUrl(undefined), 'none');
});

test('classifyAuthMechanism: none when getter empty', () => {
  assert.deepEqual(classifyAuthMechanism(null), {
    authMechanism: 'none',
    authParamsAttached: false,
  });
  assert.deepEqual(classifyAuthMechanism({}), {
    authMechanism: 'none',
    authParamsAttached: false,
  });
});

test('classifyAuthMechanism: legacy_hash_name only when both present', () => {
  assert.deepEqual(classifyAuthMechanism({ hash: 'x', name: 'Mike' }), {
    authMechanism: 'legacy_hash_name',
    authParamsAttached: true,
  });
  assert.equal(classifyAuthMechanism({ hash: 'x' }).authParamsAttached, false);
  assert.equal(classifyAuthMechanism({ name: 'Mike' }).authParamsAttached, false);
});

test('request diag is nonsecret and includes phase/shift/auth flags', () => {
  const d = buildHandoffRequestDiag({
    phase: 'pre_trip',
    shiftId: '2026-08-08_211725',
    sso: null,
    returnUrl: 'wellbuilt-suite://dvir-complete',
  });
  assert.equal(d.event, 'dvir.handoff.request');
  assert.equal(d.phase, 'pre_trip');
  assert.equal(d.shiftId, '2026-08-08_211725');
  assert.equal(d.authParamsAttached, false);
  assert.equal(d.authMechanism, 'none');
  assert.equal(d.returnHost, 'wellbuilt-suite://dvir-complete');
  const line = formatHandoffDiagConsole(d);
  assert.ok(line.includes('[Suite-DVIR]'));
  assert.ok(line.includes('authParamsAttached=0'));
  assert.ok(!line.includes('hash='));
  assert.ok(!line.includes('token'));
});

test('open diag classifies success/failure without URI', () => {
  const d = buildHandoffOpenDiag({
    phase: 'pre_trip',
    shiftId: '2026-08-08_211725',
    success: true,
    classification: 'opened',
    authParamsAttached: false,
  });
  assert.equal(d.event, 'dvir.handoff.open');
  assert.equal(d.success, true);
  const line = formatHandoffDiagConsole(d);
  assert.ok(line.includes('classification=opened'));
  assert.ok(!line.includes('wbequipment'));
});

test('emitter delivers request then open (handoff requested → open)', () => {
  const seen: DvirHandoffDiagEvent[] = [];
  setHandoffDiagEmitter((e) => seen.push(e));
  emitHandoffDiag(
    buildHandoffRequestDiag({
      phase: 'pre_trip',
      shiftId: 's1',
      sso: null,
      returnUrl: 'wellbuilt-suite://dvir-complete',
    }),
  );
  emitHandoffDiag(
    buildHandoffOpenDiag({
      phase: 'pre_trip',
      shiftId: 's1',
      success: true,
      classification: 'opened',
      authParamsAttached: false,
    }),
  );
  assert.equal(seen.length, 2);
  assert.equal(seen[0].event, 'dvir.handoff.request');
  assert.equal(seen[1].event, 'dvir.handoff.open');
  setHandoffDiagEmitter(null);
});

test('missing-auth request is distinguishable (authParamsAttached=0)', () => {
  const d = buildHandoffRequestDiag({
    phase: 'post_trip',
    shiftId: 's2',
    sso: { hash: undefined, name: undefined },
  });
  assert.equal(d.authParamsAttached, false);
  assert.match(formatHandoffDiagConsole(d), /authParamsAttached=0/);
});
