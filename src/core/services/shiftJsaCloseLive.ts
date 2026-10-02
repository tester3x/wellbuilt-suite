/**
 * Live wiring for the shift JSA close gate.
 *
 * shiftJsaClose.ts decides; shiftJsaCloseGate.ts composes; this supplies the
 * real readers. Split out so the decision and the composition stay executable
 * in node:test and only this file touches the network.
 *
 * Identity comes from readLocalIdentity() — the authenticated session — because
 * that is the only place it actually exists. Nothing here invents a driver, a
 * company or a shift scope: each missing value produces an honest
 * cannot-verify decision rather than an absent obligation.
 *
 * NOTHING HERE WRITES.
 */
import { loadCompanyConfigResult } from './companyConfig';
import { readLocalIdentity } from './authReconciliation';
import { getCurrentShiftId } from './shiftTracking';
import { decodeJsaStatusDocs, type JsaCloseDecision, type JsaStatusRecord } from './shiftJsaClose';
import {
  companyJsaRuleFromConfigResult,
  resolveShiftJsaClose,
  type CompanyJsaRule,
  type ShiftJsaGateDeps,
} from './shiftJsaCloseGate';

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIRESTORE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const BASE = `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`;
const TIMEOUT_MS = 10_000;

async function fetchJson(url: string, init?: RequestInit): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read every jsa_day_status record for this shift.
 *
 * Returns null when BOTH reads failed — unknown, which the rule treats as
 * unverified evidence. An empty array means the reads succeeded and there is
 * genuinely nothing there, which is a different decision.
 */
export async function readJsaRecordsForShift(
  driverHash: string,
  shiftId: string,
): Promise<JsaStatusRecord[] | null> {
  const directUrl = `${BASE}/jsa_day_status/${encodeURIComponent(`${driverHash}_${shiftId}`)}?key=${FIRESTORE_API_KEY}`;
  const queryBody = {
    structuredQuery: {
      from: [{ collectionId: 'jsa_day_status' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            { fieldFilter: { field: { fieldPath: 'driverHash' }, op: 'EQUAL', value: { stringValue: driverHash } } },
            { fieldFilter: { field: { fieldPath: 'shiftId' }, op: 'EQUAL', value: { stringValue: shiftId } } },
          ],
        },
      },
      limit: 50,
    },
  };

  const [direct, queried] = await Promise.all([
    fetchJson(directUrl),
    fetchJson(`${BASE}:runQuery?key=${FIRESTORE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(queryBody),
    }),
  ]);

  // The direct GET 404s legitimately when no legacy single doc exists, so it
  // alone cannot prove a failure. Only both coming back empty-of-signal does.
  if (direct === null && queried === null) return null;

  const docs: any[] = [];
  if (direct) docs.push(direct);
  if (Array.isArray(queried)) {
    for (const row of queried) if (row?.document) docs.push(row.document);
  }
  return decodeJsaStatusDocs(docs) ?? [];
}

/** The company's JSA rule, fail-closed on an unreadable config. */
export async function readCompanyJsaRule(companyId: string | null): Promise<CompanyJsaRule> {
  if (!companyId) {
    // No company means no determinable policy. Not 'off'.
    return { mode: null, allowAcknowledge: true };
  }
  const result = await loadCompanyConfigResult(companyId).catch(
    () => ({ kind: 'unavailable', reason: 'network_or_http' }) as const,
  );
  return companyJsaRuleFromConfigResult(result);
}

/** Build the live gate deps. Exported so a caller can substitute one reader. */
export async function suiteShiftJsaGateDeps(): Promise<ShiftJsaGateDeps> {
  const identity = await readLocalIdentity();
  return {
    getCurrentShiftId,
    readCompanyRule: () => readCompanyJsaRule(identity.companyId),
    readJsaRecords: (shiftId: string) =>
      identity.driverId
        ? readJsaRecordsForShift(identity.driverId, shiftId)
        : // No driver identity: unknown, never "nothing owed".
          Promise.resolve(null),
  };
}

/**
 * The gate passed to finalizeArrival. One call, one decision, no writes.
 */
export async function suiteShiftJsaCloseGate(): Promise<JsaCloseDecision> {
  const deps = await suiteShiftJsaGateDeps();
  return resolveShiftJsaClose(deps);
}
