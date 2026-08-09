/**
 * Bounded, nonsecret DVIR handoff lifecycle diagnostics (WB-S outbound).
 *
 * Never logs: raw hash, name, full URI, query string, tokens, passcodes.
 * Emits console + optional wbDiagLog for controlled-test monitors.
 */

import type { DvirReceiptPhase } from './receiptTypes';

export type DvirHandoffAuthMechanism =
  | 'none'
  | 'legacy_hash_name'
  | 'unknown';

export type DvirHandoffRequestDiag = {
  event: 'dvir.handoff.request';
  phase: DvirReceiptPhase;
  shiftId: string;
  authMechanism: DvirHandoffAuthMechanism;
  authParamsAttached: boolean;
  returnHost: string;
};

export type DvirHandoffOpenDiag = {
  event: 'dvir.handoff.open';
  phase: DvirReceiptPhase;
  shiftId: string;
  success: boolean;
  classification: 'opened' | 'open_failed' | 'intent_fallback_opened' | 'intent_fallback_failed';
  authParamsAttached: boolean;
};

export type DvirHandoffDiagEvent = DvirHandoffRequestDiag | DvirHandoffOpenDiag;

const CONSOLE_TAG = '[Suite-DVIR]';

/** Extract host-only return target (never full URL / query). */
export function returnHostFromUrl(returnUrl: string | undefined | null): string {
  if (!returnUrl) return 'none';
  try {
    // Custom schemes: wellbuilt-suite://dvir-complete
    const m = returnUrl.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
    if (m) {
      const rest = returnUrl.slice(m[0].length);
      const hostPath = rest.split(/[?#]/)[0] || '';
      return `${m[1]}://${hostPath.split('/')[0] || hostPath}`;
    }
    const u = new URL(returnUrl);
    return u.host || u.hostname || 'unknown';
  } catch {
    return 'unparseable';
  }
}

/**
 * Classify auth transport for diagnostics only.
 * Does not authorize anything. legacy_hash_name means hash+name query fields
 * would be present — NOT a secure SSO assertion.
 */
export function classifyAuthMechanism(sso: {
  hash?: string;
  name?: string;
} | null | undefined): {
  authMechanism: DvirHandoffAuthMechanism;
  authParamsAttached: boolean;
} {
  const hasHash = typeof sso?.hash === 'string' && sso.hash.length > 0;
  const hasName = typeof sso?.name === 'string' && sso.name.length > 0;
  if (hasHash && hasName) {
    return { authMechanism: 'legacy_hash_name', authParamsAttached: true };
  }
  if (hasHash || hasName) {
    return { authMechanism: 'unknown', authParamsAttached: false };
  }
  return { authMechanism: 'none', authParamsAttached: false };
}

export function buildHandoffRequestDiag(input: {
  phase: DvirReceiptPhase;
  shiftId: string;
  sso?: { hash?: string; name?: string } | null;
  returnUrl?: string;
}): DvirHandoffRequestDiag {
  const auth = classifyAuthMechanism(input.sso);
  return {
    event: 'dvir.handoff.request',
    phase: input.phase,
    shiftId: input.shiftId,
    authMechanism: auth.authMechanism,
    authParamsAttached: auth.authParamsAttached,
    returnHost: returnHostFromUrl(input.returnUrl),
  };
}

export function buildHandoffOpenDiag(input: {
  phase: DvirReceiptPhase;
  shiftId: string;
  success: boolean;
  classification: DvirHandoffOpenDiag['classification'];
  authParamsAttached: boolean;
}): DvirHandoffOpenDiag {
  return {
    event: 'dvir.handoff.open',
    phase: input.phase,
    shiftId: input.shiftId,
    success: input.success,
    classification: input.classification,
    authParamsAttached: input.authParamsAttached,
  };
}

/** Stable single-line console form for adb logcat monitors. */
export function formatHandoffDiagConsole(ev: DvirHandoffDiagEvent): string {
  if (ev.event === 'dvir.handoff.request') {
    return (
      `${CONSOLE_TAG} ${ev.event} phase=${ev.phase} shiftId=${ev.shiftId}` +
      ` authMechanism=${ev.authMechanism} authParamsAttached=${ev.authParamsAttached ? 1 : 0}` +
      ` returnHost=${ev.returnHost}`
    );
  }
  return (
    `${CONSOLE_TAG} ${ev.event} phase=${ev.phase} shiftId=${ev.shiftId}` +
    ` success=${ev.success ? 1 : 0} classification=${ev.classification}` +
    ` authParamsAttached=${ev.authParamsAttached ? 1 : 0}`
  );
}

export type HandoffDiagEmitter = (ev: DvirHandoffDiagEvent) => void;

/** Default emitter: console + optional wbDiagLog (best-effort, never throws). */
export const defaultHandoffDiagEmit: HandoffDiagEmitter = (ev) => {
  try {
    console.log(formatHandoffDiagConsole(ev));
  } catch {
    /* ignore */
  }
  try {
    // Dynamic import keeps dvirGateService free of hard RN cycle in node tests
    // when tests inject their own emitter.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { wbDiagLog } = require('../wbDiagLog') as typeof import('../wbDiagLog');
    wbDiagLog({
      area: 'shift',
      event: ev.event,
      source: 'dvirHandoffDiag',
      result: 'ok',
      shiftId: ev.shiftId,
      extra: { ...ev },
    });
  } catch {
    /* tests / offline */
  }
};

let emitImpl: HandoffDiagEmitter = defaultHandoffDiagEmit;

/** Test seam. */
export function setHandoffDiagEmitter(fn: HandoffDiagEmitter | null): void {
  emitImpl = fn ?? defaultHandoffDiagEmit;
}

export function emitHandoffDiag(ev: DvirHandoffDiagEvent): void {
  try {
    emitImpl(ev);
  } catch {
    /* never throw */
  }
}
