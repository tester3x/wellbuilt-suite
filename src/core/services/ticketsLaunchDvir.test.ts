/**
 * WB-T card launch must not consult the DVIR gate, on or off shift.
 * Shift-start Pre-Trip and return-to-yard / logout Post-Trip stay put.
 *
 * Run: npx tsx --test src/core/services/ticketsLaunchDvir.test.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { wbtSsoStartUrl } from './ssoLaunchPolicy.js';

const CORE = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(CORE, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CARD_LAUNCH =
  'launchWBApp({ name: app.name, scheme: app.scheme, androidPackage: app.androidPackage, webUrl: app.webUrl })';

const GRID_SCREENS = [
  '../ui/v1-grid/screens/HomeScreen.tsx',
  '../ui/v1-grid/screens/AppDetailScreen.tsx',
  '../ui/v2-dashboard/screens/HomeScreen.tsx',
  '../ui/v2-dashboard/screens/AppDetailScreen.tsx',
  '../ui/v3-sidebar/screens/HomeScreen.tsx',
  '../ui/v3-sidebar/screens/AppDetailScreen.tsx',
  '../ui/v4-widget/screens/HomeScreen.tsx',
  '../ui/v4-widget/screens/AppDetailScreen.tsx',
];

describe('WB-T card tap launches directly', () => {
  it('the catalog card is water-ticket on wellbuilt-tickets', () => {
    const apps = read('data/apps.ts');
    const card = apps.slice(apps.indexOf("id: 'water-ticket'"), apps.indexOf("id: 'wellbuilt-jsa'"));
    assert.ok(card.length > 40, 'water-ticket card missing');
    assert.match(card, /scheme: 'wellbuilt-tickets'/);
    assert.equal(wbtSsoStartUrl(), 'wellbuilt-tickets://sso-start');
  });

  it('every skin grid and detail screen sends that card through useAppLauncher', () => {
    for (const rel of GRID_SCREENS) {
      const src = read(rel);
      assert.match(src, /useAppLauncher\(\)/, rel);
      assert.ok(src.includes(CARD_LAUNCH), `${rel} does not pass app.scheme to launchWBApp`);
    }
    const hook = read('hooks/useAppLauncher.ts');
    assert.match(hook, /launchWBApp: launchWB/);
  });

  it('launchWB does not consult shift state or DVIR before the credential-free return', () => {
    const hook = strip(read('hooks/useAppLauncher.ts'));
    const start = hook.indexOf('const launchWB = useCallback');
    const end = hook.indexOf('return launchWBApp({ ...options, sso });', start);
    assert.ok(start > -1 && end > start);
    const body = hook.slice(start, end);
    const direct = body.indexOf(
      'return await launchWBApp({ ...options, sso: undefined, startHost: WBT_SSO_START_HOST })',
    );
    assert.ok(direct > -1, 'credential-free sso-start return missing');
    // shiftActive is only read later, for legacy hash apps. WB-T returns
    // on the line above whether the shift is active or not.
    const shiftAt = body.indexOf('shiftActive');
    assert.ok(shiftAt > direct, 'shiftActive is read before the Tickets return');
    assert.equal(body.includes('isTicketsLaunch'), false);
    assert.equal(body.includes('ensurePreTripGate'), false);
    assert.equal(body.includes('ensurePostTripGate'), false);
    assert.equal(body.includes('dvirGate'), false);
    assert.ok(body.includes('armSsoHandoffOutbound(audience, Date.now())'));
    assert.ok(body.includes('noteSsoHandoffLaunchFailure()'));
    assert.ok(body.indexOf('armSsoHandoffOutbound') < direct);
    assert.ok(direct < body.indexOf('noteSsoHandoffLaunchFailure()'));
  });
});

describe('shift DVIR stays on the shift actions', () => {
  it('Pre-Trip runs only after an explicit successful shift start', () => {
    const row = read('../ui/shared/ActionCardRow.tsx');
    const start = row.indexOf('const handleStartConfirm');
    const ret = row.indexOf('const handleReturnToYard');
    assert.ok(start > -1 && ret > start);
    const body = row.slice(start, ret);
    const success = body.indexOf('if (!isExplicitStartShiftSuccess(result))');
    const pre = body.indexOf('ensurePreTripGate({ alertOnBlock: true })');
    assert.ok(success > -1 && pre > success);
    assert.match(body, /return;[\s\S]*setShowStartModal\(false\);[\s\S]*ensurePreTripGate\(\{ alertOnBlock: true \}\)/);
  });

  it('Post-Trip runs before return-to-yard arrival closes the shift', () => {
    // This invariant now holds MORE strongly than when it was frozen. It used
    // to be satisfied inside onConfirm: the modal opened first, the driver
    // ticked an unverified Post-Trip box, and ensurePostTripGate launched WB-E
    // only on confirm. Post-Trip now runs at Mark Arrived, BEFORE the mileage
    // modal exists, and the close is gated on a verified receipt for this
    // exact shift rather than on a checkbox.
    const row = read('../ui/shared/ActionCardRow.tsx');

    // 1. The handoff happens at Mark Arrived, not at confirm.
    assert.ok(row.includes('onArrived={handleMarkArrived}'), 'Mark Arrived drives the handoff');
    const markArrived = row.slice(row.indexOf('const handleMarkArrived'));
    assert.ok(markArrived.indexOf('coordinator.markArrived(gate)') > -1);
    // Mark Arrived must never close the shift.
    assert.ok(
      markArrived.slice(0, markArrived.indexOf('const handleShiftPress')) .indexOf('onArrived(') === -1,
      'Mark Arrived must not close the shift',
    );

    // 2. The close goes through the checked path, which requires the receipt.
    const arrival = row.slice(row.indexOf('onConfirm={async (miles)'));
    const finalize = arrival.indexOf('coordinator.finalizeArrival(gate, {');
    const close = arrival.indexOf('close: async (m) => (await onArrived(m)) !== false');
    assert.ok(finalize > -1, 'the final submit goes through finalizeArrival');
    assert.ok(close > finalize, 'the close is the callback finalizeArrival invokes');
    assert.match(arrival, /if \(!result\.ok\) \{[\s\S]*return;/, 'a blocked submit keeps the modal');

    // 3. finalizeArrival itself requires a verified Post-Trip receipt.
    const coordinator = read('services/dvirGate/arrivalCoordinator.ts');
    assert.ok(coordinator.includes('postTripReceiptValid'));
    const flow = read('services/dvirGate/arrivalFlow.ts');
    assert.ok(flow.includes("if (!input.postTripReceiptValid) return { ok: false, reason: 'post_trip_missing' };"));
  });

  it('logout still requires Post-Trip while a shift is active', () => {
    const auth = read('context/AuthContext.tsx');
    for (const fn of ['const logoutWithCascade = useCallback', 'const logout = useCallback']) {
      const at = auth.indexOf(fn);
      assert.ok(at > -1, fn);
      const body = auth.slice(at, at + 1800);
      assert.match(body, /if \(shiftActive && user\)/);
      assert.match(body, /ensurePostTripGate\(\{ alertOnBlock: true \}\)/);
      assert.match(body, /if \(!post\.allowed\)/);
    }
  });
});
