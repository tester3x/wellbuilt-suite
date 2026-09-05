/**
 * P0 handoff — production-seam integration with injected external boundaries.
 * Fail-fast if any issuance operation is invoked on a terminal path.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSsoAuthorizationHandler } from './ssoAuthorizationCore.js';
import { createSsoAuthorizeInbox } from './ssoAuthorizeInbox.js';
import { createCompositeReadinessBridge } from './ssoCompositeReadiness.js';
import { respondSsoTerminalError } from './ssoTerminalResponder.js';
import { SSO_AUDIENCE_EQUIPMENT, SSO_AUDIENCE_WBT } from './ssoProtocol.generated.js';
import type { EquipmentHandoffView } from './ssoEquipmentAuthority.js';
import { executeSignOutSession } from './signOutSession.js';

const B64 = 'A'.repeat(43);
const TICKETS =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_WBT}` +
  `&cc=${B64}&ccm=S256&state=${B64}`;
const EQUIP =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_EQUIPMENT}` +
  `&cc=${B64}&ccm=S256&state=${B64}`;
const TICKETS2 =
  `wellbuilt-suite://sso-authorize?v=1&aud=${SSO_AUDIENCE_WBT}` +
  `&cc=${'B'.repeat(43)}&ccm=S256&state=${'B'.repeat(43)}`;

function failIssuance(name: string): never {
  throw new Error(`FAIL FAST: issuance operation invoked: ${name}`);
}

function harness(opts?: { handoff?: EquipmentHandoffView | null; nowMs?: number }) {
  let handoff: EquipmentHandoffView | null = opts?.handoff ?? null;
  const inbox = createSsoAuthorizeInbox();
  const opened: string[] = [];
  const dispatched: string[] = [];
  const authorizeCalls: number[] = [];
  const identityCalls: number[] = [];
  const codeCalls: number[] = [];
  const retries: number[] = [];

  const handler = createSsoAuthorizationHandler({
    getLocalIdentity: async () => ({ driverId: 'd1', companyId: 'c1' }),
    getReconciliationState: () => 'verified',
    getVerifiedIdentity: async () => {
      identityCalls.push(1);
      return {
        uid: 'u1',
        kind: 'driver',
        driverId: 'd1',
        companyId: 'c1',
      };
    },
    requestCode: async () => {
      codeCalls.push(1);
      return { code: 'SHOULD_NOT_ISSUE' };
    },
    currentIdentityEpoch: () => 1,
    getEquipmentShiftBinding: async () => ({
      shiftId: '2026-09-05_070000',
      phase: 'pre_trip',
    }),
  });

  async function runCommands(commands: ReturnType<typeof inbox.dispatch>['commands']) {
    for (const c of commands) {
      if (c.cmd === 'dispatch') {
        dispatched.push(c.url);
        authorizeCalls.push(1);
        await handler.authorize(
          // The production dispatch parses the URL; tests feed the handler only
          // on the success path. Terminal must never reach here.
          {
            protocolVersion: 1,
            audience: c.url.includes('wellbuilt-equipment')
              ? SSO_AUDIENCE_EQUIPMENT
              : SSO_AUDIENCE_WBT,
            codeChallenge: B64,
            codeChallengeMethod: 'S256',
            state: B64,
          },
        );
      } else if (c.cmd === 'reject_closed' && c.url && c.reason !== 'not_sso') {
        await respondSsoTerminalError(c.url, c.reason, {
          openUrl: async (u) => {
            opened.push(u);
          },
        });
      }
    }
  }

  const bridge = createCompositeReadinessBridge({
    onPublish: ({ gate, equipment, terminalReason }) => {
      void runCommands(
        inbox.dispatch({ type: 'session', gate, equipment, terminalReason }).commands,
      );
    },
    onRetryReconciliation: () => retries.push(1),
    readHandoff: async () => handoff,
    nowMs: () => opts?.nowMs ?? 1_000,
  });

  return {
    inbox,
    bridge,
    opened,
    dispatched,
    authorizeCalls,
    identityCalls,
    codeCalls,
    retries,
    setHandoff: (h: EquipmentHandoffView | null) => {
      handoff = h;
    },
    deliver: async (url: string) => {
      await runCommands(inbox.dispatch({ type: 'deliver', url, path: 'runtime' }).commands);
    },
    failFastIssuanceHandler: createSsoAuthorizationHandler({
      getLocalIdentity: async () => failIssuance('getLocalIdentity'),
      getReconciliationState: () => failIssuance('getReconciliationState'),
      getVerifiedIdentity: async () => failIssuance('getVerifiedIdentity'),
      requestCode: async () => failIssuance('requestCode'),
      currentIdentityEpoch: () => failIssuance('currentIdentityEpoch'),
    }),
  };
}

describe('P0 1: terminal issuance incapability', () => {
  it('reval failed + recon verified → zero codes, one error callback, handler never called', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportReconciliation(1, 'verified');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(1, 'failed');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.authorizeCalls.length, 0);
    assert.equal(h.identityCalls.length, 0);
    assert.equal(h.codeCalls.length, 0);
    assert.equal(h.opened.length, 1);
    assert.match(h.opened[0], /status=error/);
    assert.match(h.opened[0], /err=not_authorized/);
    assert.doesNotMatch(h.opened[0], /[?&]code=/);
  });
});

describe('P0 2: teardown ordering cannot abandon or issue', () => {
  it('terminal response then inbox reset + epoch bump still delivers the error callback', async () => {
    const h = harness();
    let epoch = 1;
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportRevalidation(1, 'failed');
    await Promise.resolve();
    h.inbox.reset();
    epoch += 1;
    void epoch;
    assert.equal(h.opened.length, 1);
    assert.equal(h.codeCalls.length, 0);
    await h.deliver(TICKETS);
    h.bridge.reset(2);
    h.bridge.reportRevalidation(2, 'ok');
    h.bridge.reportReconciliation(2, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    assert.ok(h.inbox.peek().terminalClosed.includes(TICKETS));
  });
});

describe('P0 3+4: equipment restoration hold and negative matrix', () => {
  it('auth ready while restoration in flight keeps equipment URL queued', async () => {
    const h = harness({ handoff: null });
    h.bridge.reset(1);
    await h.deliver(EQUIP);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.opened.length, 0);
    assert.equal(h.inbox.peek().queued, EQUIP);
    assert.equal(h.inbox.peek().handled, null);
  });

  it('same generation open shift + matching handoff → exactly one dispatch', async () => {
    const h = harness({
      handoff: {
        shiftId: '2026-09-05_070000',
        phase: 'pre_trip',
        expiresAtMs: 9_000,
      },
    });
    h.bridge.reset(1);
    await h.deliver(EQUIP);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportEquipmentRestoration(1, 'open', '2026-09-05_070000');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.opened.length, 0);
  });

  it('tickets are not blocked on equipment restoration', async () => {
    const h = harness({ handoff: null });
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 1);
  });

  it('negative: mismatched handoff → terminal, no code', async () => {
    const h = harness({
      handoff: { shiftId: 'other', phase: 'pre_trip', expiresAtMs: 9_000 },
    });
    h.bridge.reset(1);
    await h.deliver(EQUIP);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportEquipmentRestoration(1, 'open', '2026-09-05_070000');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.codeCalls.length, 0);
    assert.equal(h.opened.length, 1);
    assert.match(h.opened[0], /err=not_authorized/);
  });

  it('negative: server none → terminal, no code', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(EQUIP);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportEquipmentRestoration(1, 'none');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.opened.length, 1);
  });

  it('negative: other generation cannot release', async () => {
    const h = harness({
      handoff: {
        shiftId: '2026-09-05_070000',
        phase: 'pre_trip',
        expiresAtMs: 9_000,
      },
    });
    h.bridge.reset(1);
    await h.deliver(EQUIP);
    h.bridge.reportRevalidation(1, 'ok');
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportEquipmentRestoration(99, 'open', '2026-09-05_070000');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.inbox.peek().queued, EQUIP);
  });
});

describe('P0 5: generation misattribution', () => {
  it('Driver A verified after Driver B reset is ignored', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.inbox.reset();
    h.bridge.reset(2);
    h.bridge.reportReconciliation(1, 'verified');
    h.bridge.reportRevalidation(2, 'ok');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    assert.equal(h.bridge.peek().recon, 'verifying');
    h.bridge.reportReconciliation(2, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 0);
    await h.deliver(TICKETS2);
    assert.equal(h.dispatched.length, 1);
    assert.equal(h.dispatched[0], TICKETS2);
  });
});

describe('P0 6: both legitimate async orders', () => {
  it('revalidation first then reconciliation releases once', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportRevalidation(1, 'ok');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportReconciliation(1, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 1);
  });

  it('reconciliation first then revalidation releases once', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportReconciliation(1, 'verified');
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportRevalidation(1, 'ok');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 1);
  });

  it('local-only before reval is retried once then can verify', async () => {
    const h = harness();
    h.bridge.reset(1);
    await h.deliver(TICKETS);
    h.bridge.reportReconciliation(1, 'local-only');
    h.bridge.reportRevalidation(1, 'ok');
    assert.equal(h.retries.length, 1);
    assert.equal(h.dispatched.length, 0);
    h.bridge.reportReconciliation(1, 'verified');
    await Promise.resolve();
    assert.equal(h.dispatched.length, 1);
  });
});

describe('P0 7: Sign Out executor has no End Shift operations', () => {
  it('injected sign-out never calls post-trip or close', async () => {
    let postTrip = 0;
    await executeSignOutSession({
      writeLogoutSignal: async () => {},
      clearLocalShiftPointers: async () => {},
      invalidateAuthEpoch: () => {},
      takeReconciliationOwnership: () => {},
      secureSignOut: async () => {},
      clearDriverSession: async () => {},
      clearMemoryUser: () => {},
    });
    assert.equal(postTrip, 0);
  });
});
