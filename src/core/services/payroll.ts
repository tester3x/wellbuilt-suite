// src/core/services/payroll.ts
// Fetches invoice data for driver timesheet view via Firestore REST API.
// Mirrors Dashboard payroll logic: fetches all company invoices, filters by driver client-side.

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TimesheetInvoice {
  id: string;
  invoiceNumber: string;
  driver: string;
  operator: string;
  wellName: string;
  hauledTo: string;
  jobType: string;
  totalBBL: number;
  totalHours: number;
  status: string;
  date: string; // MM/DD/YYYY or ISO
  createdAt: string;
  county?: string;
  companyId?: string;
}

export interface RateEntry {
  jobType: string;
  method: 'per_bbl' | 'hourly';
  rate: number;
  frostRate?: number;
  frostRates?: Record<string, number>;
}

export interface PayConfig {
  employeeSplit?: number;
  rateSheets?: Record<string, RateEntry[]>; // per-operator rate sheets (matches Dashboard)
  frostZones?: Record<string, { startDate: string; endDate: string; maxBbls?: number }>;
}

export interface TimesheetRow {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  operator: string;
  jobType: string;
  bbls: number;
  hours: number;
  rate: number;
  rateMethod: string;
  gross: number;
  employeePay: number;
  status: string;
}

export interface TimesheetSummary {
  rows: TimesheetRow[];
  totalLoads: number;
  totalBBLs: number;
  totalHours: number;
  totalGross: number;
  totalPay: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
}

export type PeriodType = 'today' | 'this-week' | 'last-week' | 'biweekly';

// ── Firestore REST helpers ───────────────────────────────────────────────────

function firestoreQueryUrl(): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
}

function firestoreDocUrl(path: string): string {
  return `https://firestore.googleapis.com/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents/${path}?key=${FIREBASE_API_KEY}`;
}

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

// ── Period calculations ──────────────────────────────────────────────────────

/** Get Monday of the week (matches Dashboard payroll) */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getSunday(monday: Date): Date {
  const sun = new Date(monday);
  sun.setDate(sun.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return sun;
}

export function getPeriodDates(period: PeriodType): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (period) {
    case 'today': {
      const end = new Date(today);
      end.setHours(23, 59, 59, 999);
      return { start: today, end, label: 'Today' };
    }
    case 'this-week': {
      const start = getMonday(today);
      const end = getSunday(start);
      return { start, end, label: 'This Week' };
    }
    case 'last-week': {
      const thisMonday = getMonday(today);
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - 7);
      const end = getSunday(start);
      return { start, end, label: 'Last Week' };
    }
    case 'biweekly': {
      const thisMonday = getMonday(today);
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - 7);
      const end = getSunday(thisMonday);
      return { start, end, label: 'Last 2 Weeks' };
    }
  }
}

function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ── Data fetching ────────────────────────────────────────────────────────────

/**
 * Fetch invoices for a date range, filtered by companyId.
 * Driver filtering done CLIENT-SIDE to avoid needing composite indexes.
 * Matches Dashboard payroll approach exactly.
 */
export async function fetchDriverInvoices(
  displayName: string,
  companyId: string | undefined,
  start: Date,
  end: Date,
): Promise<TimesheetInvoice[]> {
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  // Only filter by createdAt range in the query — driver filtering done client-side.
  // This avoids the composite index requirement that was causing empty results.
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'invoices' }],
      where: {
        compositeFilter: {
          op: 'AND',
          filters: [
            {
              fieldFilter: {
                field: { fieldPath: 'createdAt' },
                op: 'GREATER_THAN_OR_EQUAL',
                value: { timestampValue: startISO },
              },
            },
            {
              fieldFilter: {
                field: { fieldPath: 'createdAt' },
                op: 'LESS_THAN_OR_EQUAL',
                value: { timestampValue: endISO },
              },
            },
          ],
        },
      },
      orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'ASCENDING' }],
    },
  };

  try {
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
      console.warn('[payroll] Firestore query failed:', resp.status);
      return [];
    }

    const results = await resp.json();
    const invoices: TimesheetInvoice[] = [];

    for (const result of results) {
      if (!result.document) continue;
      const f = result.document.fields || {};
      const nameParts = result.document.name.split('/');
      const docId = nameParts[nameParts.length - 1];

      const driver = parseFirestoreValue(f.driver) || '';
      const invoiceCompanyId = parseFirestoreValue(f.companyId) || '';
      const status = parseFirestoreValue(f.status) || 'open';

      // Client-side filters:
      // 1. Match driver name (case-insensitive)
      if (driver.toLowerCase() !== displayName.toLowerCase()) continue;
      // 2. Match company if specified
      if (companyId && invoiceCompanyId && invoiceCompanyId !== companyId) continue;
      // 3. Skip open/in-progress (match Dashboard: only closed+ count for pay)
      // But keep them visible so driver sees pay building in real-time
      // We'll mark them differently in the UI instead

      const createdAt = parseFirestoreValue(f.createdAt) || '';
      const dateStr = parseFirestoreValue(f.date) || '';

      invoices.push({
        id: docId,
        invoiceNumber: parseFirestoreValue(f.invoiceNumber) || docId.slice(0, 8),
        driver,
        operator: parseFirestoreValue(f.operator) || '',
        wellName: parseFirestoreValue(f.wellName) || '',
        hauledTo: parseFirestoreValue(f.hauledTo) || '',
        jobType: parseFirestoreValue(f.commodityType) || parseFirestoreValue(f.jobType) || 'Production Water',
        totalBBL: parseFirestoreValue(f.totalBBL) || 0,
        totalHours: parseFirestoreValue(f.totalHours) || 0,
        status,
        date: dateStr,
        createdAt,
        county: parseFirestoreValue(f.county) || '',
        companyId: invoiceCompanyId,
      });
    }

    return invoices;
  } catch (err) {
    console.warn('[payroll] Failed to fetch invoices:', err);
    return [];
  }
}

/**
 * Fetch company pay config (rate sheet + employee split) from Firestore.
 */
export async function fetchPayConfig(companyId: string): Promise<PayConfig | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(firestoreDocUrl(`companies/${companyId}`), {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const doc = await resp.json();
    const fields = doc.fields || {};

    const payConfig = parseFirestoreValue(fields.payConfig) || {};
    const rateSheets = parseFirestoreValue(fields.rateSheets) || {};

    // rateSheets is per-operator: { "SLAWSON EXPLORATION COMPANY, INC.": [{jobType, method, rate, ...}] }
    const parsedSheets: Record<string, RateEntry[]> = {};
    if (typeof rateSheets === 'object' && !Array.isArray(rateSheets)) {
      for (const [operator, entries] of Object.entries(rateSheets)) {
        if (Array.isArray(entries)) {
          parsedSheets[operator] = entries;
        }
      }
    }

    return {
      employeeSplit: payConfig.employeeSplit ?? payConfig.defaultSplit ?? 0.25,
      rateSheets: Object.keys(parsedSheets).length > 0 ? parsedSheets : undefined,
      frostZones: payConfig.frostZones || undefined,
    };
  } catch (err) {
    console.warn('[payroll] Failed to fetch pay config:', err);
    return null;
  }
}

// ── Rate calculation ─────────────────────────────────────────────────────────

/** Normalize date string to YYYY-MM-DD */
function toISODate(dateStr: string): string {
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) return dateStr.slice(0, 10);
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch {}
  return dateStr;
}

function isInFrostZone(isoDate: string, zone: { startDate: string; endDate: string }): boolean {
  if (!zone.startDate) return false;
  return isoDate >= zone.startDate && (!zone.endDate || isoDate <= zone.endDate);
}

/** JOB_TYPE_ALIASES — maps common variants to canonical names */
const JOB_TYPE_ALIASES: Record<string, string[]> = {
  'Production Water': ['PW', 'Prod Water', 'Production'],
  'Flowback': ['FB', 'Flow Back'],
  'Frac Water': ['Frac', 'Fresh Water'],
  'Skim Oil': ['Skim', 'Oil Skim'],
  'Service Work': ['Service', 'Maintenance'],
};

function lookupRate(rateSheets: Record<string, RateEntry[]>, operator: string, jobType: string): RateEntry | null {
  // Find the operator's rate sheet (case-insensitive)
  const operatorKey = Object.keys(rateSheets).find(k =>
    k.toLowerCase() === operator.toLowerCase()
  );
  const rateSheet = operatorKey ? rateSheets[operatorKey] : null;
  if (!rateSheet || !rateSheet.length) return null;

  const direct = rateSheet.find(r =>
    r.jobType.toLowerCase() === jobType.toLowerCase()
  );
  if (direct) return direct;

  for (const [canonical, aliases] of Object.entries(JOB_TYPE_ALIASES)) {
    if (aliases.some(a => a.toLowerCase() === jobType.toLowerCase()) ||
        canonical.toLowerCase() === jobType.toLowerCase()) {
      const match = rateSheet.find(r =>
        r.jobType.toLowerCase() === canonical.toLowerCase() ||
        aliases.some(a => a.toLowerCase() === r.jobType.toLowerCase())
      );
      if (match) return match;
    }
  }

  return rateSheet[0] || null;
}

function getEffectiveRate(
  entry: RateEntry,
  invoiceDate: string,
  county: string,
  frostZones?: Record<string, { startDate: string; endDate: string; maxBbls?: number }>,
  bbls?: number,
): number {
  if (entry.method !== 'per_bbl') return entry.rate;
  const isoDate = toISODate(invoiceDate);
  if (!isoDate) return entry.rate;

  if (frostZones) {
    const countyLower = county.toLowerCase();
    const matchedCounty = Object.keys(frostZones).find(k => k.toLowerCase() === countyLower);
    const effectiveCounty = matchedCounty || (frostZones['All Counties'] ? 'All Counties' : '');
    if (effectiveCounty) {
      const zone = frostZones[effectiveCounty];
      if (zone && isInFrostZone(isoDate, zone)) {
        const countyZone = matchedCounty ? frostZones[matchedCounty] : undefined;
        const maxBbls = countyZone?.maxBbls || zone.maxBbls;
        if (maxBbls && bbls && bbls > maxBbls) return entry.rate;

        const frostRates = entry.frostRates;
        if (frostRates) {
          const frostCounty = matchedCounty
            ? Object.keys(frostRates).find(k => k.toLowerCase() === countyLower)
            : undefined;
          const effectiveFrostCounty = frostCounty || (frostRates['All Counties'] !== undefined ? 'All Counties' : '');
          if (effectiveFrostCounty && frostRates[effectiveFrostCounty] > 0) {
            return frostRates[effectiveFrostCounty];
          }
        }
        if (entry.frostRate && entry.frostRate > 0) return entry.frostRate;
      }
    }
  }

  return entry.rate;
}

// ── Well → County lookup (NDIC data in Firestore) ──────────────────────────

/**
 * Build a map of wellName (lowercase) → county from Firestore wells collection.
 * Matches Dashboard's buildWellCountyMap() logic.
 */
export async function buildWellCountyMap(operators: string[]): Promise<Map<string, string>> {
  const countyMap = new Map<string, string>();
  if (!operators.length) return countyMap;

  for (const op of operators) {
    try {
      const body = {
        structuredQuery: {
          from: [{ collectionId: 'wells' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'operator' },
              op: 'EQUAL',
              value: { stringValue: op },
            },
          },
          select: {
            fields: [
              { fieldPath: 'well_name' },
              { fieldPath: 'county' },
            ],
          },
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(firestoreQueryUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) continue;

      const results = await resp.json();
      for (const result of results) {
        if (!result.document) continue;
        const f = result.document.fields || {};
        const wellName = parseFirestoreValue(f.well_name) || '';
        const county = parseFirestoreValue(f.county) || '';
        if (wellName && county) {
          countyMap.set(wellName.toLowerCase(), county);
        }
      }
    } catch {
      // Skip operator on error
    }
  }

  return countyMap;
}

// ── Fetch invoice detail + tickets (for paper-style detail view) ─────────────

export interface InvoiceDetail {
  docId: string;
  invoiceNumber: string;
  operator: string;
  wellName: string;
  hauledTo: string;
  status: string;
  totalBBL: number;
  totalHours: number;
  commodityType: string;
  date: string;
  driver: string;
  tickets: string[];
  ticketCount: number;
  truckNumber: string;
  trailer: string;
  startTime: string | null;
  stopTime: string | null;
  notes: string;
  state: string;
  timeline: { type: string; timestamp: string; locationName: string | null; lat: number | null; lng: number | null; leg: number }[];
}

export interface TicketDetail {
  docId: string;
  ticketNumber: string;
  location: string;
  hauledTo: string;
  type: string;
  qty: string;
  date: string;
  timeGauged: string;
  company: string;
  top: string;
  bottom: string;
  notes: string;
  apiNo: string;
  gpsLat: string;
  gpsLng: string;
  legalDesc: string;
  county: string;
  startTime: string;
  stopTime: string;
  hours: string;
  disposalApiNo: string;
}

/**
 * Fetch full invoice document by ID via Firestore REST API.
 */
export async function fetchInvoiceDetail(invoiceId: string): Promise<InvoiceDetail | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(firestoreDocUrl(`invoices/${invoiceId}`), {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const doc = await resp.json();
    const f = doc.fields || {};

    const timeline = parseFirestoreValue(f.timeline) || [];

    return {
      docId: invoiceId,
      invoiceNumber: parseFirestoreValue(f.invoiceNumber) || '',
      operator: parseFirestoreValue(f.operator) || '',
      wellName: parseFirestoreValue(f.wellName) || '',
      hauledTo: parseFirestoreValue(f.hauledTo) || '',
      status: parseFirestoreValue(f.status) || 'open',
      totalBBL: parseFirestoreValue(f.totalBBL) || 0,
      totalHours: parseFirestoreValue(f.totalHours) || 0,
      commodityType: parseFirestoreValue(f.commodityType) || '',
      date: parseFirestoreValue(f.date) || '',
      driver: parseFirestoreValue(f.driver) || '',
      tickets: parseFirestoreValue(f.tickets) || [],
      ticketCount: (parseFirestoreValue(f.tickets) || []).length,
      truckNumber: parseFirestoreValue(f.truckNumber) || '',
      trailer: parseFirestoreValue(f.trailer) || '',
      startTime: parseFirestoreValue(f.startTime) || null,
      stopTime: parseFirestoreValue(f.stopTime) || null,
      notes: parseFirestoreValue(f.notes) || '',
      state: parseFirestoreValue(f.state) || '',
      timeline: Array.isArray(timeline) ? timeline : [],
    };
  } catch (err) {
    console.warn('[payroll] Failed to fetch invoice detail:', err);
    return null;
  }
}

/**
 * Fetch water ticket details by ticket numbers via Firestore REST API.
 * Firestore REST 'in' filter limited to 30 values per query — chunk accordingly.
 */
export async function fetchTicketDetails(ticketNumbers: string[]): Promise<TicketDetail[]> {
  if (!ticketNumbers.length) return [];

  const details: TicketDetail[] = [];

  // Chunk into groups of 10 (Firestore REST 'IN' limit)
  const chunks: string[][] = [];
  for (let i = 0; i < ticketNumbers.length; i += 10) {
    chunks.push(ticketNumbers.slice(i, i + 10));
  }

  for (const chunk of chunks) {
    try {
      const body = {
        structuredQuery: {
          from: [{ collectionId: 'tickets' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'ticketNumber' },
              op: 'IN',
              value: {
                arrayValue: {
                  values: chunk.map(n => ({ stringValue: String(n) })),
                },
              },
            },
          },
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(firestoreQueryUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!resp.ok) continue;

      const results = await resp.json();
      for (const result of results) {
        if (!result.document) continue;
        const f = result.document.fields || {};
        const nameParts = result.document.name.split('/');
        const docId = nameParts[nameParts.length - 1];

        details.push({
          docId,
          ticketNumber: String(parseFirestoreValue(f.ticketNumber) || ''),
          location: parseFirestoreValue(f.location) || '',
          hauledTo: parseFirestoreValue(f.hauledTo) || '',
          type: parseFirestoreValue(f.type) || '',
          qty: parseFirestoreValue(f.qty) || '',
          date: parseFirestoreValue(f.date) || '',
          timeGauged: parseFirestoreValue(f.timeGauged) || '',
          company: parseFirestoreValue(f.company) || '',
          top: parseFirestoreValue(f.top) || '',
          bottom: parseFirestoreValue(f.bottom) || '',
          notes: parseFirestoreValue(f.notes) || '',
          apiNo: parseFirestoreValue(f.apiNo) || '',
          gpsLat: parseFirestoreValue(f.gpsLat) || '',
          gpsLng: parseFirestoreValue(f.gpsLng) || '',
          legalDesc: parseFirestoreValue(f.legalDesc) || '',
          county: parseFirestoreValue(f.county) || '',
          startTime: parseFirestoreValue(f.startTime) || '',
          stopTime: parseFirestoreValue(f.stopTime) || '',
          hours: parseFirestoreValue(f.hours) || '',
          disposalApiNo: parseFirestoreValue(f.disposalApiNo) || '',
        });
      }
    } catch {
      // Skip chunk on error
    }
  }

  // Sort by ticket number
  details.sort((a, b) => parseInt(a.ticketNumber) - parseInt(b.ticketNumber));
  return details;
}

// ── Build timesheet summary ──────────────────────────────────────────────────

export function buildTimesheetSummary(
  invoices: TimesheetInvoice[],
  payConfig: PayConfig | null,
  periodLabel: string,
  periodStart: Date,
  periodEnd: Date,
  wellCountyMap?: Map<string, string>,
): TimesheetSummary {
  const split = payConfig?.employeeSplit ?? 0.25;
  const rateSheets = payConfig?.rateSheets || {};
  const frostZones = payConfig?.frostZones;

  const rows: TimesheetRow[] = invoices.map(inv => {
    const rateEntry = lookupRate(rateSheets, inv.operator, inv.jobType);
    let rate = 0;
    let rateMethod = 'per_bbl';

    if (rateEntry) {
      rateMethod = rateEntry.method;
      // Look up county from NDIC well data if not on invoice
      const county = inv.county
        || wellCountyMap?.get(inv.wellName?.toLowerCase() || '')
        || '';
      rate = getEffectiveRate(
        rateEntry,
        inv.date || inv.createdAt,
        county,
        frostZones,
        inv.totalBBL,
      );
    }

    const gross = rateMethod === 'per_bbl'
      ? rate * inv.totalBBL
      : rate * inv.totalHours;

    const employeePay = Math.round(gross * split * 100) / 100;

    // Format date for display
    let displayDate = '';
    if (inv.date) {
      displayDate = inv.date;
    } else if (inv.createdAt) {
      try {
        const d = new Date(inv.createdAt);
        displayDate = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
      } catch {
        displayDate = '';
      }
    }

    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: displayDate,
      operator: inv.operator,
      jobType: inv.jobType,
      bbls: inv.totalBBL,
      hours: inv.totalHours,
      rate,
      rateMethod,
      gross: Math.round(gross * 100) / 100,
      employeePay,
      status: inv.status,
    };
  });

  return {
    rows,
    totalLoads: rows.length,
    totalBBLs: rows.reduce((s, r) => s + r.bbls, 0),
    totalHours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    totalGross: Math.round(rows.reduce((s, r) => s + r.gross, 0) * 100) / 100,
    totalPay: Math.round(rows.reduce((s, r) => s + r.employeePay, 0) * 100) / 100,
    periodLabel,
    periodStart: formatShortDate(periodStart),
    periodEnd: formatShortDate(periodEnd),
  };
}
