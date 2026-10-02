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
  createdAt: string;
}

export interface WellStat {
  name: string;
  bbls: number;
  loads: number;
}

export interface DaySummary {
  totalLoads: number;
  totalBBL: number;
  wellsVisited: string[];
  wellStats: WellStat[];
  totalHoursWorked: number;
  driveMinutes: number;
  onSiteMinutes: number;
  pickupMinutes: number;
  dropoffMinutes: number;
  driveMiles: number;
  avgSpeedMph: number;
  shiftStart: string | null;
  shiftEnd: string | null;
  /** Where each bookend came from, so the screen can be honest when absent. */
  shiftStartSource: ShiftBookendSource;
  shiftEndSource: ShiftBookendSource;
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
  pickupMinutes: number;
  dropoffMinutes: number;
  driveMiles: number;
} {
  let driveMs = 0;
  let onSiteMs = 0;
  let pickupMs = 0;
  let dropoffMs = 0;
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
    } else if (curr.type === 'accept' && next.type === 'arrive') {
      // Driving to well after accepting job
      driveMs += diffMs;
      isDrive = true;
    } else if (curr.type === 'close' && next.type === 'accept') {
      // Driving from SWD to next well (between jobs)
      driveMs += diffMs;
      isDrive = true;
    } else if (curr.type === 'login' && (next.type === 'depart' || next.type === 'accept')) {
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
      // arrive→depart_site = at pickup (loading), arrive→close = at drop-off (unloading)
      if (next.type === 'depart_site') {
        pickupMs += diffMs;
      } else {
        dropoffMs += diffMs;
      }
    }

    if (isDrive && curr.lat && curr.lng && next.lat && next.lng) {
      driveMeters += haversineMeters(curr.lat, curr.lng, next.lat, next.lng);
    }
  }

  return {
    driveMinutes: Math.round(driveMs / 60000),
    onSiteMinutes: Math.round(onSiteMs / 60000),
    pickupMinutes: Math.round(pickupMs / 60000),
    dropoffMinutes: Math.round(dropoffMs / 60000),
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
// 2026-09-24: join by STABLE driver identity (driverId), not the display name.
// WB-T stamps invoice.driver with the canonical driver name (e.g. "Mike ZFold7
// Burger") while WB-S passes the login alias (e.g. "Mikezfold"); the old
// `driver == displayName` join silently returned zero loads for a full shift of
// real closed invoices. Invoices carry driverId (== WB-S user.driverId, the
// same id the JSA query already keys on).
export async function fetchTodayInvoices(
  driverId: string,
  companyId?: string,
  /** Explicit UTC window. Omit only for a legacy local-day query. */
  window?: { startIso: string; endIso: string },
): Promise<DaySummaryInvoice[]> {
  const { startIso: startOfDay, endIso: endOfDay } = window ?? invoiceQueryWindow(null);

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
        field: { fieldPath: 'driverId' },
        op: 'EQUAL',
        value: { stringValue: driverId },
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
    console.log('[daySummary] Querying invoices for driverId:', driverId, 'companyId:', companyId || '(none)', 'window:', startOfDay, '->', endOfDay);
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
        createdAt: parseFirestoreValue(fields.createdAt) || parseFirestoreValue(fields.invoiceStartedAt) || '',
      });
    }

    return invoices;
  } catch (err) {
    console.warn('[daySummary] Failed to fetch invoices:', err);
    return [];
  }
}

/**
 * Fetch a driver_shifts day document by local date (YYYY-MM-DD).
 * Under enforced explicit shift, bookends live on the ORIGIN day of the
 * period — not "calendar today" after a cross-midnight close.
 */
export async function fetchShiftDocForDate(
  driverId: string,
  localDate: string,
): Promise<{ events: TimelineEvent[]; odometerMiles: number; date: string } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) return null;
  const docId = `${driverId}_${localDate}`;
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

    const odometerMiles = parseFirestoreValue(doc.fields?.odometerMiles) || 0;
    return { events, odometerMiles, date: localDate };
  } catch (err) {
    console.warn('[daySummary] Failed to fetch shift:', err);
    return null;
  }
}

/**
 * Fetch today's shift doc for a driver via Firestore REST (calendar today).
 * Prefer fetchShiftDocForDate with originLocalDate for explicit periods.
 */
export async function fetchTodayShift(
  driverId: string,
): Promise<{ events: TimelineEvent[]; odometerMiles?: number } | null> {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const result = await fetchShiftDocForDate(driverId, date);
  if (!result) return null;
  return { events: result.events, odometerMiles: result.odometerMiles };
}

/**
 * Resolve which day document holds the just-completed explicit shift.
 * Prefer stored originLocalDate, then periodId prefix, then calendar today (legacy).
 */
export function resolveShiftSummaryDate(opts: {
  originLocalDate?: string | null;
  periodId?: string | null;
  todayLocalDate: string;
}): string {
  if (opts.originLocalDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.originLocalDate)) {
    return opts.originLocalDate;
  }
  if (opts.periodId && /^\d{4}-\d{2}-\d{2}/.test(opts.periodId)) {
    return opts.periodId.slice(0, 10);
  }
  return opts.todayLocalDate;
}


// ── Shift bookends and query windows ─────────────────────────────────────────

/**
 * Local-midnight-to-now, expressed correctly in UTC.
 *
 * THE BUG THIS REPLACES: the old query took the LOCAL calendar y/m/d and
 * stamped it with a literal `Z`:
 *     `${year}-${month}-${day}T00:00:00Z` .. `T23:59:59.999Z`
 * For a driver at UTC-5 the real local day runs 05:00Z today to 05:00Z
 * tomorrow, so every invoice closed after 19:00 local (00:00Z the NEXT UTC
 * day) fell outside the window and the screen reported "No completed loads
 * today" for a shift full of real closed loads. A shift spanning midnight lost
 * the earlier day entirely.
 *
 * `new Date(y, m, d)` is local midnight as a real instant, so `.toISOString()`
 * is the correct UTC bound. When the shift's start is known we query from the
 * shift instead of the calendar day, which is what actually matters — and
 * cross-midnight shifts then work. An hour of slack on each end absorbs device
 * clock skew; calculateDaySummary still narrows to the shift window, so a wider
 * fetch cannot inflate the count.
 */
export function invoiceQueryWindow(
  shiftStartIso: string | null,
  now: Date = new Date(),
): { startIso: string; endIso: string } {
  const HOUR = 60 * 60 * 1000;
  const endIso = new Date(now.getTime() + HOUR).toISOString();
  if (shiftStartIso) {
    const startMs = new Date(shiftStartIso).getTime();
    if (!Number.isNaN(startMs)) {
      return { startIso: new Date(startMs - HOUR).toISOString(), endIso };
    }
  }
  const localMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return { startIso: localMidnight.toISOString(), endIso };
}

/** Where a bookend came from, so the UI can be honest about what it knows. */
export type ShiftBookendSource = 'event' | 'period_id' | 'unavailable';

export type ShiftBookends = {
  startIso: string | null;
  endIso: string | null;
  startSource: ShiftBookendSource;
  endSource: ShiftBookendSource;
};

/** Period ids are `YYYY-MM-DD_HHMMSS` in the driver's local wall clock. */
export function periodIdToStartIso(periodId: string | null | undefined): string | null {
  if (!periodId) return null;
  const m = periodId.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec] = m;
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/**
 * The completed shift's actual start and stop.
 *
 * THE BUG THIS REPLACES: start and end were read ONLY from `login` / `logout`
 * events in the day document. Under enforced explicit_shift the client writes
 * neither — claimEnforcedExplicitStart "never appends client login", and
 * recordShiftEvent refuses any direct write when enforcedExplicit is set. So
 * for every enforced shift both ends were null and the screen read
 * "--:-- – --:--", with or without loads.
 *
 * The period id is server-assigned at claim and encodes the authoritative
 * start, so it is a real record rather than a guess. There is no equivalent
 * client-side source for the END: when no logout event exists the end is
 * reported as genuinely unavailable rather than being filled in from the phone
 * clock, which would silently invent a shift length.
 */
export function resolveShiftBookends(input: {
  events: TimelineEvent[];
  periodId?: string | null;
}): ShiftBookends {
  const events = Array.isArray(input.events) ? input.events : [];
  const usable = (e: TimelineEvent) => !!e?.timestamp && !Number.isNaN(new Date(e.timestamp).getTime());
  const logins = events.filter(e => e?.type === 'login' && usable(e));
  const logouts = events.filter(e => e?.type === 'logout' && usable(e));
  const loginEvt = logins[logins.length - 1] || null;
  const logoutEvt = logouts[logouts.length - 1] || null;

  if (loginEvt) {
    return {
      startIso: loginEvt.timestamp,
      endIso: logoutEvt ? logoutEvt.timestamp : null,
      startSource: 'event',
      endSource: logoutEvt ? 'event' : 'unavailable',
    };
  }

  const fromPeriod = periodIdToStartIso(input.periodId);
  return {
    startIso: fromPeriod,
    endIso: logoutEvt ? logoutEvt.timestamp : null,
    startSource: fromPeriod ? 'period_id' : 'unavailable',
    endSource: logoutEvt ? 'event' : 'unavailable',
  };
}

// ── JSA presentation ─────────────────────────────────────────────────────────

/**
 * Requirement, status and optional completion are three different things.
 *
 * THE BUG THIS REPLACES: the card rendered from jsaStatus alone and never
 * consulted the company's jsaMode. With JSA switched off the driver was still
 * shown an amber "Pending" and a "Complete JSA Now" command — an obligation
 * their company had not set. jsaMode was read, but only to decide the shift-end
 * gate, never the card.
 */
export type JsaCardView =
  | { show: false; required: boolean }
  | {
      show: true;
      required: boolean;
      tone: 'complete' | 'pending' | 'informational';
      headline: string;
      showCompleteAction: boolean;
    };

/** Any mode other than 'off' (or absent/unknown) requires a JSA. */
export function jsaIsRequired(mode: string | null | undefined): boolean {
  const m = (mode || 'off').trim().toLowerCase();
  return m === 'per_shift' || m === 'per_job' || m === 'per_location' || m === 'per_load';
}

export function jsaCardPresentation(input: {
  mode: string | null | undefined;
  completed: boolean;
  /** Whether any jsa_day_status record was found at all. */
  hasRecord: boolean;
}): JsaCardView {
  const required = jsaIsRequired(input.mode);

  if (!required) {
    // Nothing is owed. A JSA that was completed anyway is worth showing as a
    // fact; an absent one is not a finding and must not be framed as pending.
    if (input.completed) {
      return {
        show: true,
        required: false,
        tone: 'informational',
        headline: 'JSA completed (not required)',
        showCompleteAction: false,
      };
    }
    return { show: false, required: false };
  }

  if (input.completed) {
    return { show: true, required: true, tone: 'complete', headline: 'JSA completed', showCompleteAction: false };
  }
  return {
    show: true,
    required: true,
    tone: 'pending',
    headline: 'JSA pending',
    showCompleteAction: input.hasRecord || true,
  };
}

// ── Summary calculation ──────────────────────────────────────────────────────

/**
 * Build a complete day summary from invoices + shift data.
 */
export function calculateDaySummary(
  invoices: DaySummaryInvoice[],
  shiftEvents: TimelineEvent[],
  odometerMiles?: number,
  /** Period id, so an enforced shift (which writes no login event) still has bookends. */
  opts?: { periodId?: string | null },
): DaySummary {
  // Bookends come from the last login/logout pair when the client wrote them
  // (multiple shifts per day append via arrayUnion, so the LAST pair is the
  // current shift), and otherwise from the server-assigned period id. Without
  // this fallback an enforced shift has no window at all, which both blanked
  // the displayed times AND disabled the invoice filter below.
  const bookends = resolveShiftBookends({ events: shiftEvents, periodId: opts?.periodId });
  const loginEvt = bookends.startIso ? { timestamp: bookends.startIso } : null;
  const logoutEvt = bookends.endIso ? { timestamp: bookends.endIso } : null;

  // Filter invoices to only those within the shift window.
  // Without a shift, show all (backwards compat). With a shift, only count
  // invoices created between start and end (or now if shift still open).
  const shiftStartMs = loginEvt ? new Date(loginEvt.timestamp).getTime() : 0;
  const shiftEndMs = logoutEvt ? new Date(logoutEvt.timestamp).getTime() : Date.now();
  const shiftInvoices = loginEvt
    ? invoices.filter(inv => {
        // Use createdAt, fall back to first timeline event timestamp
        const createdStr = inv.createdAt || inv.timeline[0]?.timestamp || '';
        const created = new Date(createdStr).getTime();
        if (isNaN(created)) return true; // Can't filter without a date — include it
        return created >= shiftStartMs && created <= shiftEndMs;
      })
    : invoices;

  // Build unified timeline from CURRENT shift events + shift-filtered invoice events.
  // Only include shift events within the current shift window (multi-shift days have
  // earlier events from previous shifts that would corrupt drive time / mileage).
  const timeline: UnifiedEvent[] = [];

  for (const evt of shiftEvents) {
    const evtMs = new Date(evt.timestamp).getTime();
    if (isNaN(evtMs)) continue;
    // Only include events from the current shift window
    if (loginEvt && evtMs < shiftStartMs) continue;
    if (logoutEvt && evtMs > shiftEndMs + 60000) continue; // 1min grace for logout event itself
    timeline.push({
      type: evt.type,
      timestamp: evt.timestamp,
      lat: evt.lat,
      lng: evt.lng,
    });
  }

  for (const inv of shiftInvoices) {
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

  // Loads = count of completed invoices within shift
  const totalLoads = shiftInvoices.length;
  const totalBBL = shiftInvoices.reduce((sum, i) => sum + i.totalBBL, 0);

  // Unique wells visited during shift + per-well BBL/load stats
  const wellSet = new Set<string>();
  const wellMap = new Map<string, { bbls: number; loads: number }>();
  for (const inv of shiftInvoices) {
    if (inv.wellName) {
      wellSet.add(inv.wellName);
      const existing = wellMap.get(inv.wellName) || { bbls: 0, loads: 0 };
      existing.bbls += inv.totalBBL;
      existing.loads += 1;
      wellMap.set(inv.wellName, existing);
    }
  }
  const wellStats: WellStat[] = Array.from(wellMap.entries()).map(([name, stat]) => ({
    name,
    bbls: Math.round(stat.bbls),
    loads: stat.loads,
  }));

  // Total hours worked = shift start to shift end (or now if shift still open)
  let totalHoursWorked = 0;
  if (loginEvt) {
    const endMs = logoutEvt ? new Date(logoutEvt.timestamp).getTime() : Date.now();
    if (endMs > shiftStartMs) {
      totalHoursWorked = Math.round((endMs - shiftStartMs) / 3600000 * 10) / 10;
    }
  }

  // Drive / on-site / distance from unified timeline
  const { driveMinutes, onSiteMinutes, pickupMinutes, dropoffMinutes, driveMiles: haversineMiles } = calculateDriveAndOnSiteTime(timeline);

  // Prefer odometer (most accurate) > invoice Directions API > Haversine
  const invoiceMiles = shiftInvoices.reduce((sum, inv) => {
    const miles = (inv as any).driveMiles || (inv as any).driveDistanceMiles || 0;
    return sum + miles;
  }, 0);
  const driveMiles = (odometerMiles && odometerMiles > 0)
    ? odometerMiles
    : (invoiceMiles > 0 ? Math.round(invoiceMiles * 10) / 10 : haversineMiles);

  const driveHours = driveMinutes / 60;
  const avgSpeedMph = driveHours > 0 && driveMiles > 0
    ? Math.round(driveMiles / driveHours)
    : 0;

  return {
    totalLoads,
    totalBBL,
    wellsVisited: Array.from(wellSet),
    wellStats,
    totalHoursWorked,
    driveMinutes,
    onSiteMinutes,
    pickupMinutes,
    dropoffMinutes,
    driveMiles,
    avgSpeedMph,
    shiftStart: bookends.startIso,
    shiftEnd: bookends.endIso,
    shiftStartSource: bookends.startSource,
    shiftEndSource: bookends.endSource,
  };
}
