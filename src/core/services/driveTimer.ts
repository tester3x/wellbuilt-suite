// src/core/services/driveTimer.ts
//
// Pure helpers for the EN ROUTE "Drive Time" display.
//
// DEFECT (119:xx / 120:xx stale Drive Time): the return-drive timer is computed
// as `Date.now() - returnDepartTime` and rendered directly, with no upper
// plausibility bound. `returnDepartTime` is persisted when a return drive starts
// (AuthContext) and cleared only on confirmed arrival / shift close. If arrival
// is blocked (e.g. the Mark-Arrived gate never resolves), the timestamp is never
// cleared and the card presents an ever-growing, physically impossible drive
// time (observed 120:26:22 ≈ 5 days). A return-to-yard drive is bounded in
// hours, not days — beyond a plausible window the value is stale local state,
// NOT a real duration, and must not be shown as a live counter.
//
// This module extracts the shared elapsed/format logic (identical to the copies
// currently inlined in EnRouteYardCard / ActionCardRow / ShiftButton /
// AppSwitcher) and adds the staleness detector the fix will wire into the UI.
// It is deliberately independent of react-native so it is unit-testable.

/**
 * Upper bound on a plausible return-to-yard drive. Anything longer means
 * `returnDepartTime` is stale/stuck (never cleared), not a live drive.
 * 12h is generous for a return leg while still ruling out multi-day values.
 */
export const PLAUSIBLE_RETURN_DRIVE_MAX_MS = 12 * 60 * 60 * 1000;

/** Elapsed ms since the ISO start, floored at 0 (matches current UI formula). */
export function driveElapsedMs(startIso: string | null | undefined, nowMs: number): number {
  if (!startIso) return 0;
  const started = new Date(startIso).getTime();
  if (!Number.isFinite(started)) return 0;
  const ms = nowMs - started;
  return ms < 0 ? 0 : ms;
}

/**
 * Exact reproduction of the elapsed formatting currently inlined in the UI:
 * `H:MM:SS` when there is at least one hour, else `M:SS`.
 */
export function formatDriveElapsed(startIso: string | null | undefined, nowMs: number): string {
  const ms = driveElapsedMs(startIso, nowMs);
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * True when the elapsed since `returnDepartTime` exceeds the plausible window —
 * i.e. the timestamp is stale/stuck and must not be shown as a live Drive Time.
 * This is the guard the UI is currently missing.
 */
export function isStaleReturnDrive(startIso: string | null | undefined, nowMs: number): boolean {
  if (!startIso) return false;
  return driveElapsedMs(startIso, nowMs) > PLAUSIBLE_RETURN_DRIVE_MAX_MS;
}
