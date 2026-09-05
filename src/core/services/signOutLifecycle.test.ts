/**
 * P0 enterprise-handoff — Sign Out vs End Shift lifecycle (source-wiring pins).
 *
 * No RN render harness exists for AuthContext, so the lifecycle separation is
 * pinned from source (same discipline as the SSO inbox wiring tests):
 *  - Sign Out (logout / logoutWithCascade) terminates/cascades the session ONLY —
 *    it never runs the Post-Trip gate, closes the shift, or writes pendingEndShiftId.
 *  - End Shift (confirmArrival + the ShiftArrivalModal) remains the sole action
 *    that closes a period and arms Post-Trip.
 *  - ensurePostTripGate refuses to arm Post-Trip without a completed Pre-Trip.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');
const authCtx = read('../context/AuthContext.tsx');
const actionCardRow = read('../../ui/shared/ActionCardRow.tsx');
const dvirGate = read('./dvirGate/dvirGateService.ts');

// logoutWithCascade (1st) then logout (2nd) both sit AFTER confirmArrival in the file.
const fromLogoutCascade = authCtx.slice(authCtx.indexOf('const logoutWithCascade = useCallback'));
const confirmArrivalBody = authCtx.slice(
  authCtx.indexOf('const confirmArrival = useCallback'),
  authCtx.indexOf('const logoutWithCascade = useCallback'),
);

describe('P0 Sign Out lifecycle (pin 9)', () => {
  it('Sign Out never runs the Post-Trip gate', () => {
    // ensurePostTripGate had exactly two callers — both Sign Out paths — and the
    // correction removed them. It must not appear anywhere in AuthContext now.
    assert.equal(authCtx.includes('ensurePostTripGate'), false);
  });

  it('Sign Out does not close the shift or write a logout shift event', () => {
    // closeEnforcedExplicit / recordShiftEvent('logout') belong to End Shift
    // (confirmArrival), which precedes the logout functions. Nothing from
    // logoutWithCascade onward may close the shift.
    assert.equal(fromLogoutCascade.includes('closeEnforcedExplicit'), false);
    assert.equal(fromLogoutCascade.includes("recordShiftEvent("), false);
  });

  it('Sign Out still terminates + cascades the authenticated session', () => {
    assert.ok(fromLogoutCascade.includes('setUser(null)'));
    assert.ok(fromLogoutCascade.includes('writeLogoutSignal'));
    assert.ok(fromLogoutCascade.includes('secureSignOut'));
    // Terminal-fail is routed through composite readiness (bridge publishes the
    // failed gate → inbox returns a bounded error to any queued authorize).
    assert.ok(fromLogoutCascade.includes("reportSsoRevalidation(readinessGenRef.current, 'failed')"));
  });

  it('both Sign Out paths carry the explicit P0 correction', () => {
    const marks = authCtx.split('SIGN OUT lifecycle (P0 enterprise-handoff correction)').length - 1;
    assert.equal(marks, 2);
  });

  it('End Shift (confirmArrival) still closes the period via the server callable', () => {
    assert.ok(confirmArrivalBody.includes('closeEnforcedExplicit'));
  });

  it('End Shift (ShiftArrivalModal) remains the Post-Trip trigger', () => {
    // The arrival/End-Shift modal is the legitimate ensurePostTripGate caller.
    assert.ok(actionCardRow.includes('ensurePostTripGate'));
  });

  it('ensurePostTripGate refuses to arm Post-Trip without a completed Pre-Trip (pin 8 guard present)', () => {
    const gateBody = dvirGate.slice(dvirGate.indexOf('export async function ensurePostTripGate'));
    const guardIdx = gateBody.indexOf('isPreTripCompleteForShift');
    const armIdx = gateBody.indexOf('setPendingEndShift');
    assert.ok(guardIdx > -1, 'Pre-Trip guard present');
    assert.ok(guardIdx < armIdx, 'guard precedes pendingEndShift arming');
  });
});
