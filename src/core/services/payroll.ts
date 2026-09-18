// src/core/services/payroll.ts
// Fetches invoice data for driver timesheet view via Firestore REST API.
// Financial eligibility, rates, quantity, and time use financialCorrectnessCore v1.
import {
  hoursDisplay,
  mixedQuantitySummary,
  projectFinancialLine,
  quantityDisplay,
  resolveEmployeeSplit,
  resolveFinancialRate,
} from './financialCorrectnessCore';

export { mixedQuantitySummary, hoursDisplay };

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
  totalBBL?: number;
  totalHours: number;
  status: string;
  date: string; // MM/DD/YYYY or ISO
  createdAt: string;
  county?: string;
  companyId?: string;
  bblsField?: number | null;
  qtyField?: number | string | null;
  qtyUnit?: string | null;
  unit?: string | null;
  tons?: number | null;
  netWeight?: number | null;
  allocatedHours?: number | null;
  observedHours?: number | null;
  actualDriveMinutes?: number | null;
  allocationMethod?: string | null;
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
  defaultSplit?: number;
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
  qtyUnit?: 'bbl' | 'ton' | null;
  qtyValue?: number | null;
  qtyDisplay?: string;
  qtyState?: string;
  observedHours?: number | null;
  allocatedHours?: number | null;
  hoursProvenance?: string;
  hoursDisplay?: string;
  amountUnresolved?: string | null;
  payable?: boolean;
}

export interface TimesheetSummary {
  rows: TimesheetRow[];
  totalLoads: number;
  totalBBLs: number;
  totalTons: number;
  unresolvedCount: number;
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
      const driverDispName = parseFirestoreValue(f.driverDisplayName) || '';
      const invoiceCompanyId = parseFirestoreValue(f.companyId) || '';
      const status = parseFirestoreValue(f.status) || 'open';

      // Client-side filters:
      // 1. Match driver name (case-insensitive) — check both driver (legalName) and driverDisplayName
      const dn = displayName.toLowerCase();
      if (driver.toLowerCase() !== dn && driverDispName.toLowerCase() !== dn) continue;
      // 2. Match company if specified
      if (companyId && invoiceCompanyId && invoiceCompanyId !== companyId) continue;
      // 3. Skip open/in-progress (match Dashboard: only closed+ count for pay)
      // But keep them visible so driver sees pay building in real-time
      // We'll mark them differently in the UI instead

      const createdAt = parseFirestoreValue(f.createdAt) || '';
      const dateStr = parseFirestoreValue(f.date) || '';

      // For s_t mode: invoiceNumber is empty/"N/A", use ticket number or well name instead
      const rawInvoiceNum = parseFirestoreValue(f.invoiceNumber) || '';
      const ticketNum = parseFirestoreValue(f.ticketNumber) || '';
      const wellName = parseFirestoreValue(f.wellName) || '';
      const tickets = parseFirestoreValue(f.tickets) || [];
      const firstTicket = Array.isArray(tickets) && tickets.length > 0 ? String(tickets[0]) : '';
      // Display priority: invoiceNumber (if real) > ticket number > first ticket from array > well name > docId
      const displayNumber = (rawInvoiceNum && rawInvoiceNum !== 'N/A')
        ? rawInvoiceNum
        : ticketNum || firstTicket || wellName || docId.slice(0, 8);

      const rawTotalBBL = parseFirestoreValue(f.totalBBL);
      const rawBbls = parseFirestoreValue(f.bbls);
      const rawQty = parseFirestoreValue(f.qty);
      const rawTons = parseFirestoreValue(f.tons);
      const rawNet = parseFirestoreValue(f.netWeight);

      invoices.push({
        id: docId,
        invoiceNumber: displayNumber,
        driver,
        operator: parseFirestoreValue(f.operator) || '',
        wellName,
        hauledTo: parseFirestoreValue(f.hauledTo) || '',
        jobType: parseFirestoreValue(f.commodityType) || parseFirestoreValue(f.jobType) || '',
        totalBBL: typeof rawTotalBBL === 'number' ? rawTotalBBL : undefined,
        totalHours: parseFirestoreValue(f.totalHours) || 0,
        status,
        date: dateStr,
        createdAt,
        county: parseFirestoreValue(f.county) || '',
        companyId: invoiceCompanyId,
        bblsField: typeof rawBbls === 'number' ? rawBbls : (rawBbls != null ? parseFloat(String(rawBbls)) : null),
        qtyField: rawQty,
        qtyUnit: parseFirestoreValue(f.qtyUnit) || null,
        unit: parseFirestoreValue(f.unit) || null,
        tons: typeof rawTons === 'number' ? rawTons : null,
        netWeight: typeof rawNet === 'number' ? rawNet : null,
        allocatedHours: typeof parseFirestoreValue(f.allocatedHours) === 'number' ? parseFirestoreValue(f.allocatedHours) : null,
        observedHours: typeof parseFirestoreValue(f.observedHours) === 'number' ? parseFirestoreValue(f.observedHours) : null,
        actualDriveMinutes: typeof parseFirestoreValue(f.actualDriveMinutes) === 'number' ? parseFirestoreValue(f.actualDriveMinutes) : null,
        allocationMethod: parseFirestoreValue(f.splitTimeAllocation) || parseFirestoreValue(f.allocationMethod) || null,
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
      employeeSplit: payConfig.employeeSplit ?? payConfig.defaultSplit,
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

function lookupRate(rateSheets: Record<string, RateEntry[]>, operator: string, jobType: string): RateEntry | null {
  const resolved = resolveFinancialRate(rateSheets, operator, jobType);
  if (resolved.state === 'resolved' || resolved.state === 'explicit_zero') {
    return resolved.entry as RateEntry;
  }
  return null;
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
          location: parseFirestoreValue(f.wellName) || parseFirestoreValue(f.location) || '',
          hauledTo: parseFirestoreValue(f.hauledTo) || parseFirestoreValue(f.disposal) || '',
          type: parseFirestoreValue(f.type) || '',
          qty: parseFirestoreValue(f.bbls) || parseFirestoreValue(f.qty) || '',
          date: parseFirestoreValue(f.date) || '',
          timeGauged: parseFirestoreValue(f.timeGauged) || '',
          company: parseFirestoreValue(f.operator) || parseFirestoreValue(f.company) || '',
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
  const splitResolved = resolveEmployeeSplit(payConfig?.employeeSplit ?? payConfig?.defaultSplit);
  const rateSheets = payConfig?.rateSheets || {};
  const frostZones = payConfig?.frostZones;
  const splitForProject = splitResolved.state === 'unresolved' ? undefined : splitResolved.split;

  const rows: TimesheetRow[] = invoices.map(inv => {
    const observedHours = inv.observedHours
      ?? (typeof inv.actualDriveMinutes === 'number' ? inv.actualDriveMinutes / 60 : undefined);
    const line = projectFinancialLine({
      status: inv.status,
      operator: inv.operator,
      jobType: inv.jobType,
      quantity: {
        totalBBL: inv.totalBBL,
        bbls: inv.bblsField ?? undefined,
        qty: inv.qtyField ?? undefined,
        qtyUnit: inv.qtyUnit,
        unit: inv.unit,
        tons: inv.tons ?? undefined,
        netWeight: inv.netWeight ?? undefined,
      },
      time: {
        totalHours: inv.totalHours,
        allocatedHours: inv.allocatedHours ?? undefined,
        observedHours,
        allocationMethod: inv.allocationMethod,
      },
      rateSheets,
      defaultSplit: splitForProject,
    });

    let rate = 0;
    let rateMethod = 'per_bbl';
    let gross = line.amountBilled ?? 0;
    let employeePay = line.employeeTake ?? 0;
    if (line.rate.state === 'resolved' || line.rate.state === 'explicit_zero') {
      rateMethod = line.rate.entry.method;
      const county = inv.county
        || wellCountyMap?.get(inv.wellName?.toLowerCase() || '')
        || '';
      rate = getEffectiveRate(
        line.rate.entry as RateEntry,
        inv.date || inv.createdAt,
        county,
        frostZones,
        line.qtyForBblColumn ?? undefined,
      );
      if (line.amountBilled !== null && line.rate.entry.method === 'per_bbl' && line.qtyForBblColumn != null && rate !== line.rate.entry.rate) {
        gross = Math.round(line.qtyForBblColumn * rate * 100) / 100;
        if (splitResolved.state !== 'unresolved') {
          employeePay = Math.round(gross * splitResolved.split * 100) / 100;
        }
      } else {
        rate = line.rate.entry.rate;
      }
    }

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

    const payable = line.eligible.eligible && line.amountBilled !== null;
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      date: displayDate,
      operator: inv.operator,
      jobType: inv.jobType,
      bbls: line.qtyForBblColumn ?? 0,
      hours: line.hoursForMoney ?? 0,
      rate: payable ? rate : 0,
      rateMethod,
      gross: payable ? Math.round(gross * 100) / 100 : 0,
      employeePay: payable ? employeePay : 0,
      status: inv.status,
      qtyUnit: line.quantity.state === 'unresolved' ? null : line.quantity.unit,
      qtyValue: line.quantity.state === 'unresolved' ? null : line.quantity.value,
      qtyDisplay: quantityDisplay(line.quantity),
      qtyState: line.quantity.state,
      observedHours: line.time.observedHours,
      allocatedHours: line.time.allocatedHours,
      hoursProvenance: line.time.label,
      hoursDisplay: hoursDisplay(line.time),
      amountUnresolved: payable ? null : (line.amountReason || `ineligible:${line.eligible.reason}`),
      payable,
    };
  });

  const payableRows = rows.filter(r => r.payable);
  return {
    rows,
    totalLoads: payableRows.length,
    totalBBLs: payableRows.reduce((s, r) => s + (r.qtyUnit === 'bbl' && r.qtyValue != null ? r.qtyValue : 0), 0),
    totalTons: payableRows.reduce((s, r) => s + (r.qtyUnit === 'ton' && r.qtyValue != null ? r.qtyValue : 0), 0),
    unresolvedCount: rows.filter(r => r.amountUnresolved).length,
    totalHours: Math.round(payableRows.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    totalGross: Math.round(payableRows.reduce((s, r) => s + r.gross, 0) * 100) / 100,
    totalPay: Math.round(payableRows.reduce((s, r) => s + r.employeePay, 0) * 100) / 100,
    periodLabel,
    periodStart: formatShortDate(periodStart),
    periodEnd: formatShortDate(periodEnd),
  };
}
