/**
 * Authoritative shift binding for equipment SSO issuance.
 *
 * Set when Suite launches a governed DVIR handoff; consumed when WB-S
 * issues an equipment authorization code. Identity never comes from URI.
 */
import type { SsoDvirPhase, SsoShiftBinding } from '../ssoProtocol.generated';
import { isSsoShiftBinding } from '../ssoProtocol.generated';

export type PendingEquipmentHandoff = {
  shiftId: string;
  phase: SsoDvirPhase;
  createdAtMs: number;
};

const TTL_MS = 10 * 60 * 1000; // 10 minutes bounded pending handoff

let pending: PendingEquipmentHandoff | null = null;

export function rememberGovernedEquipmentHandoff(
  shiftId: string,
  phase: SsoDvirPhase,
  nowMs: number = Date.now(),
): void {
  if (!shiftId || (phase !== 'pre_trip' && phase !== 'post_trip')) {
    pending = null;
    return;
  }
  pending = { shiftId, phase, createdAtMs: nowMs };
}

export function clearGovernedEquipmentHandoff(): void {
  pending = null;
}

export function peekGovernedEquipmentHandoff(
  nowMs: number = Date.now(),
): PendingEquipmentHandoff | null {
  if (!pending) return null;
  if (nowMs - pending.createdAtMs > TTL_MS) {
    pending = null;
    return null;
  }
  return pending;
}

/**
 * Resolve shift binding for equipment issuance.
 * Requires active shiftId matching the pending governed handoff.
 */
export async function resolveAuthoritativeEquipmentShiftBinding(deps: {
  getCurrentShiftId: () => Promise<string | null>;
  isShiftActive?: () => boolean | Promise<boolean>;
  nowMs?: () => number;
}): Promise<SsoShiftBinding | null> {
  const now = deps.nowMs?.() ?? Date.now();
  const handoff = peekGovernedEquipmentHandoff(now);
  if (!handoff) return null;

  if (deps.isShiftActive) {
    const active = await deps.isShiftActive();
    if (!active) return null;
  }

  const current = await deps.getCurrentShiftId();
  if (!current || current !== handoff.shiftId) return null;

  const binding: SsoShiftBinding = {
    shiftId: handoff.shiftId,
    phase: handoff.phase,
  };
  return isSsoShiftBinding(binding) ? binding : null;
}

/** Test seam */
export function __resetEquipmentHandoffBindingForTests(): void {
  pending = null;
}
