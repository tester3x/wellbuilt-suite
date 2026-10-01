// Run: npx tsx --test src/core/services/returnStart.test.ts
//
// Regression coverage for the MikeS24 field defect (v49 / 35695d5): tapping
// "Return to Yard" dismissed the confirmation and left the driver on the Suite
// home screen with an open shift, no return, and no error — which also blocked
// the rest of End Shift / logout.
//
// The shipped handler was `setShowEndModal(false); await onStartReturn();` over
// an `onStartReturn: () => Promise<void>`, so a refused return was
// indistinguishable from a successful one. The invariant pinned below is that
// the confirmation is dismissed ONLY after the return state has actually been
// accepted.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { mintReturnAttemptId, RETURN_ATTEMPT_ID_RE } from './workPeriodAuthority/returnAttempt';
import {
  confirmReturnStart,
  returnStartMessage,
  classifyReturnStartFailure,
  runReturnTap,
  createReturnTapLatch,
  type ReturnStartResult,
  type ReturnStartDiagnosis,
} from './returnStart';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((r) => setImmediate(r));
}

/** Records everything the confirmation UI would do for one tap. */
function tapHarness(start: () => Promise<ReturnStartResult>) {
  const state = {
    modalOpen: true,
    busy: [] as boolean[],
    errors: [] as (string | null)[],
    reported: [] as ReturnStartDiagnosis[],
    starts: 0,
  };
  const latch = createReturnTapLatch();
  const run = () =>
    runReturnTap({
      latch,
      start: () => { state.starts += 1; return start(); },
      onStarted: () => { state.modalOpen = false; },
      onBusyChange: (b) => state.busy.push(b),
      onError: (m) => state.errors.push(m),
      report: (d) => state.reported.push(d),
    });
  return { state, latch, run, lastError: () => state.errors[state.errors.length - 1] };
}

// ── the original confirmation contract ────────────────────────────────────
test('rejected server request leaves confirmation open with a useful error', async () => {
  let closed = false;
  const result = await confirmReturnStart(async () => ({ ok: false, reason: 'invalid_argument' }), () => { closed = true; });
  assert.deepEqual(result, { ok: false, reason: 'invalid_argument' });
  assert.equal(closed, false);
  assert.match(returnStartMessage('invalid_argument'), /shift is still open/i);
});

test('confirmation remains open until return has actually succeeded', async () => {
  let accept!: (result: { ok: true }) => void;
  let closed = false;
  const result = confirmReturnStart(() => new Promise(resolve => { accept = resolve; }), () => { closed = true; });
  assert.equal(closed, false);
  accept({ ok: true });
  assert.deepEqual(await result, { ok: true });
  assert.equal(closed, true);
});

test('storage/network exceptions do not dismiss confirmation', async () => {
  const result = await confirmReturnStart(async () => { throw new Error('network'); }, () => assert.fail('dismissed'));
  assert.equal(result.ok, false);
});

test('stale session and duplicate in-flight results do not dismiss confirmation', async () => {
  for (const reason of ['stale_generation', 'in_flight', 'no_open_shift']) {
    const result = await confirmReturnStart(async () => ({ ok: false, reason }), () => assert.fail('dismissed'));
    assert.equal(result.ok, false);
  }
});

// ── the tap, end to end ───────────────────────────────────────────────────
test('successful tap: return starts, THEN the confirmation closes', async () => {
  const h = tapHarness(async () => ({ ok: true }));
  const out = await h.run();
  assert.deepEqual(out, { kind: 'started' });
  assert.equal(h.state.modalOpen, false, 'dismissed only after acceptance');
  assert.deepEqual(h.state.busy, [true, false], 'button shows progress then clears');
  assert.equal(h.state.reported.length, 0);
  assert.equal(h.latch.held(), false, 'latch released for a later tap');
});

test('REGRESSION: a refused return NEVER closes the confirmation', async () => {
  // v49 closed first and discarded this result, stranding logout.
  const h = tapHarness(async () => ({ ok: false, reason: 'invalid_argument' }));
  const out = await h.run();
  assert.equal(out.kind, 'failed');
  assert.equal(h.state.modalOpen, true, 'the driver is NOT dropped back to home');
  assert.match(h.lastError() || '', /server could not accept this return/i);
  assert.match(h.lastError() || '', /shift is still open/i);
  assert.match(h.lastError() || '', /code: invalid_argument/);
  assert.equal(h.state.reported.length, 1, 'the refusal is reported for diagnostics');
  assert.equal(h.state.reported[0].recovery, 'update_app');
});

test('duplicate taps: the second changes nothing and starts nothing', async () => {
  const gate = deferred<ReturnStartResult>();
  const h = tapHarness(() => gate.promise);

  const first = h.run();
  await flush();
  assert.equal(h.state.starts, 1);

  const second = await h.run();
  assert.deepEqual(second, { kind: 'busy' });
  assert.equal(h.state.starts, 1, 'no second return attempt');
  assert.equal(h.state.modalOpen, true);
  assert.equal(h.latch.held(), true, "the loser did not release the winner's latch");

  gate.resolve({ ok: true });
  assert.deepEqual(await first, { kind: 'started' });
  assert.equal(h.state.starts, 1);
  assert.equal(h.state.modalOpen, false);
  assert.equal(h.latch.held(), false);
});

test('server refusal is retryable and a later tap can succeed (app resume / connection back)', async () => {
  let attempt = 0;
  const h = tapHarness(async () => (attempt++ === 0 ? { ok: false, reason: 'callable_unavailable' } : { ok: true }));

  const failed = await h.run();
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.kind === 'failed' && failed.diagnosis.retryable, true);
  assert.equal(h.state.modalOpen, true);

  const ok = await h.run();
  assert.deepEqual(ok, { kind: 'started' });
  assert.equal(h.state.modalOpen, false);
  assert.equal(h.state.errors[h.state.errors.length - 1], null, 'the stale error is cleared on retry');
});

test('storage rejection keeps the confirmation and says the shift is still open', async () => {
  for (const reason of ['return_attempt_reserve_failed', 'return_depart_write_failed', 'minted_attempt_invalid']) {
    const h = tapHarness(async () => ({ ok: false, reason }));
    const out = await h.run();
    assert.equal(out.kind, 'failed');
    assert.equal(h.state.modalOpen, true);
    assert.match(h.lastError() || '', /could not save the return securely/i);
    assert.match(h.lastError() || '', /shift is still open/i);
  }
});

test('a thrown start is contained: confirmation stays, latch is released', async () => {
  const h = tapHarness(async () => { throw new Error('boom'); });
  const out = await h.run();
  assert.equal(out.kind, 'failed');
  assert.equal(h.state.modalOpen, true);
  assert.equal(h.latch.held(), false);
  assert.deepEqual(h.state.busy, [true, false]);
});

test('session/account generation change is reported truthfully, not as success', async () => {
  const h = tapHarness(async () => ({ ok: false, reason: 'stale_generation' }));
  const out = await h.run();
  assert.equal(out.kind, 'failed');
  assert.equal(h.state.modalOpen, true);
  assert.match(h.lastError() || '', /shift is still open/i);
});

test('an expired secure session tells the driver to sign in again, not to retry', async () => {
  const d = classifyReturnStartFailure('driver_session_required');
  assert.equal(d.recovery, 'reauthenticate');
  assert.equal(d.retryable, false);
  assert.match(d.message, /log out and log back in/i);
});

// ── the message contract ──────────────────────────────────────────────────
test('every failure states the shift is still open and carries its code', () => {
  const reasons = [
    'invalid_argument', 'unsupported_return_contract', 'malformed_response', 'depart_bad_period',
    'driver_session_required', 'authority_uninitialized', 'authority_absent', 'driver_inactive',
    'period_date_mismatch', 'implausible_origin_local_date',
    'no_open_shift', 'no_period', 'no_user',
    'return_attempt_reserve_failed', 'no_attempt',
    'return_failed', 'depart_failed', 'callable_unavailable', 'stale_generation', 'identity_superseded',
    'something_completely_new',
  ];
  for (const reason of reasons) {
    const d = classifyReturnStartFailure(reason);
    assert.equal(d.code, reason, `code preserved for ${reason}`);
    assert.match(d.message, /shift is still open|was not started/i, `${reason} must not imply the shift ended`);
    assert.ok(d.message.includes(`code: ${reason}`), `${reason} must carry its code for support`);
    // Nothing may claim the return happened or that logout may proceed.
    assert.doesNotMatch(d.message, /returning to the yard|logged out|logout complete/i);
  }
});

test('a backend contract rejection is not mislabelled as a connection problem', () => {
  // The v49 field failure class: retrying sends the same rejected payload.
  for (const reason of ['invalid_argument', 'unsupported_return_contract', 'malformed_response']) {
    const d = classifyReturnStartFailure(reason);
    assert.equal(d.retryable, false);
    assert.equal(d.recovery, 'update_app');
    assert.doesNotMatch(d.message, /check your connection/i);
  }
  // Nor is a dispatch/authority problem.
  for (const reason of ['authority_uninitialized', 'driver_inactive']) {
    const d = classifyReturnStartFailure(reason);
    assert.equal(d.recovery, 'contact_dispatch');
    assert.doesNotMatch(d.message, /check your connection/i);
  }
  // A genuine transport failure still says so.
  assert.match(classifyReturnStartFailure('callable_unavailable').message, /check your connection/i);
});

test('an empty or missing reason still produces a usable diagnosis', () => {
  for (const raw of [undefined, null, '', '   ']) {
    const d = classifyReturnStartFailure(raw as string | null | undefined);
    assert.equal(d.code, 'return_failed');
    assert.match(d.message, /shift is still open/i);
  }
});


// ── specific server reasons must reach the driver ─────────────────────────
// The MikeS24 refusal showed a bare `invalid_argument`. With the client error
// mapping repaired, a named reason — and the field it names — must survive all
// the way to the modal text.

test('a named server reason replaces the generic invalid_argument message', () => {
  const generic = classifyReturnStartFailure('invalid_argument');
  for (const reason of ['malformed_attempt', 'payload_not_object', 'malformed_period', 'unknown_fields']) {
    const d = classifyReturnStartFailure(reason);
    assert.equal(d.code, reason);
    assert.equal(d.recovery, 'update_app', `${reason} is a contract problem, not a network one`);
    assert.equal(d.retryable, false);
    assert.ok(d.message.includes(`code: ${reason}`));
    assert.notEqual(d.message, generic.message, `${reason} must not read as the generic refusal`);
  }
});

test('unknown_fields:attemptId names the rejected field in the driver-visible code', () => {
  const d = classifyReturnStartFailure('unknown_fields:attemptId');
  assert.equal(d.code, 'unknown_fields:attemptid', 'full token kept, field included');
  assert.equal(d.recovery, 'update_app', 'classified on the token head');
  assert.equal(d.retryable, false);
  assert.ok(d.message.includes('code: unknown_fields:attemptid'));
  assert.match(d.message, /shift is still open/i);
});

test('invalid_argument:attemptId still names the field when the reason is unrecognised', () => {
  const d = classifyReturnStartFailure('invalid_argument:attemptId');
  assert.ok(d.message.includes('code: invalid_argument:attemptid'));
  assert.match(d.message, /shift is still open/i);
});

test('a :field suffix never changes the recovery of its token', () => {
  for (const token of ['malformed_attempt', 'driver_session_required', 'authority_uninitialized']) {
    assert.equal(
      classifyReturnStartFailure(`${token}:attemptId`).recovery,
      classifyReturnStartFailure(token).recovery,
      `${token} recovery must be stable with a field suffix`,
    );
  }
});

// ── source non-regression: the v49 shape must not come back ───────────────
const repoRoot = join(__dirname, '..', '..', '..');
const readSrc = (p: string) => readFileSync(join(repoRoot, p), 'utf8');

test('REGRESSION (source): the confirmation is never dismissed before the result', () => {
  const ui = readSrc('src/ui/shared/ActionCardRow.tsx');
  const handler = ui.slice(
    ui.indexOf('const handleReturnToYard'),
    ui.indexOf('// ── Shift card state ──'),
  );
  assert.ok(handler.length > 100, 'handler not found');

  // The exact v49 defect: dismiss first, then fire and forget.
  assert.doesNotMatch(
    handler,
    /setShowEndModal\(false\)\s*;\s*(await\s+)?onStartReturn\(/,
    'v49 shape is back: the modal is dismissed before the return is attempted',
  );
  // The dismissal may only be reachable through runReturnTap's onStarted,
  // which fires only after a confirmed { ok: true }.
  assert.ok(handler.includes('await runReturnTap({'));
  assert.ok(handler.includes('onStarted: () => setShowEndModal(false)'));
  assert.equal(
    (handler.match(/setShowEndModal\(false\)/g) || []).length,
    1,
    'exactly one dismissal path, and it is onStarted',
  );
  // A refusal must be shown and recorded, not swallowed.
  assert.ok(handler.includes('onError: setReturnError'));
  assert.ok(handler.includes("event: 'returnToYard.refused'"));
  assert.ok(ui.includes('error={returnError}'), 'the modal must render the error');
});

test('REGRESSION (source): startReturn reports an outcome instead of returning void', () => {
  // v49 had `startReturn: () => Promise<void>`, so the caller had nothing to
  // check and a refused depart_return was invisible.
  const auth = readSrc('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes("startReturn: () => Promise<import('../services/returnStart').ReturnStartResult>"));
  assert.doesNotMatch(auth, /startReturn:\s*\(\)\s*=>\s*Promise<void>/);
  const ui = readSrc('src/ui/shared/ActionCardRow.tsx');
  assert.ok(ui.includes('onStartReturn: () => Promise<ReturnStartResult>'));
  assert.doesNotMatch(ui, /onStartReturn:\s*\(\)\s*=>\s*Promise<void>/);
});


test('CONTRACT (source): the client attempt-id format matches the documented server expectation', () => {
  // Source-level only. This asserts the client regex against the format the
  // server source is documented to accept; it does NOT assert anything about
  // the revision actually deployed to wellbuilt-sync / us-central1, which
  // remains unverified and is the open question behind the live refusal.
  const attempt = readSrc('src/core/services/workPeriodAuthority/returnAttempt.ts');
  assert.ok(
    attempt.includes('export const RETURN_ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{6,80}$/'),
    'client attempt-id pattern changed — re-verify it against the server contract',
  );
  // Ids this client actually mints must satisfy that pattern, including the
  // underscore and hyphen inherited from the periodId.
  const minted = mintReturnAttemptId('2026-09-29_082000', 1_790_000_000_000, () => 0.4242);
  assert.ok(RETURN_ATTEMPT_ID_RE.test(minted), `minted id rejected by its own pattern: ${minted}`);
  assert.ok(minted.includes('_') && minted.includes('-'), 'minted ids carry both separators');
  assert.ok(minted.length >= 6 && minted.length <= 80);
});
