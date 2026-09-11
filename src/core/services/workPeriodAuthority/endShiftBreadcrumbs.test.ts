import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  FORBIDDEN_BREADCRUMB_KEYS,
  __setBreadcrumbSink,
  emitEndShiftBreadcrumb,
  sanitizeBreadcrumbFields,
} from './endShiftBreadcrumbs.js';

describe('endShiftBreadcrumbs (sanitized, non-behavioral)', () => {
  afterEach(() => __setBreadcrumbSink(null));

  it('drops credential / reusable-identity keys, keeps operational state', () => {
    const out = sanitizeBreadcrumbFields({
      action: 'existing_flow',
      reason: 'obligation_unknown',
      serverState: 'open',
      periodId: '2026-08-23_232617',
      // forbidden — must NOT survive:
      driverId: 'D1',
      uid: 'U1',
      passcodeHash: 'HASH',
      hash: 'HASH',
      token: 'T',
      companyId: 'liquid-gold',
      displayName: 'Mikezfold',
    } as Record<string, unknown>);
    assert.deepEqual(out, {
      action: 'existing_flow',
      reason: 'obligation_unknown',
      serverState: 'open',
      periodId: '2026-08-23_232617',
    });
    for (const k of ['driverId', 'uid', 'passcodeHash', 'hash', 'token', 'companyId', 'displayName']) {
      assert.ok(!(k in out), `${k} must be dropped`);
    }
  });

  it('is case-insensitive about forbidden keys and omits undefined', () => {
    const out = sanitizeBreadcrumbFields({
      Action: undefined,
      DRIVERID: 'x',
      PasscodeHash: 'y',
      shiftOpen: true,
    } as Record<string, unknown>);
    assert.deepEqual(out, { shiftOpen: true });
  });

  it('FORBIDDEN list covers the identity/credential surface', () => {
    for (const k of ['driverid', 'uid', 'hash', 'passcode', 'passcodehash', 'token', 'companyid', 'displayname', 'verifier']) {
      assert.ok(FORBIDDEN_BREADCRUMB_KEYS.includes(k), `expected forbidden: ${k}`);
    }
  });

  it('emits a tagged, sanitized JSON line and returns the record', () => {
    const lines: string[] = [];
    __setBreadcrumbSink((l) => lines.push(l));
    const rec = emitEndShiftBreadcrumb('route_decision', {
      action: 'direct_close',
      serverState: 'open',
      preTrip: 'no',
      driverId: 'LEAK',
    } as Record<string, unknown>);
    assert.equal(rec.event, 'route_decision');
    assert.equal(rec.action, 'direct_close');
    assert.ok(!('driverId' in rec));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].startsWith('[endShiftTrace] '));
    assert.ok(!lines[0].includes('LEAK'));
    const parsed = JSON.parse(lines[0].replace('[endShiftTrace] ', ''));
    assert.equal(parsed.event, 'route_decision');
  });

  it('never throws even if the sink throws (logging must not break the flow)', () => {
    __setBreadcrumbSink(() => {
      throw new Error('sink boom');
    });
    assert.doesNotThrow(() => emitEndShiftBreadcrumb('tap', { source: 'logout_icon' }));
  });
});
