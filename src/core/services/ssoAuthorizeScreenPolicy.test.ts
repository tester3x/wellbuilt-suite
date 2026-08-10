/**
 * Pure policy tests for sso-authorize dead-end fix.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  audienceFromAuthorizeParams,
  authorizeWorkingCopy,
  decideAfterAuthorizeDispatch,
  FORBIDDEN_SUCCESS_COPY,
} from './ssoAuthorizeScreenPolicy';
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_WBT,
} from './ssoProtocol.generated';

const root = join(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

test('audienceFromAuthorizeParams maps tickets and equipment', () => {
  assert.equal(audienceFromAuthorizeParams(SSO_AUDIENCE_WBT), SSO_AUDIENCE_WBT);
  assert.equal(audienceFromAuthorizeParams(SSO_AUDIENCE_EQUIPMENT), SSO_AUDIENCE_EQUIPMENT);
  assert.equal(audienceFromAuthorizeParams('nope'), null);
  assert.equal(audienceFromAuthorizeParams(undefined), null);
  assert.equal(audienceFromAuthorizeParams([SSO_AUDIENCE_WBT]), SSO_AUDIENCE_WBT);
});

test('working copy is audience-aware and never assumes equipment for tickets', () => {
  assert.match(authorizeWorkingCopy(SSO_AUDIENCE_WBT), /Tickets/i);
  assert.match(authorizeWorkingCopy(SSO_AUDIENCE_EQUIPMENT), /eQuipment/i);
  assert.match(authorizeWorkingCopy(null), /app/i);
  assert.ok(!authorizeWorkingCopy(SSO_AUDIENCE_WBT).toLowerCase().includes('equipment'));
});

test('tickets answered success → navigate Home immediately, no error', () => {
  const d = decideAfterAuthorizeDispatch({ kind: 'answered', status: 'success' });
  assert.equal(d.navigateHome, true);
  assert.equal(d.status, 'leaving');
  assert.equal(d.homeDelayMs, 0);
  assert.equal(d.errorMessage, null);
});

test('equipment answered success → navigate Home', () => {
  const d = decideAfterAuthorizeDispatch({ kind: 'answered', status: 'success' });
  assert.equal(d.navigateHome, true);
  assert.equal(d.status, 'leaving');
});

test('answered error → error UI then Home (not success copy)', () => {
  const d = decideAfterAuthorizeDispatch({ kind: 'answered', status: 'error' });
  assert.equal(d.navigateHome, true);
  assert.equal(d.status, 'error');
  assert.ok(d.homeDelayMs > 0);
  assert.ok(d.errorMessage);
});

test('duplicate still navigates Home without second callback responsibility', () => {
  const d = decideAfterAuthorizeDispatch({ kind: 'duplicate' });
  assert.equal(d.navigateHome, true);
  assert.equal(d.status, 'leaving');
  assert.equal(d.homeDelayMs, 0);
});

test('busy still navigates Home (does not park or cancel original)', () => {
  const d = decideAfterAuthorizeDispatch({ kind: 'busy' });
  assert.equal(d.navigateHome, true);
  assert.equal(d.status, 'leaving');
});

test('callback-failed and abandoned → error recovery Home', () => {
  for (const kind of ['callback-failed', 'abandoned'] as const) {
    const d = decideAfterAuthorizeDispatch({ kind });
    assert.equal(d.navigateHome, true);
    assert.equal(d.status, 'error');
    assert.ok(d.homeDelayMs > 0);
  }
});

test('wiring: sso-authorize replaces Home and forbids equipment return copy', () => {
  const screen = src('app/sso-authorize.tsx');
  assert.ok(screen.includes('router.replace'));
  assert.ok(screen.includes("'/home'") || screen.includes('"/home"'));
  assert.ok(screen.includes('decideAfterAuthorizeDispatch'));
  assert.ok(screen.includes('dispatchSsoUrl'));
  for (const bad of FORBIDDEN_SUCCESS_COPY) {
    assert.ok(!screen.includes(bad), `forbidden copy present: ${bad}`);
  }
  assert.ok(!screen.includes('Returning to equipment'));
});

test('wiring: dispatchSsoUrl returns full route result; layout uses isSsoRouteClaimed', () => {
  const rt = src('src/core/services/ssoRuntime.ts');
  assert.ok(rt.includes('export async function dispatchSsoUrl'));
  assert.ok(rt.includes('export function isSsoRouteClaimed'));
  assert.ok(rt.includes('getSsoRouteAdapter().handle'));
  const layout = src('app/_layout.tsx');
  assert.ok(layout.includes('isSsoRouteClaimed'));
  assert.ok(!/if \(await dispatchSsoUrl\(url\)\) return;/.test(layout));
});

test('no HOS in sso authorize policy', () => {
  const p = src('src/core/services/ssoAuthorizeScreenPolicy.ts');
  assert.ok(!/rest.?hour|hos\b|hours.?of.?service/i.test(p));
});
