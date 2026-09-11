// src/core/services/workPeriodAuthority/endShiftBreadcrumbs.ts
//
// Diagnostic breadcrumbs for the End Shift / logout chain. SOURCE-ONLY, NON-
// BEHAVIORAL: these emit structured log lines and never alter control flow.
//
// They exist to make the "returned to Home, shift still open" path observable
// without inference: which control was tapped, the route decision + reason code,
// whether a confirmation was shown, whether closeDriverShift was started and its
// outcome, and the final navigation.
//
// SANITIZED ONLY: no credentials or reusable identity ever appear. A defensive
// allow/deny pass drops any identity/credential key even if a call site passes
// one by mistake. Operational shift state (route action, reason code, server
// state, DVIR signals, periodId) is not identity and is retained.

export type EndShiftBreadcrumbEvent =
  | 'tap' // an End Shift / logout control was tapped
  | 'route_decision' // the route decider returned an action + reason
  | 'confirmation' // a confirmation dialog was shown / resolved
  | 'callable_start' // closeDriverShift is about to be invoked
  | 'callable_result' // closeDriverShift returned (success / no-op / error)
  | 'navigation'; // final navigation after the flow

/** Keys that must NEVER appear in a breadcrumb (credentials / reusable identity). */
export const FORBIDDEN_BREADCRUMB_KEYS: readonly string[] = Object.freeze(
  [
    'driverId', 'uid', 'userId', 'hash', 'driverHash', 'passcode', 'passcodeHash',
    'token', 'idToken', 'id_token', 'customToken', 'custom_token', 'accessToken',
    'access_token', 'refreshToken', 'refresh_token', 'verifier', 'codeVerifier',
    'code_verifier', 'companyId', 'company', 'displayName', 'legalName', 'name', 'email',
  ].map((k) => k.toLowerCase()),
);

export interface EndShiftBreadcrumbFields {
  source?: 'logout_icon' | 'direct_close' | 'mark_arrived' | 'shift_card' | 'day_summary';
  action?: string; // route action
  reason?: string; // route/close reason code
  serverState?: string; // open | none | unverifiable | not_read
  preTrip?: string; // yes | no | indeterminate
  operated?: string;
  enforcedExplicit?: boolean;
  enforcementLive?: boolean;
  consultServerAuthority?: boolean;
  shiftOpen?: boolean;
  shown?: boolean; // confirmation shown
  result?: string; // confirmation user choice / callable kind
  outcome?: 'success' | 'no_op' | 'error' | 'not_reached';
  alreadyClosed?: boolean;
  destination?: string; // final navigation target
  shiftLeftOpen?: boolean;
  closeInvoked?: boolean;
  periodId?: string; // operational shift id (not identity)
}

let sink: (line: string) => void = (line) => console.log(line);

/** Test seam: redirect breadcrumb output (pass null to restore console.log). */
export function __setBreadcrumbSink(fn: ((line: string) => void) | null): void {
  sink = fn ?? ((line) => console.log(line));
}

/** Drop identity/credential keys and undefined values; return a safe record. */
export function sanitizeBreadcrumbFields(
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const forbidden = new Set(FORBIDDEN_BREADCRUMB_KEYS);
  const out: Record<string, unknown> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [k, v] of Object.entries(fields)) {
    if (forbidden.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** Emit one sanitized breadcrumb. Returns the emitted record (for tests). */
export function emitEndShiftBreadcrumb(
  event: EndShiftBreadcrumbEvent,
  fields: EndShiftBreadcrumbFields = {},
): Record<string, unknown> {
  const record = { event, ...sanitizeBreadcrumbFields(fields as Record<string, unknown>) };
  try {
    sink(`[endShiftTrace] ${JSON.stringify(record)}`);
  } catch {
    /* logging must never break the End Shift flow */
  }
  return record;
}
