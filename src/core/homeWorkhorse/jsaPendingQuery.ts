/**
 * Today's JSA-completion probe for home live state.
 *
 * Moved out of v1-grid HomeScreen so no theme queries Firestore.
 * Semantics are preserved: assume pending until a same-day signed JSA
 * document is found; network errors leave the previous value unchanged.
 *
 * Uses the same existing Firestore web key already committed in
 * src/core/services/dispatchJobs.ts — not a new credential.
 */

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const TIMEOUT_MS = 10000;

export interface JsaPendingQueryInput {
  driverName: string;
  dayIso?: string;
}

export type JsaPendingQueryResult =
  | { kind: 'found' }
  | { kind: 'missing' }
  | { kind: 'indeterminate' };

function queryUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
}

export async function queryTodaysJsaCompletion(
  input: JsaPendingQueryInput,
): Promise<JsaPendingQueryResult> {
  const driverName = input.driverName;
  if (!driverName) return { kind: 'indeterminate' };

  const today = input.dayIso || new Date().toISOString().slice(0, 10);
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'jsas' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'driverName' },
                op: 'EQUAL',
                value: { stringValue: driverName },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'date' },
                op: 'EQUAL',
                value: { stringValue: today },
              },
            },
          ],
        },
      },
      limit: 1,
    },
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(queryUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { kind: 'indeterminate' };
    const results = await res.json();
    const found = Array.isArray(results) && results.some((r: { document?: unknown }) => r.document);
    return found ? { kind: 'found' } : { kind: 'missing' };
  } catch {
    return { kind: 'indeterminate' };
  }
}
