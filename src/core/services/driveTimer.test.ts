import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  PLAUSIBLE_RETURN_DRIVE_MAX_MS,
  driveElapsedMs,
  formatDriveElapsed,
  isStaleReturnDrive,
} from './driveTimer';

const NOW = Date.parse('2026-09-10T13:00:00.000Z');

test('formatDriveElapsed reproduces the current UI formatting exactly', () => {
  const oneHr = new Date(NOW - (3600 + 2 * 60 + 3) * 1000).toISOString();
  assert.equal(formatDriveElapsed(oneHr, NOW), '1:02:03');
  const subHr = new Date(NOW - (7 * 60 + 5) * 1000).toISOString();
  assert.equal(formatDriveElapsed(subHr, NOW), '7:05');
  assert.equal(formatDriveElapsed(null, NOW), '0:00');
  // Negative (clock skew) floors at 0.
  assert.equal(formatDriveElapsed(new Date(NOW + 5000).toISOString(), NOW), '0:00');
});

test('reproduces the observed stale symptom: a ~120h-old departTime renders as an impossible multi-day drive', () => {
  const fiveDaysAgo = new Date(NOW - (120 * 3600 + 26 * 60 + 22) * 1000).toISOString();
  // This is exactly what the field device showed (120:26:22) — technically the
  // elapsed since a stuck returnDepartTime, but not a real Drive Time.
  assert.equal(formatDriveElapsed(fiveDaysAgo, NOW), '120:26:22');
  assert.ok(driveElapsedMs(fiveDaysAgo, NOW) > PLAUSIBLE_RETURN_DRIVE_MAX_MS);
});

test('isStaleReturnDrive detects the stuck departTime but not a real drive', () => {
  const thirtyMin = new Date(NOW - 30 * 60 * 1000).toISOString();
  const fiveDays = new Date(NOW - 120 * 3600 * 1000).toISOString();
  assert.equal(isStaleReturnDrive(thirtyMin, NOW), false);
  assert.equal(isStaleReturnDrive(fiveDays, NOW), true);
  assert.equal(isStaleReturnDrive(null, NOW), false);
});

/**
 * FAILING REGRESSION (red until the defect is fixed) — do not merge as green.
 *
 * The EN ROUTE "Drive Time" card renders `Date.now() - returnDepartTime` with no
 * plausibility guard, so a stuck/stale returnDepartTime (arrival blocked, never
 * cleared) shows an impossible multi-day drive (observed 120:26:22). The card
 * must consult a staleness guard (isStaleReturnDrive / PLAUSIBLE_RETURN_DRIVE_*)
 * and NOT present a stale value as a live counter. This test asserts the guard
 * is wired into the component; it fails today because no guard exists.
 */
test('REGRESSION: EnRouteYardCard must guard Drive Time against a stale returnDepartTime', () => {
  const root = join(__dirname, '..', '..', '..');
  const card = readFileSync(join(root, 'src', 'ui', 'shared', 'EnRouteYardCard.tsx'), 'utf8');
  assert.ok(
    card.includes('isStaleReturnDrive') || card.includes('PLAUSIBLE_RETURN_DRIVE'),
    'EnRouteYardCard renders Drive Time with no staleness guard — a stuck ' +
      'returnDepartTime shows an impossible multi-day drive (observed 120:26:22). ' +
      'Wire in isStaleReturnDrive from core/services/driveTimer.',
  );
});
