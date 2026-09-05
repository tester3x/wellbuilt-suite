/**
 * Composite readiness behavioral tests (injected state machines).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCompositeReadinessBridge,
  computeCompositeGate,
  shouldRetryReconciliation,
} from './ssoCompositeReadiness.js';
import { createSsoAuthorizeInbox } from './ssoAuthorizeInbox.js';
import { SSO_AUDIENCE_WBT } from './ssoProtocol.generated.js';

const AUTH =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_WBT}` +
  `&cc=${'C'.repeat(43)}&ccm=S256&state=${'S'.repeat(43)}`;

function harness() {
  const inbox = createSsoAuthorizeInbox();
  const dispatched: string[] = [];
  const terminalErrors: string[] = [];
  const retries: number[] = [];
  const drain = (commands: ReturnType<typeof inbox.dispatch>['commands']) => {
    for (const c of commands) {
      if (c.cmd === 'dispatch') dispatched.push(c.url);
      else if (c.cmd === 'reject_closed' && c.url) terminalErrors.push(c.url);
    }
  };
  const bridge = createCompositeReadinessBridge({
    onPublish: ({ gate, equipment, terminalReason }) =>
      drain(inbox.dispatch({ type: 'session', gate, equipment, terminalReason }).commands),
    onRetryReconciliation: () => retries.push(1),
    readHandoff: async () => null,
  });
  const deliver = (url: string) =>
    drain(inbox.dispatch({ type: 'deliver', url, path: 'initial' }).commands);
  return { inbox, bridge, dispatched, terminalErrors, retries, deliver };
}

describe('computeCompositeGate / shouldRetryReconciliation (pure)', () => {
  it('ready requires BOTH revalidation ok AND reconciliation verified', () => {
    const base = {
      generation: 1,
      reconRetriedAfterReval: false,
      restoration: 'pending' as const,
      periodId: null,
      equipment: 'pending' as const,
      binding: null,
    };
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'verified' }), 'ready');
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'verifying' }), 'pending');
    assert.equal(computeCompositeGate({ ...base, reval: 'pending', recon: 'verified' }), 'pending');
  });
  it('revalidation failed or reconciliation rejected → failed', () => {
    const base = {
      generation: 1,
      reconRetriedAfterReval: false,
      restoration: 'pending' as const,
      periodId: null,
      equipment: 'pending' as const,
      binding: null,
    };
    assert.equal(computeCompositeGate({ ...base, reval: 'failed', recon: 'verifying' }), 'failed');
    assert.equal(computeCompositeGate({ ...base, reval: 'ok', recon: 'rejected' }), 'failed');
  });
  it('unavailable/local-only is pending before the retry, terminal after it', () => {
    const base = {
      generation: 1,
      restoration: 'pending' as const,
      periodId: null,
      equipment: 'pending' as const,
      binding: null,
    };
    assert.equal(
      computeCompositeGate({ ...base, reval: 'ok', recon: 'unavailable', reconRetriedAfterReval: false }),
      'pending',
    );
    assert.equal(
      computeCompositeGate({ ...base, reval: 'ok', recon: 'unavailable', reconRetriedAfterReval: true }),
      'failed',
    );
    assert.equal(
      shouldRetryReconciliation({ ...base, reval: 'ok', recon: 'local-only', reconRetriedAfterReval: false }),
      true,
    );
  });
});

describe('composite readiness → inbox (both async orders)', () => {
  it('authorize during verifying → queued; verified → exactly one dispatch', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.terminalErrors.length, 0);
    assert.equal(h.inbox.peek().handled, null);
    h.bridge.reportRevalidation(1, 'ok');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportReconciliation(1, 'verified');
    assert.deepEqual(h.dispatched, [AUTH]);
  });

  it('reconciliation verified first, revalidation pending → no dispatch until revalidation succeeds', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'verified');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(1, 'ok');
    assert.deepEqual(h.dispatched, [AUTH]);
  });

  it('unavailable before revalidation → retried once; verified after retry → dispatch', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportReconciliation(1, 'unavailable');
    h.bridge.reportRevalidation(1, 'ok');
    assert.equal(h.retries.length, 1);
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportReconciliation(1, 'verified');
    assert.deepEqual(h.dispatched, [AUTH]);
  });
});

describe('terminal fail-closed', () => {
  it('reconciliation rejected → zero codes, bounded error for the queued request', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'rejected');
    assert.equal(h.dispatched.length, 0);
    assert.deepEqual(h.terminalErrors, [AUTH]);
  });

  it('revalidation failed → zero codes, bounded error callback', () => {
    const h = harness();
    h.bridge.reset(1);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(1, 'failed');
    assert.equal(h.dispatched.length, 0);
    assert.deepEqual(h.terminalErrors, [AUTH]);
  });
});

describe('generation fencing', () => {
  it('stale-generation report never moves the current gate', () => {
    const h = harness();
    h.bridge.reset(5);
    h.deliver(AUTH);
    h.bridge.reportRevalidation(4, 'ok');
    h.bridge.reportReconciliation(4, 'verified');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(5, 'ok');
    h.bridge.reportReconciliation(5, 'verified');
    assert.deepEqual(h.dispatched, [AUTH]);
  });

  it('Driver A verified after Driver B reset is ignored', () => {
    const h = harness();
    h.bridge.reset(1);
    h.bridge.reset(2);
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportRevalidation(2, 'ok');
    assert.equal(h.bridge.peek().recon, 'verifying');
    assert.equal(h.dispatched.length, 0);
  });
});
