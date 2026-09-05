/**
 * Server-authoritative equipment-shift readiness for inbound SSO.
 *
 * Cached SecureStore shiftStarted / React shiftActive / AsyncStorage
 * currentShiftId are local hints. They cannot independently authorize
 * equipment SSO. Release requires, for the same identity generation:
 *   - composite auth ready (revalidation ok + reconciliation verified);
 *   - server-restored or server-claimed open period;
 *   - a valid governed equipment handoff whose shiftId matches that period.
 *
 * While restoration is in flight, or an open period is waiting for a
 * matching handoff, equipment stays pending (queued, no callback, no code).
 */
import type { SsoDvirPhase, SsoShiftBinding } from './ssoProtocol.generated';
import { isSsoShiftBinding } from './ssoProtocol.generated';

export type EquipmentRestoration = 'pending' | 'open' | 'none' | 'failed';
export type EquipmentRelease = 'pending' | 'open' | 'none' | 'failed';

export type EquipmentHandoffView = {
  shiftId: string;
  phase: SsoDvirPhase;
  expiresAtMs: number;
};

export type EquipmentAuthorityState = {
  generation: number;
  restoration: EquipmentRestoration;
  periodId: string | null;
  release: EquipmentRelease;
  binding: SsoShiftBinding | null;
};

export function initialEquipmentAuthority(generation: number): EquipmentAuthorityState {
  return {
    generation,
    restoration: 'pending',
    periodId: null,
    release: 'pending',
    binding: null,
  };
}

export function computeEquipmentRelease(args: {
  restoration: EquipmentRestoration;
  periodId: string | null;
  handoff: EquipmentHandoffView | null;
  nowMs: number;
}): { release: EquipmentRelease; binding: SsoShiftBinding | null } {
  if (args.restoration === 'pending') {
    return { release: 'pending', binding: null };
  }
  if (args.restoration === 'none') {
    return { release: 'none', binding: null };
  }
  if (args.restoration === 'failed') {
    return { release: 'failed', binding: null };
  }
  if (!args.periodId) {
    return { release: 'failed', binding: null };
  }
  if (!args.handoff) {
    // Restoration is open but the governed launch record is not present yet.
    // Hold — do not treat cached flags as a substitute, and do not burn the URL.
    return { release: 'pending', binding: null };
  }
  if (args.nowMs > args.handoff.expiresAtMs) {
    return { release: 'failed', binding: null };
  }
  if (args.handoff.shiftId !== args.periodId) {
    return { release: 'failed', binding: null };
  }
  const binding: SsoShiftBinding = {
    shiftId: args.periodId,
    phase: args.handoff.phase,
  };
  if (!isSsoShiftBinding(binding)) {
    return { release: 'failed', binding: null };
  }
  return { release: 'open', binding };
}
