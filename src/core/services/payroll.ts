// src/core/services/payroll.ts
// Fetches invoice data for driver timesheet view via Firestore REST API.
// Shows real-time pay building as driver works throughout the day/week.

const FIRESTORE_PROJECT = 'wellbuilt-sync';
const FIREBASE_API_KEY = 'AIzaSyAGWXa-doFGzo7T5SxHVD_v5-SHXIc8wAI';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TimesheetInvoice {
  id: string;
  invoiceNumber: string;
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
  rateSheet?: RateEntry[];
  frostZones?: Record<string, { startDate: string; endDate: string; maxBbls?: number }>;
}

export interface TimesheetRow {
  invoiceId: string;
  invoiceNumber: string;
  date: string;
  operator: string;
  wellName: string;
  hauledTo: string;
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

function getStartOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
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
      const start = getStartOfWeek(today);
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: 'This Week' };
    }
    case 'last-week': {
      const thisWeekStart = getStartOfWeek(today);
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(thisWeekStart);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: 'Last Week' };
    }
    case 'biweekly': {
      const thisWeekStart = getStartOfWeek(today);
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - 7);
      const end = new Date(thisWeekStart);
      end.setDate(end.getDate() + 6);
      end.setHours(23, 59, 59, 999);
      return { start, end, label: 'Last 2 Weeks' };
    }
  }
}

function formatShortDate(date: Date): string {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

// ── Data fetching ────────────────────────────────────────────────────────────

/**
 * Fetch invoices for a specific driver within a date range.
 * Includes ALL statuses (open + closed) so driver sees pay building in real-time.
 */
export async function fetchDriverInvoices(
  displayName: string,
  companyId: string | undefined,
  start: Date,
  end: Date,
): Promise<TimesheetInvoice[]> {
  const startISO = start.toISOString();
  const endISO = end.toISOString();

  const filters: any[] = [
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

      const createdAt = parseFirestoreValue(f.createdAt) || '';
      const dateStr = parseFirestoreValue(f.date) || '';

      invoices.push({
        id: docId,
        invoiceNumber: parseFirestoreValue(f.invoiceNumber) || docId.slice(0, 8),
        operator: parseFirestoreValue(f.operator) || '',
        wellName: parseFirestoreValue(f.wellName) || '',
        hauledTo: parseFirestoreValue(f.hauledTo) || '',
        jobType: parseFirestoreValue(f.jobType) || 'Production Water',
        totalBBL: parseFirestoreValue(f.totalBBL) || 0,
        totalHours: parseFirestoreValue(f.totalHours) || 0,
        status: parseFirestoreValue(f.status) || 'open',
        date: dateStr,
        createdAt,
        county: parseFirestoreValue(f.county) || '',
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
    const rateSheet = parseFirestoreValue(fields.rateSheet) || [];

    return {
      employeeSplit: payConfig.employeeSplit ?? 0.25,
      rateSheet: Array.isArray(rateSheet) ? rateSheet : [],
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
  // Try ISO timestamp
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

function lookupRate(rateSheet: RateEntry[], operator: string, jobType: string): RateEntry | null {
  if (!rateSheet.length) return null;

  // Direct match
  const direct = rateSheet.find(r =>
    r.jobType.toLowerCase() === jobType.toLowerCase()
  );
  if (direct) return direct;

  // Alias match
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

  // Default — first entry as fallback
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

// ── Build timesheet summary ──────────────────────────────────────────────────

export function buildTimesheetSummary(
  invoices: TimesheetInvoice[],
  payConfig: PayConfig | null,
  periodLabel: string,
  periodStart: Date,
  periodEnd: Date,
): TimesheetSummary {
  const split = payConfig?.employeeSplit ?? 0.25;
  const rateSheet = payConfig?.rateSheet || [];
  const frostZones = payConfig?.frostZones;

  const rows: TimesheetRow[] = invoices.map(inv => {
    const rateEntry = lookupRate(rateSheet, inv.operator, inv.jobType);
    let rate = 0;
    let rateMethod = 'per_bbl';

    if (rateEntry) {
      rateMethod = rateEntry.method;
      rate = getEffectiveRate(
        rateEntry,
        inv.date || inv.createdAt,
        inv.county || '',
        frostZones,
        inv.totalBBL,
      );
    }

    const gross = rateMethod === 'per_bbl'
      ? rate * inv.totalBBL
      : rate * inv.totalHours;

    const employeePay = gross * split;

    // Format the date for display
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
      wellName: inv.wellName,
      hauledTo: inv.hauledTo,
      jobType: inv.jobType,
      bbls: inv.totalBBL,
      hours: inv.totalHours,
      rate,
      rateMethod,
      gross,
      employeePay,
      status: inv.status,
    };
  });

  return {
    rows,
    totalLoads: rows.length,
    totalBBLs: rows.reduce((s, r) => s + r.bbls, 0),
    totalHours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 10) / 10,
    totalGross: rows.reduce((s, r) => s + r.gross, 0),
    totalPay: rows.reduce((s, r) => s + r.employeePay, 0),
    periodLabel,
    periodStart: formatShortDate(periodStart),
    periodEnd: formatShortDate(periodEnd),
  };
}
