/**
 * Sign Out vs End Shift — injected runtime dependencies, not source-text.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { executeSignOutSession } from './signOutSession.js';

describe('executeSignOutSession', () => {
  it('never receives Post-Trip / pendingEndShift / server-close operations', async () => {
    const calls: string[] = [];
    await executeSignOutSession({
      writeLogoutSignal: async () => {
        calls.push('signal');
      },
      clearLocalShiftPointers: async () => {
        calls.push('pointers');
      },
      invalidateAuthEpoch: () => {
        calls.push('epoch');
      },
      takeReconciliationOwnership: () => {
        calls.push('recon');
      },
      secureSignOut: async () => {
        calls.push('secure');
      },
      clearDriverSession: async () => {
        calls.push('session');
      },
      clearMemoryUser: () => {
        calls.push('memory');
      },
    });
    assert.deepEqual(calls, [
      'signal',
      'pointers',
      'epoch',
      'recon',
      'secure',
      'session',
      'memory',
    ]);
    assert.ok(!calls.includes('postTrip'));
    assert.ok(!calls.includes('pendingEndShift'));
    assert.ok(!calls.includes('closeShift'));
  });

  it('clears local pointers without a server-close hook existing on the deps object', async () => {
    const deps = {
      writeLogoutSignal: async () => {},
      clearLocalShiftPointers: async () => {},
      invalidateAuthEpoch: () => {},
      takeReconciliationOwnership: () => {},
      secureSignOut: async () => {},
      clearDriverSession: async () => {},
      clearMemoryUser: () => {},
    };
    assert.equal('ensurePostTripGate' in deps, false);
    assert.equal('setPendingEndShift' in deps, false);
    assert.equal('closeEnforcedExplicit' in deps, false);
    await executeSignOutSession(deps);
  });
});
