// ============================================================
// WB Diagnostics helper — WB S (Phase 2)
//
// See wellbuilt-tickets/utils/wbDiagLog.ts for full notes — this
// is the WB S copy with `app: 'wbs'`. Identical shape and safety
// contract: fire-and-forget, sanitized, kill-switchable, never
// blocks the caller, never throws.
// ============================================================
import { Platform } from 'react-native';

const ENDPOINT =
  'https://us-central1-wellbuilt-sync.cloudfunctions.net/writeDiagnosticLog';

const WB_DIAG_ENABLED = true;

const SENSITIVE_KEY_REGEX =
  /(passcode|password|secret|token|apikey|api[_-]?key|signature|sig[_-]|pdfbase64|photobase64|base64|authorization|bearer)/i;

const MAX_STRING_LEN = 2048;
const MAX_DEPTH = 3;
const MAX_ARRAY_LEN = 50;

export type WbDiagApp = 'wbs' | 'wbt' | 'wbjsa' | 'dashboard' | 'functions';
export type WbDiagArea =
  | 'jsa'
  | 'logout'
  | 'tickets'
  | 'dispatch'
  | 'split_load'
  | 'shift'
  | 'auth'
  | 'general';
export type WbDiagResult = 'ok' | 'skipped' | 'error';

export interface WbDiagInput {
  area: WbDiagArea;
  event: string;
  source?: string;
  result: WbDiagResult;
  reason?: string;
  counts?: Record<string, number | string | boolean>;
  extra?: Record<string, unknown>;
  driverHash?: string;
  shiftId?: string;
  operatorSlug?: string;
  operatorId?: string;
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[depth-cap]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN
      ? value.slice(0, MAX_STRING_LEN) + '…[trunc]'
      : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LEN).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        out[k] = '[redacted]';
        continue;
      }
      out[k] = sanitize(v, depth + 1);
    }
    return out;
  }
  return '[unsupported]';
}

/**
 * C4 contract: Authorization: Bearer <Firebase ID token>.
 * Empty/missing token → do not send. Never log or persist the token.
 */
export function diagnosticAuthHeader(
  idToken: string | null | undefined,
): { Authorization: string } | null {
  const token = typeof idToken === 'string' ? idToken.trim() : '';
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

async function getDiagnosticIdToken(): Promise<string | null> {
  try {
    const { getFirebaseApp } = await import('./firebaseApp');
    const {
      getOwnedAuth,
      getOwnedIdToken,
      waitForAuthReady,
    } = await import('./firebaseAuthBoundary');
    const app = getFirebaseApp();
    if (!getOwnedAuth(app)) return null;
    await waitForAuthReady(app);
    const fresh = await getOwnedIdToken(app, false);
    if (typeof fresh === 'string' && fresh.trim()) return fresh;
    const refreshed = await getOwnedIdToken(app, true);
    return typeof refreshed === 'string' && refreshed.trim() ? refreshed : null;
  } catch {
    return null;
  }
}

function buildDiagnosticBody(input: WbDiagInput): Record<string, unknown> {
  return {
    app: 'wbs' as WbDiagApp,
    clientTimestamp: new Date().toISOString(),
    platform: Platform.OS,
    area: input.area,
    event: input.event,
    source: input.source,
    result: input.result,
    reason: input.reason,
    counts: input.counts,
    extra: input.extra ? (sanitize(input.extra) as Record<string, unknown>) : undefined,
    // driverHash is a forbidden client identity field on the C4 server.
    shiftId: input.shiftId,
    operatorSlug: input.operatorSlug,
    operatorId: input.operatorId,
  };
}

async function submitDiagnostic(body: Record<string, unknown>): Promise<void> {
  const token = await getDiagnosticIdToken();
  const authz = diagnosticAuthHeader(token);
  if (!authz) return;
  await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authz },
    body: JSON.stringify(body),
  });
}

export function wbDiagLog(input: WbDiagInput): void {
  if (!WB_DIAG_ENABLED) return;
  try {
    const body = buildDiagnosticBody(input);
    void submitDiagnostic(body).catch(() => {
      // silent
    });
  } catch {
    // silent — never throw from the logger
  }
}
