/**
 * Durable inbound authorize inbox — no shift/ticket mutation.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  initialSsoInboxState,
  reduceSsoInbox,
  type SsoInboxState,
} from './ssoAuthorizeInbox';

const AUTH = 'wellbuilt-suite://sso-authorize?v=1&aud=wellbuilt-tickets&cc=ccc&ccm=S256&state=sss';
const AUTH2 = 'wellbuilt-suite://sso-authorize?v=1&aud=wellbuilt-tickets&cc=ddd&ccm=S256&state=ttt';
const OTHER = 'wellbuilt-suite://home';

const root = join(__dirname, '..', '..', '..');
const src = (p: string) => readFileSync(join(root, p), 'utf8');

function fold(events: Parameters<typeof reduceSsoInbox>[1][], start: SsoInboxState = initialSsoInboxState) {
  let state = start;
  const dispatches: string[] = [];
  const rejects: string[] = [];
  for (const event of events) {
    const r = reduceSsoInbox(state, event);
    state = r.state;
    for (const c of r.commands) {
      if (c.cmd === 'dispatch') dispatches.push(c.url);
      if (c.cmd === 'reject_closed') rejects.push(c.reason);
    }
  }
  return { state, dispatches, rejects };
}

test('authorize delivered through initial URL is processed once after ready', () => {
  const r = fold([
    { type: 'deliver', url: AUTH, path: 'initial' },
    { type: 'session', gate: 'ready' },
  ]);
  assert.deepEqual(r.dispatches, [AUTH]);
  const again = fold([{ type: 'deliver', url: AUTH, path: 'initial' }], r.state);
  assert.equal(again.dispatches.length, 0);
});

test('authorize delivered through runtime listener is processed once', () => {
  const r = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: AUTH, path: 'runtime' },
  ]);
  assert.deepEqual(r.dispatches, [AUTH]);
});

test('identical initial/runtime delivery is deduplicated', () => {
  const r = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: AUTH, path: 'initial' },
    { type: 'deliver', url: AUTH, path: 'runtime' },
  ]);
  assert.equal(r.dispatches.length, 1);
});

test('authorize delivered through task reuse/onNewIntent is processed once', () => {
  const r = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: AUTH, path: 'onNewIntent' },
    { type: 'deliver', url: AUTH, path: 'resume' },
  ]);
  assert.equal(r.dispatches.length, 1);
});

test('authorize arriving during session revalidation is queued', () => {
  const r = fold([{ type: 'deliver', url: AUTH, path: 'runtime' }]);
  assert.equal(r.dispatches.length, 0);
  assert.equal(r.state.queued, AUTH);
  assert.equal(r.state.gate, 'pending');
});

test('queued authorize runs once after session readiness', () => {
  const r = fold([
    { type: 'deliver', url: AUTH, path: 'runtime' },
    { type: 'session', gate: 'ready' },
    { type: 'session', gate: 'ready' },
  ]);
  assert.equal(r.dispatches.length, 1);
});

test('revalidation failure does not issue a ticket', () => {
  const queued = fold([{ type: 'deliver', url: AUTH, path: 'runtime' }]);
  const failed = fold([{ type: 'session', gate: 'failed' }], queued.state);
  assert.equal(failed.dispatches.length, 0);
  assert.ok(failed.rejects.includes('revalidation_failed'));
  assert.equal(failed.state.queued, null);
  const afterReady = fold([{ type: 'session', gate: 'ready' }], failed.state);
  assert.equal(afterReady.dispatches.length, 0);
});

test('stale generation cannot issue after logout/session replacement', () => {
  const ready = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: AUTH, path: 'runtime' },
  ]);
  assert.equal(ready.dispatches.length, 1);
  const reset = fold([{ type: 'reset' }, { type: 'deliver', url: AUTH2, path: 'runtime' }], ready.state);
  assert.equal(reset.dispatches.length, 0);
  assert.equal(reset.state.queued, AUTH2);
  const next = fold([{ type: 'session', gate: 'ready' }], reset.state);
  assert.deepEqual(next.dispatches, [AUTH2]);
});

test('exactly one ticket and callback per transaction (single dispatch)', () => {
  const r = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: AUTH, path: 'initial' },
    { type: 'deliver', url: AUTH, path: 'runtime' },
    { type: 'deliver', url: AUTH, path: 'onNewIntent' },
    { type: 'deliver', url: AUTH, path: 'resume' },
  ]);
  assert.equal(r.dispatches.length, 1);
});

test('non-authorize URLs are rejected and never queued', () => {
  const r = fold([
    { type: 'session', gate: 'ready' },
    { type: 'deliver', url: OTHER, path: 'runtime' },
  ]);
  assert.equal(r.dispatches.length, 0);
  assert.ok(r.rejects.includes('not_sso'));
});

test('inbox never claims or mutates a shift', () => {
  const file = src('src/core/services/ssoAuthorizeInbox.ts');
  assert.ok(!file.includes('claimDriverShift'));
  assert.ok(!file.includes('claimEnforcedExplicitStart'));
  assert.ok(!/\.claim\(/.test(file));
});

test('wiring: Linking listener is not torn down on user change', () => {
  const layout = src('app/_layout.tsx');
  assert.ok(layout.includes('SsoAuthorizeListener') || layout.includes('acceptSsoAuthorizeUrl'));
  assert.ok(layout.includes('acceptSsoAuthorizeUrl') || layout.includes('ssoAuthorizeInbox'));
  assert.ok(/addEventListener\('url'/.test(layout));
  assert.ok(/getInitialURL/.test(layout));
  assert.ok(/AppState\.addEventListener\('change'/.test(layout));
});

test('wiring: AuthContext publishes session gate after revalidation', () => {
  const auth = src('src/core/context/AuthContext.tsx');
  assert.ok(auth.includes('setSsoSessionGate'));
  const mount = auth.slice(
    auth.indexOf('// On mount: check SecureStore'),
    auth.indexOf('const login = useCallback'),
  );
  assert.ok(mount.indexOf("setSsoSessionGate('ready')") > mount.indexOf('revalidateDriverSession'));
});

test('parked authorize survives listener remount-equivalent resume replay', () => {
  const queued = fold([{ type: 'deliver', url: AUTH, path: 'initial' }]);
  assert.equal(queued.dispatches.length, 0);
  const remount = fold([{ type: 'deliver', url: AUTH, path: 'resume' }], queued.state);
  assert.equal(remount.dispatches.length, 0);
  assert.equal(remount.state.queued, AUTH);
  const ready = fold([{ type: 'session', gate: 'ready' }], remount.state);
  assert.deepEqual(ready.dispatches, [AUTH]);
});

test('logout reset bumps generation and cannot drain a failed gate', () => {
  const queued = fold([{ type: 'deliver', url: AUTH, path: 'runtime' }]);
  const gen = queued.state.generation;
  const reset = fold([{ type: 'reset' }], queued.state);
  assert.equal(reset.state.generation, gen + 1);
  assert.equal(reset.state.queued, null);
  const failed = fold([
    { type: 'deliver', url: AUTH2, path: 'runtime' },
    { type: 'session', gate: 'failed' },
  ], reset.state);
  assert.equal(failed.dispatches.length, 0);
  assert.ok(failed.rejects.includes('revalidation_failed'));
});

test('inbox never uses hash-only identity fallback', () => {
  const file = src('src/core/services/ssoAuthorizeInbox.ts');
  assert.ok(!/passcodeHash|hashOnly|hash-only|legacyHash/.test(file));
});

test('wiring: SsoAuthorizeListener mounts once with empty deps', () => {
  const layout = src('app/_layout.tsx');
  const start = layout.indexOf('function SsoAuthorizeListener');
  const slice = layout.slice(start, layout.indexOf('function DvirReceiptListener'));
  assert.ok(slice.includes('useEffect(() => {'));
  assert.ok(slice.includes('}, []);'));
});
