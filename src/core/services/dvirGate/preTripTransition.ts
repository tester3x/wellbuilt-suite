import type { DvirGateDeps } from './dvirGateService';
import { isPreTripCompleteForShift } from './dvirGateService';

export type PreTripTransition =
  | { allowed: true; shiftId: string }
  | { allowed: false; reason: 'no_open_shift' | 'pre_trip_missing' | 'pre_trip_unverified' | 'period_mismatch' };

/** Check before any return/arrival writes, including restored or stale UI. */
export async function checkPreTripTransition(deps: DvirGateDeps): Promise<PreTripTransition> {
  try {
    if (deps.isShiftActive && !await deps.isShiftActive()) return { allowed: false, reason: 'no_open_shift' };
    const shiftId = await deps.getCurrentShiftId();
    if (!shiftId) return { allowed: false, reason: 'no_open_shift' };
    if (!await isPreTripCompleteForShift(deps, shiftId)) return { allowed: false, reason: 'pre_trip_missing' };
    if (await deps.getCurrentShiftId() !== shiftId || deps.isShiftActive && !await deps.isShiftActive()) {
      return { allowed: false, reason: 'period_mismatch' };
    }
    return { allowed: true, shiftId };
  } catch {
    return { allowed: false, reason: 'pre_trip_unverified' };
  }
}
