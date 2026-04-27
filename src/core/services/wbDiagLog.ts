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
  /(passcode|password|secret|token|apikey|api[_-]?key|signature|sig[_-]|pdfbase64|photobase64|base64)/i;

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

export function wbDiagLog(input: WbDiagInput): void {
  if (!WB_DIAG_ENABLED) return;
  try {
    const body = {
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
      driverHash: input.driverHash,
      shiftId: input.shiftId,
      operatorSlug: input.operatorSlug,
      operatorId: input.operatorId,
    };
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // silent
    });
  } catch {
    // silent — never throw from the logger
  }
}
