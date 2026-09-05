/**
 * Composite readiness behavioral tests (injected state machines).
 *
 * Wires the composite readiness bridge → the authorize inbox reducer and proves
 * BOTH async completion orders, the retry-after-reval fix, terminal fail-closed
 * with a bounded error callback (never a code), and generation fencing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCompositeReadinessBridge,
  computeCompositeGate,
  shouldRetryReconciliation,
} from './ssoCompositeReadiness.js';
import { createSsoAuthorizeInbox } from './ssoAuthorizeInbox.js';

const AUTH = 'wellbuilt-suite://sso-authorize';

function harness() {
  const inbox = createSsoAuthorizeInbox();
  const dispatched: string[] = []; // code-issuance dispatches
  const terminalErrors: string[] = []; // bounded error callbacks (never a code)
  const retries: number[] = [];
  const drain = (commands: ReturnType<typeof inbox.dispatch>['commands']) => {
    for (const c of commands) {
      if (c.cmd === 'dispatch') dispatched.push(c.url);
      else if (c.cmd === 'reject_closed' && c.reason === 'revalidation_failed' && c.url) {
        terminalErrors.push(c.url);
      }
    }
  };
  const bridge = createCompositeReadinessBridge({
    onGate: (gate) => drain(inbox.dispatch({ type: 'session', gate }).commands),
    onRetryReconciliation: () => retries.push(1),
  });
  const deliver = (url: string) =>
    drain(inbox.dispatch({ type: 'deliver', url, path: 'initial' }).commands);
  return { inbox, bridge, dispatched, terminalErrors, retries, deliver };
}

describe('computeCompositeGate / shouldRetryReconciliation (pure)', () => {
  it('ready requires BOTH revalidation ok AND reconciliation verified', () => {
    const base = { generation: 1, reconRetriedAfterReval: false } as const;
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'verified' }), 'ready');
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'verifying' }), 'pending');
    assert.equal(computeCompositeGate({ ...base, reval: 'pending', recon: 'verified' }), 'pending');
  });
  it('revalidation failed or reconciliation rejected → failed', () => {
    const base = { generation: 1, reconRetriedAfterReval: false } as const;
    assert.equal(computeCompositeGate({ ...base, reval: 'failed', recon: 'verifying' }), 'failed');
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'rejected' }), 'failed');
  });
  it('unavailable/local-only is pending before the retry, terminal after it', () => {
    assert.equal(
      computeCompositeGate({ generation: 1, reval: 'ok', recon: 'unavailable', reconRetriedAfterReval: false }),
      'pending',
    );
    assert.equal(
      computeCompositeGate({ generation: 1, reval: 'ok', recon: 'unavailable', reconRetriedAfterReval: true }),
      'failed',
    );
    assert.equal(
      shouldRetryReconciliation({ generation: 1, reval: 'ok', recon: 'local-only', reconRetriedAfterReval: false }),
      true,
    );
  });
});

describe('composite readiness → inbox (both async orders)', () => {
  it('pin 1+2: authorize during verifying → queued (no code/callback, URL not handled); verified → exactly one dispatch', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.terminalErrors.length, 0);
    assert.equal(h.inbox.peek().handled, null); // not burned
    h.bridge.reportRevalidation(1, 'ok'); // reval first; recon still verifying → still queued
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.inbox.peek().handled, null);
    h.bridge.reportReconciliation(1, 'verified'); // now ready
    assert.deepEqual(h.dispatched, [AUTH]);
    assert.equal(h.terminalErrors.length, 0);
  });

  it('pin 3: reconciliation verified first, revalidation pending → no dispatch until revalidation succeeds', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'verified');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(1, 'ok');
    assert.deepEqual(h.dispatched, [AUTH]);
  });

  it('pin 4: reconciliation unavailable before revalidation → not ready; retried once; verified after retry → dispatch', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'unavailable');
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.retries.length, 0);
    h.bridge.reportRevalidation(1, 'ok'); // arms exactly one retry
    assert.equal(h.retries.length, 1);
    assert.equal(h.dispatched.length, 0); // still queued during retry
    h.bridge.reportReconciliation(1, 'verified'); // retry verified
    assert.deepEqual(h.dispatched, [AUTH]);
  });

  it('pin 7: a URL held during verifying is never burned by a premature callback or handled latch', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'verifying'); // still verifying
    h.bridge.reportRevalidation(1, 'ok');
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.terminalErrors.length, 0);
    assert.equal(h.inbox.peek().handled, null);
    assert.equal(h.inbox.peek().queued, AUTH); // still parked
  });
});

describe('terminal fail-closed returns a bounded error callback, never a code', () => {
  it('pin 5a: reconciliation rejected → zero codes, bounded error callback for the queued request', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'rejected');
    assert.equal(h.dispatched.length, 0);
    assert.deepEqual(h.terminalErrors, [AUTH]);
  });

  it('pin 5b: revalidation failed → zero codes, bounded error callback', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(1, 'failed');
    assert.equal(h.dispatched.length, 0);
    assert.deepEqual(h.terminalErrors, [AUTH]);
  });

  it('pin 5c: reconciliation still unavailable after the post-reval retry → terminal error, no code', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'unavailable');
    h.bridge.reportRevalidation(1, 'ok'); // retry armed
    h.bridge.reportReconciliation(1, 'unavailable'); // retry still unavailable → terminal
    assert.equal(h.dispatched.length, 0);
    assert.deepEqual(h.terminalErrors, [AUTH]);
  });
});

describe('generation fencing (pin 6)', () => {
  it('driver switch during verifying → prior URL cannot issue for the old or the new identity', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(1, 'ok'); // gen1 reval ok, recon verifying
    // Logout/driver switch: inbox reset drops the queue; readiness moves to gen 2.
    h.inbox.reset();
    h.bridge.reset(2);
    // A late gen-1 reconciliation verdict must be ignored.
    h.bridge.reportReconciliation(1, 'verified');
    assert.equal(h.dispatched.length, 0);
    // New identity readiness cannot resurrect the dropped old URL either.
    h.bridge.reportRevalidation(2, 'ok');
    h.bridge.reportReconciliation(2, 'verified');
    assert.equal(h.dispatched.length, 0);
  });

  it('a stale-generation report never moves the current gate', () => {
    const h = harness();
    h.bridge.reset(5);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(4, 'ok'); // stale gen ignored
    h.bridge.reportReconciliation(4, 'verified'); // stale gen ignored
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(5, 'ok');
    h.bridge.reportReconciliation(5, 'verified');
    assert.deepEqual(h.dispatched, [AUTH]);
  });
});
