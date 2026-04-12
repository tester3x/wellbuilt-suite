// src/core/services/dispatchJobs.ts
// Fetches pending dispatched jobs for a driver via Firestore REST API.
// Used by HomeScreen to show dispatch badge on the Tickets card.

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';
const TIMEOUT_MS = 10000;

export interface DispatchSummary {
  wellName: string;
  jobType: string;
  status: string;
}

function firestoreQueryUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
}

function parseStr(val: any): string {
  if (!val) return '';
  if ('stringValue' in val) return val.stringValue;
  return '';
}

/**
 * Fetch pending/accepted dispatches for a driver.
 * Returns compact summaries for badge display.
 */
export async function fetchPendingDispatches(driverHash: string): Promise<DispatchSummary[]> {
  if (!driverHash) return [];

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'dispatches' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'driverId' },
                op: 'EQUAL',
                value: { stringValue: driverHash },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'status' },
                op: 'IN',
                value: {
                  arrayValue: {
                    values: [
                      { stringValue: 'pending' },
                      { stringValue: 'accepted' },
                    ],
                  },
                },
              },
            },
          ],
        },
      },
    },
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(firestoreQueryUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      console.warn('[dispatchJobs] Firestore query failed:', resp.status);
      return [];
    }

    const results = await resp.json();
    const dispatches: DispatchSummary[] = [];

    for (const result of results) {
      if (!result.document) continue;
      const fields = result.document.fields || {};
      dispatches.push({
        wellName: parseStr(fields.ndicWellName) || parseStr(fields.wellName) || 'Unknown',
        jobType: parseStr(fields.jobType) || 'pw',
        status: parseStr(fields.status) || 'pending',
      });
    }

    return dispatches;
  } catch (err) {
    console.warn('[dispatchJobs] Failed to fetch dispatches:', err);
    return [];
  }
}
