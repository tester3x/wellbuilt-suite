// jsaShiftAck.ts — Acknowledge today's shift JSA from WB S day-summary.
//
// Mirrors WB T's acknowledgeShiftJsa (utils/jsaTracking.ts). Writes
// jsaCompleted=true + acknowledgedMethod ('acknowledged' | 'read') to
// jsa_day_status/{driverHash}_{shiftId}. After this fires, the WB S
// shift-end gate at logout time sees jsaCompleted=true and lets the
// driver out without re-prompting.

import { getCurrentShiftId } from './shiftTracking';

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIRESTORE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const FIRESTORE_DOC_BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;
const TIMEOUT_MS = 10_000;

/**
 * Today's UTC date as YYYY-MM-DD. Used as the JSA scope when no shiftId is
 * present (legacy fallback for sessions that started before this rollout).
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * PATCH jsa_day_status/{driverHash}_{shiftId}.{jsaCompleted, acknowledgedMethod, jsaCompletedAt}.
 * Returns true on success. Driver name + companyId fields included so the doc
 * is queryable from Dashboard even when the JSA was never created via the
 * JSA app's signoff flow (per_shift Acknowledge cheat path).
 */
export async function acknowledgeShiftJsa(
  driverHash: string,
  driverName: string,
  companyId: string,
  method: 'acknowledged' | 'read',
): Promise<boolean> {
  if (!driverHash) return false;
  try {
    // vc51.9C: the UTC date fallback is enforcement-gated. Under active
    // canonical enforcement a missing shift id means NO verified period —
    // acknowledging into a fabricated date scope would create evidence
    // bound to a period that does not exist, so it fails closed.
    const cached = await getCurrentShiftId();
    let scope = cached;
    if (!scope) {
      const [{ mayUseDateFallback, parseSuiteEnforcement }, { fetchCompanyConfig }] = await Promise.all([
        import('./workPeriodAuthority/suiteShiftAuthority'),
        import('./companyConfig'),
      ]);
      const cfg = companyId ? await fetchCompanyConfig(companyId).catch(() => null) : null;
      if (!mayUseDateFallback(parseSuiteEnforcement(cfg ?? undefined))) {
        console.warn('[jsaShiftAck] enforced company with no verified shift — refusing date-fallback scope');
        return false;
      }
      scope = todayUtc();
    }
    const docId = `${driverHash}_${scope}`;
    const nowIso = new Date().toISOString();

    const patchUrl = `${FIRESTORE_DOC_BASE}/jsa_day_status/${docId}?key=${FIRESTORE_API_KEY}`
      + '&updateMask.fieldPaths=driverHash'
      + '&updateMask.fieldPaths=driverName'
      + '&updateMask.fieldPaths=companyId'
      + '&updateMask.fieldPaths=shiftId'
      + '&updateMask.fieldPaths=date'
      + '&updateMask.fieldPaths=jsaCompleted'
      + '&updateMask.fieldPaths=jsaCompletedAt'
      + '&updateMask.fieldPaths=acknowledgedMethod'
      + '&updateMask.fieldPaths=updatedAt';

    const fields = {
      driverHash: { stringValue: driverHash },
      driverName: { stringValue: driverName },
      companyId: { stringValue: companyId },
      shiftId: { stringValue: scope },
      date: { stringValue: todayUtc() },
      jsaCompleted: { booleanValue: true },
      jsaCompletedAt: { timestampValue: nowIso },
      acknowledgedMethod: { stringValue: method },
      updatedAt: { timestampValue: nowIso },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(patchUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.warn(`[jsaShiftAck] PATCH failed: HTTP ${resp.status} ${body.slice(0, 200)}`);
      return false;
    }
    console.log(`[jsaShiftAck] Shift JSA acknowledged via ${method} for ${driverName} (scope=${scope})`);
    return true;
  } catch (err: any) {
    console.warn('[jsaShiftAck] error:', err?.message || err);
    return false;
  }
}
