// src/core/services/daySummary.ts
// Fetches today's invoice + shift data via Firestore REST API
// and calculates daily summary stats for the end-of-day screen.
// Pure calculation functions ported from Dashboard's driverLogs.ts.

import { firebaseGet } from './driverAuth';

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

// ── Types ────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  type: string;
  timestamp: string;
  lat: number | null;
  lng: number | null;
  source?: string;
  locationName?: string;
}

interface DaySummaryInvoice {
  id: string;
  wellName: string;
  hauledTo: string;
  operator: string;
  totalBBL: number;
  totalHours: number;
  status: string;
  timeline: TimelineEvent[];
}

export interface DaySummary {
  totalLoads: number;
  totalBBL: number;
  wellsVisited: string[];
  totalHoursWorked: number;
  driveMinutes: number;
  onSiteMinutes: number;
  driveMiles: number;
  avgSpeedMph: number;
  shiftStart: string | null;
  shiftEnd: string | null;
}

// ── Pure calculation functions (ported from Dashboard driverLogs.ts) ─────────

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface UnifiedEvent {
  type: string;
  timestamp: string;
  lat: number | null;
  lng: number | null;
}

function calculateDriveAndOnSiteTime(timeline: UnifiedEvent[]): {
  driveMinutes: number;
  onSiteMinutes: number;
  driveMiles: number;
} {
  let driveMs = 0;
  let onSiteMs = 0;
  let driveMeters = 0;

  for (let i = 0; i < timeline.length - 1; i++) {
    const curr = timeline[i];
    const next = timeline[i + 1];
    const currTime = new Date(curr.timestamp).getTime();
    const nextTime = new Date(next.timestamp).getTime();
    if (isNaN(currTime) || isNaN(nextTime) || nextTime <= currTime) continue;
    const diffMs = nextTime - currTime;

    let isDrive = false;

    if ((curr.type === 'depart' || curr.type === 'depart_site') && next.type === 'arrive') {
      driveMs += diffMs;
      isDrive = true;
    } else if (curr.type === 'login' && next.type === 'depart') {
      driveMs += diffMs;
      isDrive = true;
    } else if (curr.type === 'depart_return' && next.type === 'logout') {
      driveMs += diffMs;
      isDrive = true;
    } else if ((curr.type === 'close' || curr.type === 'depart_site') && next.type === 'logout') {
      driveMs += diffMs;
      isDrive = true;
    } else if (curr.type === 'arrive' && (next.type === 'depart_site' || next.type === 'close')) {
      onSiteMs += diffMs;
    }

    if (isDrive && curr.lat && curr.lng && next.lat && next.lng) {
      driveMeters += haversineMeters(curr.lat, curr.lng, next.lat, next.lng);
    }
  }

  return {
    driveMinutes: Math.round(driveMs / 60000),
    onSiteMinutes: Math.round(onSiteMs / 60000),
    driveMiles: Math.round(driveMeters / 1609.34 * 10) / 10,
  };
}

// ── Firestore REST helpers ───────────────────────────────────────────────────

function firestoreDocUrl(collection: string, docId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${collection}/${docId}?key=${FIREBASE_API_KEY}`;
}

function firestoreQueryUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
}

/** Parse a Firestore REST field value to JS. */
function parseFirestoreValue(val: any): any {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(parseFirestoreValue);
  }
  if ('mapValue' in val) {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      result[k] = parseFirestoreValue(v);
    }
    return result;
  }
  return null;
}

// ── Data fetching ────────────────────────────────────────────────────────────

/**
 * Fetch today's closed invoices for a specific driver via Firestore REST.
 */
export async function fetchTodayInvoices(
  displayName: string,
  companyId?: string,
): Promise<DaySummaryInvoice[]> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const startOfDay = `${year}-${month}-${day}T00:00:00Z`;
  const endOfDay = `${year}-${month}-${day}T23:59:59.999Z`;

  const filters: any[] = [
    {
      fieldFilter: {
        field: { fieldPath: 'createdAt' },
        op: 'GREATER_THAN_OR_EQUAL',
        value: { timestampValue: startOfDay },
      },
    },
    {
      fieldFilter: {
        field: { fieldPath: 'createdAt' },
        op: 'LESS_THAN_OR_EQUAL',
        value: { timestampValue: endOfDay },
      },
    },
    {
      fieldFilter: {
        field: { fieldPath: 'driver' },
        op: 'EQUAL',
        value: { stringValue: displayName },
      },
    },
  ];

  if (companyId) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'companyId' },
        op: 'EQUAL',
        value: { stringValue: companyId },
      },
    });
  }

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'invoices' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters,
        },
      },
      // No orderBy — avoids needing a composite index.
      // Results are sorted client-side in calculateDaySummary().
    },
  };

  try {
    console.log('[daySummary] Querying invoices for driver:', displayName, 'companyId:', companyId || '(none)', 'date:', startOfDay.slice(0, 10));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(firestoreQueryUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.warn('[daySummary] Firestore query failed:', resp.status, errText.substring(0, 300));
      // Common cause: missing composite index. Log clearly so it's not silently swallowed.
      if (resp.status === 400 && errText.includes('index')) {
        console.error('[daySummary] ⚠️ MISSING FIRESTORE INDEX — deploy firestore.indexes.json');
      }
      return [];
    }

    const results = await resp.json();
    console.log('[daySummary] Query returned', results.length, 'results');
    const invoices: DaySummaryInvoice[] = [];

    for (const result of results) {
      if (!result.document) continue;
      const fields = result.document.fields || {};
      const status = parseFirestoreValue(fields.status) || 'open';
      // Only include completed invoices
      if (!['closed', 'submitted', 'approved', 'paid'].includes(status)) continue;

      const timelineRaw = parseFirestoreValue(fields.timeline) || [];
      const timeline: TimelineEvent[] = timelineRaw.map((evt: any) => ({
        type: evt?.type || '',
        timestamp: evt?.timestamp || '',
        lat: evt?.lat ?? null,
        lng: evt?.lng ?? null,
        source: evt?.source,
        locationName: evt?.locationName,
      }));

      // Extract doc ID from name path
      const nameParts = result.document.name.split('/');
      const docId = nameParts[nameParts.length - 1];

      invoices.push({
        id: docId,
        wellName: parseFirestoreValue(fields.wellName) || '',
        hauledTo: parseFirestoreValue(fields.hauledTo) || '',
        operator: parseFirestoreValue(fields.operator) || '',
        totalBBL: parseFirestoreValue(fields.totalBBL) || 0,
        totalHours: parseFirestoreValue(fields.totalHours) || 0,
        status,
        timeline,
      });
    }

    return invoices;
  } catch (err) {
    console.warn('[daySummary] Failed to fetch invoices:', err);
    return [];
  }
}

/**
 * Fetch today's shift doc for a driver via Firestore REST.
 */
export async function fetchTodayShift(
  driverId: string,
): Promise<{ events: TimelineEvent[] } | null> {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const docId = `${driverId}_${date}`;
  const url = firestoreDocUrl('driver_shifts', docId);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const doc = await resp.json();
    const eventsRaw = doc.fields?.events?.arrayValue?.values || [];
    const events: TimelineEvent[] = eventsRaw.map((v: any) => {
      const f = v.mapValue?.fields || {};
      return {
        type: parseFirestoreValue(f.type) || '',
        timestamp: parseFirestoreValue(f.timestamp) || '',
        lat: parseFirestoreValue(f.lat) ?? null,
        lng: parseFirestoreValue(f.lng) ?? null,
        source: parseFirestoreValue(f.source),
      };
    });

    return { events };
  } catch (err) {
    console.warn('[daySummary] Failed to fetch shift:', err);
    return null;
  }
}

// ── Summary calculation ──────────────────────────────────────────────────────

/**
 * Build a complete day summary from invoices + shift data.
 */
export function calculateDaySummary(
  invoices: DaySummaryInvoice[],
  shiftEvents: TimelineEvent[],
): DaySummary {
  // Build unified timeline (shift events + invoice events)
  const timeline: UnifiedEvent[] = [];

  for (const evt of shiftEvents) {
    timeline.push({
      type: evt.type,
      timestamp: evt.timestamp,
      lat: evt.lat,
      lng: evt.lng,
    });
  }

  for (const inv of invoices) {
    for (const evt of inv.timeline) {
      timeline.push({
        type: evt.type,
        timestamp: evt.timestamp,
        lat: evt.lat,
        lng: evt.lng,
      });
    }
  }

  // Sort chronologically
  timeline.sort((a, b) => {
    const tA = new Date(a.timestamp).getTime() || 0;
    const tB = new Date(b.timestamp).getTime() || 0;
    return tA - tB;
  });

  // Extract shift bookends
  const loginEvt = shiftEvents.find(e => e.type === 'login');
  const logoutEvt = shiftEvents.find(e => e.type === 'logout');

  // Loads = count of completed invoices
  const totalLoads = invoices.length;
  const totalBBL = invoices.reduce((sum, i) => sum + i.totalBBL, 0);

  // Unique wells visited
  const wellSet = new Set<string>();
  for (const inv of invoices) {
    if (inv.wellName) wellSet.add(inv.wellName);
  }

  // Total hours worked = shift start to shift end
  let totalHoursWorked = 0;
  if (loginEvt && logoutEvt) {
    const startMs = new Date(loginEvt.timestamp).getTime();
    const endMs = new Date(logoutEvt.timestamp).getTime();
    if (endMs > startMs) {
      totalHoursWorked = Math.round((endMs - startMs) / 3600000 * 10) / 10;
    }
  }

  // Drive / on-site / distance from unified timeline
  const { driveMinutes, onSiteMinutes, driveMiles } = calculateDriveAndOnSiteTime(timeline);
  const driveHours = driveMinutes / 60;
  const avgSpeedMph = driveHours > 0 && driveMiles > 0
    ? Math.round(driveMiles / driveHours)
    : 0;

  return {
    totalLoads,
    totalBBL,
    wellsVisited: Array.from(wellSet),
    totalHoursWorked,
    driveMinutes,
    onSiteMinutes,
    driveMiles,
    avgSpeedMph,
    shiftStart: loginEvt?.timestamp || null,
    shiftEnd: logoutEvt?.timestamp || null,
  };
}
