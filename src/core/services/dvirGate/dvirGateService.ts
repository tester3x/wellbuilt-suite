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
import {
  buildHandoffOpenDiag,
  buildHandoffRequestDiag,
  emitHandoffDiag,
} from './dvirHandoffDiag';
import {
  completeGovernedHandoffIfMatches,
  rememberGovernedEquipmentHandoff,
} from './equipmentHandoffBinding';

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
  /**
   * Whether a shift is currently active (clocked in / returning).
   * DVIR redirects require an active shift. Stale shiftId while off-shift
   * must never launch Pre-Trip or Post-Trip. Defaults to true only when
   * omitted (unit tests that model an active shift without the flag).
   */
  isShiftActive?: () => boolean | Promise<boolean>;
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
  /**
   * Confirm before leaving Suite for eQuipment (JSA-style handoff notice).
   * Resolve true to open eQuipment, false to cancel. Tests default to true.
   */
  confirmLeaveForEquipment?: (opts: {
    phase: DvirReceiptPhase;
    title: string;
    message: string;
  }) => Promise<boolean>;
  /** When true, try Android package intent after scheme open fails. */
  tryAndroidIntent?: boolean;
}

/** Driver-facing handoff copy before Suite opens WellBuilt eQuipment. */
export function equipmentHandoffNotice(phase: DvirReceiptPhase): {
  title: string;
  message: string;
} {
  if (phase === 'post_trip') {
    return {
      title: 'Opening WellBuilt eQuipment',
      message:
        'Your Post-Trip DVIR is required before ending your shift. You will return to WellBuilt Suite when it is finished.',
    };
  }
  return {
    title: 'Opening WellBuilt eQuipment',
    message:
      'Your Pre-Trip DVIR is required before using Tickets. You will return to WellBuilt Suite when it is finished.',
  };
}

async function shiftIsActive(deps: DvirGateDeps): Promise<boolean> {
  if (!deps.isShiftActive) return true;
  return !!(await deps.isShiftActive());
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
  const returnUrl = SUITE_DVIR_RETURN_URL;
  // Governed path: metadata only. Authentication is PKCE to WB-S, never
  // hash/name/passcode in the launch URI (security gate).
  await rememberGovernedEquipmentHandoff(shiftId, phase);
  const requestDiag = buildHandoffRequestDiag({
    phase,
    shiftId,
    sso: null, // authParamsAttached=false by design
    returnUrl,
  });
  emitHandoffDiag(requestDiag);

  const url = buildEquipmentDvirUrl({
    shiftId,
    phase,
    returnUrl,
    // Explicitly omit hash/name/company/truck/trailer identity fields.
  });
  // Hard refuse if a caller ever reintroduces identity into the builder.
  if (/[?&](hash|name|passcode|token)=/i.test(url)) {
    emitHandoffDiag(
      buildHandoffOpenDiag({
        phase,
        shiftId,
        success: false,
        classification: 'open_failed',
        authParamsAttached: true,
      }),
    );
    return { launched: false, error: 'Refused to open equipment with identity in URI' };
  }
  try {
    await deps.openUrl(url);
    emitHandoffDiag(
      buildHandoffOpenDiag({
        phase,
        shiftId,
        success: true,
        classification: 'opened',
        authParamsAttached: false,
      }),
    );
    return { launched: true };
  } catch {
    if (deps.tryAndroidIntent) {
      try {
        await deps.openUrl(
          `intent://dvir#Intent;scheme=${EQUIPMENT_SCHEME};package=${EQUIPMENT_ANDROID_PACKAGE};end`,
        );
        emitHandoffDiag(
          buildHandoffOpenDiag({
            phase,
            shiftId,
            success: true,
            classification: 'intent_fallback_opened',
            authParamsAttached: false,
          }),
        );
        return { launched: true };
      } catch {
        /* fall through */
      }
    }
    emitHandoffDiag(
      buildHandoffOpenDiag({
        phase,
        shiftId,
        success: false,
        classification: 'open_failed',
        authParamsAttached: false,
      }),
    );
    return {
      launched: false,
      error: 'Could not open WellBuilt eQuipment. Install or update the app.',
    };
  }
}

/**
 * Ensure Pre-Trip for the *active* shift. If missing, launch eQuipment.
 * Returns allowed=true only when a durable matching receipt exists —
 * or when the driver is off-shift (no DVIR redirect; modules open normally).
 */
export async function ensurePreTripGate(
  deps: DvirGateDeps,
  opts?: { shiftId?: string | null; alertOnBlock?: boolean },
): Promise<{ allowed: boolean; launched: boolean; shiftId: string | null; reason?: string }> {
  if (!(await shiftIsActive(deps))) {
    return {
      allowed: true,
      launched: false,
      shiftId: null,
      reason: 'Off shift — no Pre-Trip redirect',
    };
  }
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

  const notice = equipmentHandoffNotice('pre_trip');
  if (opts?.alertOnBlock !== false && deps.confirmLeaveForEquipment) {
    const ok = await deps.confirmLeaveForEquipment({
      phase: 'pre_trip',
      title: notice.title,
      message: notice.message,
    });
    if (!ok) {
      return {
        allowed: false,
        launched: false,
        shiftId,
        reason: 'Driver cancelled Pre-Trip handoff',
      };
    }
  }

  const { launched, error } = await launchEquipmentPhase(deps, 'pre_trip', shiftId);
  if (opts?.alertOnBlock !== false && !deps.confirmLeaveForEquipment) {
    // Fallback notice after launch when no confirm API (tests / legacy)
    deps.alert?.(
      notice.title,
      launched
        ? notice.message
        : error || 'Pre-Trip DVIR is required before Tickets.',
    );
  } else if (!launched && error) {
    deps.alert?.('Could not open eQuipment', error);
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
 * Off-shift: never redirects (clears stale pending flag).
 */
export async function ensurePostTripGate(
  deps: DvirGateDeps,
  opts?: {
    shiftId?: string | null;
    odometerMiles?: number;
    alertOnBlock?: boolean;
  },
): Promise<{ allowed: boolean; launched: boolean; shiftId: string | null; reason?: string }> {
  if (!(await shiftIsActive(deps))) {
    await clearPendingEndShift(deps.kv);
    return {
      allowed: true,
      launched: false,
      shiftId: null,
      reason: 'Off shift — no Post-Trip redirect',
    };
  }
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

  const notice = equipmentHandoffNotice('post_trip');
  if (opts?.alertOnBlock !== false && deps.confirmLeaveForEquipment) {
    const ok = await deps.confirmLeaveForEquipment({
      phase: 'post_trip',
      title: notice.title,
      message: notice.message,
    });
    if (!ok) {
      await clearPendingEndShift(deps.kv);
      return {
        allowed: false,
        launched: false,
        shiftId,
        reason: 'Driver cancelled Post-Trip handoff',
      };
    }
  }

  const { launched, error } = await launchEquipmentPhase(deps, 'post_trip', shiftId);
  if (opts?.alertOnBlock !== false && !deps.confirmLeaveForEquipment) {
    deps.alert?.(
      notice.title,
      launched
        ? notice.message
        : error || 'Post-Trip DVIR is required before ending shift.',
    );
  } else if (!launched && error) {
    deps.alert?.('Could not open eQuipment', error);
  }
  return {
    allowed: false,
    launched,
    shiftId,
    reason: 'Post-Trip completion receipt missing for this shift',
  };
}

/**
 * After Post-Trip receipt acceptance and/or shift finalization:
 * clear pending end-shift routing so module taps cannot re-open Post-Trip
 * for a finished shift. Does not erase durable receipts or history.
 */
export async function clearDvirRoutingAfterFinalization(
  deps: Pick<DvirGateDeps, 'kv'>,
): Promise<void> {
  await clearPendingEndShift(deps.kv);
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
  try {
    console.log(
      `[Suite-DVIR] dvir.receipt.received phase=${validated.receipt.phase} created=${result === 'created' ? 1 : 0}`,
    );
    console.log(
      `[Suite-DVIR] dvir.receipt.accepted phase=${validated.receipt.phase} shiftId=${validated.receipt.shiftId}`,
    );
  } catch { /* ignore */ }
  await completeGovernedHandoffIfMatches(
    validated.receipt.shiftId,
    validated.receipt.phase,
  );
  // Post-Trip receipt means the gate for this phase is satisfied — drop
  // pending end-shift so off-shift / later taps cannot re-launch Post-Trip.
  if (validated.receipt.phase === 'post_trip') {
    const pending = await getPendingEndShift(deps.kv);
    if (pending && pending.shiftId === validated.receipt.shiftId) {
      // Leave pending until consumePendingEndShiftIfReady when still active;
      // if post is complete, consume path will clear. Clear immediately when
      // there is no active shift (finalized already).
      if (!(await shiftIsActive(deps))) {
        await clearPendingEndShift(deps.kv);
      }
    }
  }
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
