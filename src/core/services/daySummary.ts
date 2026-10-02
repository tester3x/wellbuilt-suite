// src/core/services/daySummary.ts
// Fetches today's invoice + shift data via Firestore REST API
// and calculates daily summary stats for the end-of-day screen.
// Pure calculation functions ported from Dashboard's driverLogs.ts.


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
  /** Extra stable identity values (e.g. passcodeHash). */
  identity?: DriverIdentity,
): Promise<DaySummaryInvoice[]> {
  const result = await fetchCompletedLoads({
    identity: { driverId, ...(identity || {}) },
    companyId,
    window,
  });
  return result.ok ? result.invoices : [];
}

/**
 * Completed loads for the driver, with a truthful failure mode.
 *
 * Query shape: scope on the axes that are reliable — companyId and the
 * createdAt window — then match the driver CLIENT-side against every stable
 * identity key. This is the part of WB-T History's approach that applies here
 * (rowMatchesDriverIdentity); its on-device closed-job ledger and archive union
 * are deliberately NOT copied, since WB-S cannot read WB-T's local storage and
 * cross-app storage coupling is not wanted.
 *
 * Without a companyId there is no safe scope to broaden into, so the query
 * falls back to driverId equality rather than reading the whole collection.
 */
export async function fetchCompletedLoads(opts: {
  identity: DriverIdentity;
  companyId?: string;
  window?: { startIso: string; endIso: string };
}): Promise<InvoiceFetchResult> {
  const keys = driverIdentityKeys(opts.identity);
  if (!keys.length) {
    // Transient missing identity is "unavailable", never zero.
    return { ok: false, reason: 'no_driver_identity' };
  }
  const { startIso: startOfDay, endIso: endOfDay } = opts.window ?? invoiceQueryWindow(null);

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
  ];

  if (opts.companyId) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'companyId' },
        op: 'EQUAL',
        value: { stringValue: opts.companyId },
      },
    });
  } else {
    filters.push({
      fieldFilter: {
        field: { fieldPath: 'driverId' },
        op: 'EQUAL',
        value: { stringValue: opts.identity.driverId || '' },
      },
    });
  }

  const body = {
    structuredQuery: {
      from: [{ collectionId: 'invoices' }],
      where: { compositeFilter: { op: 'AND', filters } },
      // No orderBy — avoids needing a composite index (see de7cd0c, which
      // removed an orderBy that made this query fail and show all zeros).
      // Results are sorted client-side in calculateDaySummary().
    },
  };

  try {
    console.log(
      '[daySummary] Querying invoices — companyScoped:', !!opts.companyId,
      'identityKeys:', keys.length, 'window:', startOfDay, '->', endOfDay,
    );
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
      if (resp.status === 400 && errText.includes('index')) {
        console.error('[daySummary] ⚠️ MISSING FIRESTORE INDEX — deploy firestore.indexes.json');
      }
      // A failed read is unavailable, not an empty shift.
      return { ok: false, reason: `query_failed_${resp.status}` };
    }

    const results = await resp.json();
    const invoices: DaySummaryInvoice[] = [];
    let identityRejected = 0;
    let statusRejected = 0;

    for (const result of results) {
      if (!result.document) continue;
      const fields = result.document.fields || {};
      const row: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) row[k] = parseFirestoreValue(v);

      if (!invoiceMatchesDriver(row, keys)) { identityRejected += 1; continue; }

      const status = (row.status as string) || 'open';
      if (!isCompletedLoad(status)) { statusRejected += 1; continue; }

      const timelineRaw = (row.timeline as any[]) || [];
      const timeline: TimelineEvent[] = timelineRaw.map((evt: any) => ({
        type: evt?.type || '',
        timestamp: evt?.timestamp || '',
        lat: evt?.lat ?? null,
        lng: evt?.lng ?? null,
        source: evt?.source,
        locationName: evt?.locationName,
      }));

      const nameParts = result.document.name.split('/');
      const docId = nameParts[nameParts.length - 1];

      invoices.push({
        id: docId,
        wellName: (row.wellName as string) || '',
        hauledTo: (row.hauledTo as string) || '',
        operator: (row.operator as string) || '',
        totalBBL: (row.totalBBL as number) || 0,
        totalHours: (row.totalHours as number) || 0,
        status,
        timeline,
        createdAt: (row.createdAt as string) || (row.invoiceStartedAt as string) || '',
      });
    }

    console.log(
      '[daySummary] invoices kept:', invoices.length,
      'rejected(identity):', identityRejected, 'rejected(status):', statusRejected,
    );
    return { ok: true, invoices };
  } catch (err) {
    console.warn('[daySummary] Failed to fetch invoices:', err);
    return { ok: false, reason: 'query_error' };
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

    if (!resp.ok) {
      // Previously `return null` with no log at all, so an unreadable shift
      // record was indistinguishable from a shift that had no events — and the
      // screen blanked its times either way with nothing in the log to explain
      // it. Note these Firestore reads carry only an API key and no
      // Authorization header, so a rules-protected collection answers 403 here.
      const errText = await resp.text().catch(() => '');
      console.warn(
        '[daySummary] driver_shifts read failed:', resp.status,
        'doc:', docId, errText.substring(0, 200),
      );
      return null;
    }

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



// ── Driver identity and completed-load selection ─────────────────────────────

/**
 * The driver's stable identity values.
 *
 * WB-S carries TWO and uses them inconsistently: useAppLauncher and
 * createSuiteDvirGate hand other WB apps `hash: user.passcodeHash`, while
 * day-summary's JSA deep link and the invoice query used `user.driverId`. If
 * WB-T stamps an invoice with the identity it was LAUNCHED with, a query keyed
 * on driverId alone can match nothing — which is a zero-load screen for a shift
 * of real work, the same shape as the 2026-09-24 display-name bug that
 * a03f336 fixed by switching to driverId.
 *
 * Rather than bet on one field name again, collect every stable value and match
 * any of them. Display names are deliberately NOT identity: WB-T stamps the
 * canonical name while WB-S holds the login alias, which is exactly what made
 * the pre-a03f336 join silently empty.
 */
export type DriverIdentity = {
  driverId?: string | null;
  passcodeHash?: string | null;
};

export function driverIdentityKeys(identity: DriverIdentity): string[] {
  const keys = [identity.driverId, identity.passcodeHash]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim().toLowerCase());
  return Array.from(new Set(keys));
}

/** Identity fields an invoice may carry, across WB-T versions. */
const INVOICE_IDENTITY_FIELDS = ['driverId', 'driverHash', 'driverUid', 'driverKey'] as const;

/**
 * Does this invoice belong to the driver? Compares every identity field the
 * row carries against every stable key the driver has. Never matches on a
 * display name, and never matches on an empty value.
 */
export function invoiceMatchesDriver(
  row: Record<string, unknown>,
  keys: string[],
): boolean {
  if (!keys.length) return false;
  for (const field of INVOICE_IDENTITY_FIELDS) {
    const raw = row?.[field];
    if (typeof raw !== 'string') continue;
    const value = raw.trim().toLowerCase();
    if (value && keys.includes(value)) return true;
  }
  return false;
}

/**
 * Statuses that mean a haul was actually COMPLETED.
 *
 * An allowlist on purpose. WB-T's HISTORY_TERMINAL_STATUSES also admits `void`
 * and can show unknown legacy statuses, which is right for a history view and
 * wrong here: this card says "completed loads". Canceled, void and anything
 * in-progress or unrecognised is excluded, so an unfamiliar status can never
 * silently inflate the count.
 */
const COMPLETED_LOAD_STATUSES: ReadonlySet<string> = new Set([
  'closed',
  'submitted',
  'approved',
  'paid',
]);

/** Explicitly non-completed, listed so the intent is readable and testable. */
const NOT_COMPLETED_STATUSES: ReadonlySet<string> = new Set([
  'canceled',
  'cancelled',
  'void',
  'voided',
  'open',
  'active',
  'in_progress',
  'draft',
  'rejected',
]);

export function isCompletedLoad(status: string | null | undefined): boolean {
  const s = (status || '').trim().toLowerCase();
  if (!s) return false;
  if (NOT_COMPLETED_STATUSES.has(s)) return false;
  return COMPLETED_LOAD_STATUSES.has(s);
}

/**
 * A query that failed is NOT "no loads". The screen must be able to tell a
 * driver who hauled nothing from a driver whose records could not be read.
 */
export type InvoiceFetchResult =
  | { ok: true; invoices: DaySummaryInvoice[] }
  | { ok: false; reason: string };

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
 * is the correct UTC bound. The lower bound is the shift's ORIGIN DAY when it
 * is known, which is what makes a cross-midnight shift work — a date, not a
 * claimed start time. calculateDaySummary still narrows to the shift's actual
 * recorded bookends, so a wider fetch cannot inflate the count.
 *
 * NOTE on scope: the query field is invoice `createdAt`, i.e. when the invoice
 * was CREATED, not when the load was closed. The two differ, and this window
 * only governs which documents are fetched.
 */
export function invoiceQueryWindow(
  /** Origin local date (YYYY-MM-DD) of the completed shift, when known. */
  originLocalDate: string | null,
  now: Date = new Date(),
): { startIso: string; endIso: string } {
  const HOUR = 60 * 60 * 1000;
  const endIso = new Date(now.getTime() + HOUR).toISOString();
  const m = originLocalDate && /^(\d{4})-(\d{2})-(\d{2})$/.exec(originLocalDate);
  const base = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return { startIso: base.toISOString(), endIso };
}

/** Where a bookend came from, so the UI can be honest about what it knows. */
export type ShiftBookendSource = 'event' | 'unavailable';

export type ShiftBookends = {
  startIso: string | null;
  endIso: string | null;
  startSource: ShiftBookendSource;
  endSource: ShiftBookendSource;
};

/** Period ids are `YYYY-MM-DD_HHMMSS`; the DATE part identifies the origin day. */
export function originDateFromPeriodId(periodId: string | null | undefined): string | null {
  if (!periodId) return null;
  const m = periodId.match(/^(\d{4}-\d{2}-\d{2})_\d{6}$/);
  return m ? m[1] : null;
}

/**
 * The completed shift's start and stop, taken from the server-authored
 * `login` / `logout` events in the origin-day document.
 *
 * CORRECTION (2026-10-02): an earlier revision of this function fell back to
 * the period id when no login event was found, on the reasoning that an
 * enforced shift writes no client login. That reasoning was wrong twice over.
 * The server writes login at claim and logout at close into the origin-day
 * document — a field receipt read exactly those events for period
 * 2026-09-29_080914 — so the client avoiding a DUPLICATE write is not the same
 * as the events being absent. And the period id is minted CLIENT-side by
 * mintShiftId() before the claim, so its timestamp is a local clock reading,
 * not an authoritative start. Deriving a displayed start from it would have
 * shown an invented time next to a real one.
 *
 * Events are therefore the only source. When they cannot be read the caller is
 * told so, rather than a plausible-looking substitute being rendered.
 */
export function resolveShiftBookends(input: { events: TimelineEvent[] }): ShiftBookends {
  const events = Array.isArray(input.events) ? input.events : [];
  const usable = (e: TimelineEvent) => !!e?.timestamp && !Number.isNaN(new Date(e.timestamp).getTime());
  // Last pair: a day document accumulates events across shifts via arrayUnion.
  const logins = events.filter(e => e?.type === 'login' && usable(e));
  const logouts = events.filter(e => e?.type === 'logout' && usable(e));
  const loginEvt = logins[logins.length - 1] || null;
  const logoutEvt = logouts[logouts.length - 1] || null;

  return {
    startIso: loginEvt ? loginEvt.timestamp : null,
    endIso: logoutEvt ? logoutEvt.timestamp : null,
    startSource: loginEvt ? 'event' : 'unavailable',
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
): DaySummary {
  // Bookends are the server-authored login/logout pair in the origin-day
  // document (the LAST pair, since a day accumulates events across shifts).
  const bookends = resolveShiftBookends({ events: shiftEvents });
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
