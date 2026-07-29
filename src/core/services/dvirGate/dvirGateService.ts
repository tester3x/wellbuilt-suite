/**
 * Suite DVIR gate: Pre-Trip before Tickets, Post-Trip before end-shift/logout.
 * Offline-first: only Suite-local durable receipts unlock gates.
 *
 * Pure core — no react-native imports (Node-testable). Platform open/alert
 * are injected via DvirGateDeps.
 */
import type { DvirReceiptKv } from './dvirReceiptStore';
import {
  clearPendingEndShift,
  getPendingEndShift,
  getReceipt,
  hasValidPhase,
  saveReceiptIdempotent,
  setPendingEndShift,
} from './dvirReceiptStore';
import {
  decodeReceiptFromDeepLink,
  validatePhaseCompletionReceipt,
} from './validateReceipt';
import type { DvirReceiptPhase, PhaseCompletionReceipt } from './receiptTypes';

export const EQUIPMENT_SCHEME = 'wbequipment';
export const EQUIPMENT_ANDROID_PACKAGE = 'com.wellbuilt.equipment';
export const SUITE_DVIR_RETURN_URL = 'wellbuilt-suite://dvir-complete';

export const TICKETS_SCHEMES = new Set([
  'wellbuilt-tickets',
  'wellbuilttickets',
]);

export function isTicketsLaunch(scheme?: string, appId?: string): boolean {
  if (appId === 'water-ticket' || appId === 'wbt') return true;
  if (!scheme) return false;
  return TICKETS_SCHEMES.has(scheme) || scheme.includes('ticket');
}

export function buildEquipmentDvirUrl(opts: {
  shiftId: string;
  phase: DvirReceiptPhase;
  returnUrl?: string;
  hash?: string;
  name?: string;
  companyId?: string;
  truck?: string;
  trailer?: string;
}): string {
  const p = new URLSearchParams();
  p.set('shiftId', opts.shiftId);
  p.set('phase', opts.phase);
  p.set('returnUrl', opts.returnUrl || SUITE_DVIR_RETURN_URL);
  if (opts.hash) p.set('hash', opts.hash);
  if (opts.name) p.set('name', opts.name);
  if (opts.companyId) p.set('companyId', opts.companyId);
  if (opts.truck) p.set('truck', opts.truck);
  if (opts.trailer) p.set('trailer', opts.trailer);
  return `${EQUIPMENT_SCHEME}://dvir?${p.toString()}`;
}

export interface DvirGateDeps {
  kv: DvirReceiptKv;
  sha256Hex: (s: string) => Promise<string>;
  /** Required in production (Linking.openURL). Tests inject. */
  openUrl: (url: string) => Promise<void>;
  getCurrentShiftId: () => Promise<string | null>;
  /** Optional identity for SSO into eQuipment */
  getSso?: () => Promise<{
    hash?: string;
    name?: string;
    companyId?: string;
    truck?: string;
    trailer?: string;
  } | null>;
  nowMs?: () => number;
  /** Optional UI alert (no-op in tests). */
  alert?: (title: string, message: string) => void;
  /** When true, try Android package intent after scheme open fails. */
  tryAndroidIntent?: boolean;
}

export async function isPreTripCompleteForShift(
  deps: Pick<DvirGateDeps, 'kv'>,
  shiftId: string,
): Promise<boolean> {
  return hasValidPhase(deps.kv, shiftId, 'pre_trip');
}

export async function isPostTripCompleteForShift(
  deps: Pick<DvirGateDeps, 'kv'>,
  shiftId: string,
): Promise<boolean> {
  return hasValidPhase(deps.kv, shiftId, 'post_trip');
}

/**
 * Launch eQuipment for a phase. Does not mark anything complete.
 */
export async function launchEquipmentPhase(
  deps: DvirGateDeps,
  phase: DvirReceiptPhase,
  shiftId: string,
): Promise<{ launched: boolean; error?: string }> {
  const sso = deps.getSso ? await deps.getSso() : null;
  const url = buildEquipmentDvirUrl({
    shiftId,
    phase,
    returnUrl: SUITE_DVIR_RETURN_URL,
    hash: sso?.hash,
    name: sso?.name,
    companyId: sso?.companyId,
    truck: sso?.truck,
    trailer: sso?.trailer,
  });
  try {
    await deps.openUrl(url);
    return { launched: true };
  } catch {
    if (deps.tryAndroidIntent) {
      try {
        await deps.openUrl(
          `intent://dvir#Intent;scheme=${EQUIPMENT_SCHEME};package=${EQUIPMENT_ANDROID_PACKAGE};end`,
        );
        return { launched: true };
      } catch {
        /* fall through */
      }
    }
    return {
      launched: false,
      error: 'Could not open WellBuilt eQuipment. Install or update the app.',
    };
  }
}

/**
 * Ensure Pre-Trip for current shift. If missing, launch eQuipment.
 * Returns allowed=true only when a durable matching receipt exists.
 */
export async function ensurePreTripGate(
  deps: DvirGateDeps,
  opts?: { shiftId?: string | null; alertOnBlock?: boolean },
): Promise<{ allowed: boolean; launched: boolean; shiftId: string | null; reason?: string }> {
  const shiftId = opts?.shiftId ?? (await deps.getCurrentShiftId());
  if (!shiftId) {
    return {
      allowed: false,
      launched: false,
      shiftId: null,
      reason: 'No active shift — start shift first',
    };
  }
  if (await isPreTripCompleteForShift(deps, shiftId)) {
    return { allowed: true, launched: false, shiftId };
  }
  const { launched, error } = await launchEquipmentPhase(deps, 'pre_trip', shiftId);
  if (opts?.alertOnBlock !== false) {
    deps.alert?.(
      'Pre-Trip Required',
      launched
        ? 'Complete the Pre-Trip DVIR in WellBuilt eQuipment before using Tickets.'
        : error || 'Pre-Trip DVIR is required before Tickets.',
    );
  }
  return {
    allowed: false,
    launched,
    shiftId,
    reason: 'Pre-Trip completion receipt missing for this shift',
  };
}

/**
 * Ensure Post-Trip before ending shift. Does not end the shift.
 * Sets pendingEndShift so receipt ingestion can resume arrival/logout.
 */
export async function ensurePostTripGate(
  deps: DvirGateDeps,
  opts?: {
    shiftId?: string | null;
    odometerMiles?: number;
    alertOnBlock?: boolean;
  },
): Promise<{ allowed: boolean; launched: boolean; shiftId: string | null; reason?: string }> {
  const shiftId = opts?.shiftId ?? (await deps.getCurrentShiftId());
  if (!shiftId) {
    return {
      allowed: false,
      launched: false,
      shiftId: null,
      reason: 'No active shift',
    };
  }
  if (await isPostTripCompleteForShift(deps, shiftId)) {
    await clearPendingEndShift(deps.kv);
    return { allowed: true, launched: false, shiftId };
  }

  await setPendingEndShift(deps.kv, {
    shiftId,
    odometerMiles: opts?.odometerMiles,
    createdAt: new Date().toISOString(),
  });

  const { launched, error } = await launchEquipmentPhase(deps, 'post_trip', shiftId);
  if (opts?.alertOnBlock !== false) {
    deps.alert?.(
      'Post-Trip Required',
      launched
        ? 'Complete the Post-Trip DVIR in WellBuilt eQuipment before ending your shift.'
        : error || 'Post-Trip DVIR is required before ending shift.',
    );
  }
  return {
    allowed: false,
    launched,
    shiftId,
    reason: 'Post-Trip completion receipt missing for this shift',
  };
}

/**
 * Ingest a return deep-link URL or raw receipt payload.
 * Validates, persists durably, returns the saved receipt on success.
 */
export async function ingestDvirCompletionUrl(
  deps: DvirGateDeps,
  url: string,
): Promise<
  | { ok: true; receipt: PhaseCompletionReceipt; created: boolean }
  | { ok: false; reason: string }
> {
  if (!url || (!url.includes('dvir-complete') && !url.includes('receipt='))) {
    return { ok: false, reason: 'Not a DVIR completion URL' };
  }
  let encoded: string | null = null;
  try {
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return { ok: false, reason: 'Missing query' };
    const params = new URLSearchParams(url.slice(qIdx + 1));
    encoded = params.get('receipt');
  } catch {
    return { ok: false, reason: 'Could not parse URL' };
  }
  if (!encoded) return { ok: false, reason: 'receipt query param missing' };

  let raw: unknown;
  try {
    raw = decodeReceiptFromDeepLink(encoded);
  } catch {
    return { ok: false, reason: 'Receipt decode failed' };
  }

  const activeShiftId = await deps.getCurrentShiftId();
  const validated = await validatePhaseCompletionReceipt(raw, {
    sha256Hex: deps.sha256Hex,
    expectedShiftId: activeShiftId || undefined,
    nowMs: deps.nowMs ? deps.nowMs() : Date.now(),
  });
  if (!validated.ok) return validated;

  // If no active shift, still accept only if we cannot check — but policy
  // requires shift match. When activeShiftId is null, reject stale unlock.
  if (!activeShiftId) {
    return { ok: false, reason: 'No active shift to attach receipt' };
  }
  if (validated.receipt.shiftId !== activeShiftId) {
    return { ok: false, reason: 'Receipt shiftId does not match active shift' };
  }

  const result = await saveReceiptIdempotent(deps.kv, validated.receipt);
  return {
    ok: true,
    receipt: validated.receipt,
    created: result === 'created',
  };
}

export async function ingestValidatedReceipt(
  deps: DvirGateDeps,
  receipt: PhaseCompletionReceipt,
  expectedShiftId?: string | null,
): Promise<{ ok: true; created: boolean } | { ok: false; reason: string }> {
  const shiftId = expectedShiftId ?? (await deps.getCurrentShiftId());
  if (!shiftId || receipt.shiftId !== shiftId) {
    return { ok: false, reason: 'Receipt shiftId does not match active shift' };
  }
  const validated = await validatePhaseCompletionReceipt(receipt, {
    sha256Hex: deps.sha256Hex,
    expectedShiftId: shiftId,
    expectedPhase: receipt.phase,
    nowMs: deps.nowMs ? deps.nowMs() : Date.now(),
  });
  if (!validated.ok) return validated;
  const result = await saveReceiptIdempotent(deps.kv, validated.receipt);
  return { ok: true, created: result === 'created' };
}

/** After Post-Trip receipt, check if end-shift should resume. */
export async function consumePendingEndShiftIfReady(
  deps: DvirGateDeps,
): Promise<{ resume: true; odometerMiles?: number; shiftId: string } | { resume: false }> {
  const pending = await getPendingEndShift(deps.kv);
  if (!pending) return { resume: false };
  if (!(await isPostTripCompleteForShift(deps, pending.shiftId))) {
    return { resume: false };
  }
  await clearPendingEndShift(deps.kv);
  return {
    resume: true,
    odometerMiles: pending.odometerMiles,
    shiftId: pending.shiftId,
  };
}

export async function getPhaseReceipt(
  deps: Pick<DvirGateDeps, 'kv'>,
  shiftId: string,
  phase: DvirReceiptPhase,
): Promise<PhaseCompletionReceipt | null> {
  return getReceipt(deps.kv, shiftId, phase);
}
