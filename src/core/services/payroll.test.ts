import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTimesheetSummary, fetchDriverInvoices, fetchInvoiceTicketDetails, payrollRowGroup, type InvoiceDetail, type TimesheetInvoice, type TimesheetRow } from './payroll';

const start = new Date('2026-10-07T00:00:00.000Z');
const end = new Date('2026-10-08T00:00:00.000Z');
const authHeaders = async () => ({ Authorization: 'Bearer test-token' });

function field(value: string) { return { stringValue: value }; }

test('payroll reads as the signed-in driver and matches stable identity instead of name', async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInit | undefined;
  globalThis.fetch = (async (_url, init) => {
    request = init;
    return {
      ok: true,
      json: async () => [
        { document: { name: 'projects/test/databases/(default)/documents/invoices/mine', fields: {
          driver: field('Mike ZFold7 Burger'), driverId: field('driver-123'),
          companyId: field('liquid-gold'), createdAt: { timestampValue: '2026-10-07T12:00:00.000Z' },
          status: field('closed'), wellName: field('Gabriel 7'),
        } } },
        { document: { name: 'projects/test/databases/(default)/documents/invoices/other', fields: {
          driver: field('Mikezfold'), driverId: field('someone-else'),
          companyId: field('liquid-gold'), createdAt: { timestampValue: '2026-10-07T12:00:00.000Z' },
          status: field('closed'),
        } } },
      ],
    } as Response;
  }) as typeof fetch;
  try {
    const rows = await fetchDriverInvoices({ driverId: 'driver-123' }, 'liquid-gold', start, end, authHeaders);
    assert.deepEqual(rows.map(row => row.id), ['mine']);
    assert.equal((request?.headers as Record<string, string>).Authorization, 'Bearer test-token');
    const query = JSON.parse(String(request?.body));
    assert.equal(query.structuredQuery.orderBy, undefined);
    assert.ok(query.structuredQuery.where.compositeFilter.filters.some((filter: any) =>
      filter.fieldFilter.field.fieldPath === 'companyId' && filter.fieldFilter.value.stringValue === 'liquid-gold'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed payroll read is unavailable rather than zero jobs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: false, status: 403 }) as Response) as typeof fetch;
  try {
    await assert.rejects(
      fetchDriverInvoices({ driverId: 'driver-123' }, 'liquid-gold', start, end, authHeaders),
      /payroll_invoices_403/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payroll separates known nonpayable activity from unresolved calculations', () => {
  const row = (status: string, payable: boolean): TimesheetRow => ({
    invoiceId: status, invoiceNumber: status, date: '', operator: '', jobType: '',
    bbls: 0, hours: 0, rate: 0, rateMethod: 'per_bbl', gross: 0,
    employeePay: 0, status, payable,
  });
  assert.equal(payrollRowGroup(row('closed', true)), 'paid');
  assert.equal(payrollRowGroup(row('open', false)), 'in_progress');
  assert.equal(payrollRowGroup(row('cancelled', false)), 'excluded');
  assert.equal(payrollRowGroup(row('closed', false)), 'needs_review');
});

test('cancelled and open jobs do not inflate the unresolved calculation count', () => {
  const invoice = (status: string): TimesheetInvoice => ({
    id: status, invoiceNumber: status, driver: 'Driver', operator: 'Operator',
    wellName: 'Well', hauledTo: 'SWD', jobType: 'Production Water',
    totalBBL: 100, totalHours: 1, status, date: '10/07/2026', createdAt: '2026-10-07T12:00:00Z',
  });
  const summary = buildTimesheetSummary(
    [invoice('cancelled'), invoice('open'), invoice('closed')], null,
    'This Week', start, end,
  );
  assert.equal(summary.unresolvedCount, 1);
  assert.equal(summary.totalLoads, 0);
});

test('invoice detail finds the linked canonical ticket when tickets[] is empty', async () => {
  const originalFetch = globalThis.fetch;
  const invoice = { docId: 'invoice-1', companyId: 'liquid-gold', tickets: [], ticketNumber: '20621' } as unknown as InvoiceDetail;
  let queryBody: any;
  globalThis.fetch = (async (_url, init) => {
    queryBody = JSON.parse(String(init?.body));
    return { ok: true, json: async () => [
      { document: { name: 'projects/test/databases/(default)/documents/tickets/canonical-1', fields: {
        companyId: field('liquid-gold'), ticketNumber: field('20621'), invoiceDocId: field('invoice-1'),
      } } },
      { document: { name: 'projects/test/databases/(default)/documents/tickets/other-company', fields: {
        companyId: field('other'), ticketNumber: field('20621'), invoiceDocId: field('invoice-1'),
      } } },
    ] } as Response;
  }) as typeof fetch;
  try {
    const tickets = await fetchInvoiceTicketDetails(invoice, authHeaders);
    assert.deepEqual(tickets.map(ticket => ticket.ticketNumber), ['20621']);
    assert.equal(queryBody.structuredQuery.where.fieldFilter.field.fieldPath, 'invoiceDocId');
    assert.equal(queryBody.structuredQuery.where.fieldFilter.value.stringValue, 'invoice-1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invoice detail uses the explicit ticket document ID when the index has no link', async () => {
  const originalFetch = globalThis.fetch;
  const invoice = {
    docId: 'invoice-2', companyId: 'liquid-gold', tickets: [], ticketNumber: '',
    ticketSummaries: [{ ticketNumber: '20630', ticketDocId: 'ticket-doc-20630' }],
  } as unknown as InvoiceDetail;
  const urls: string[] = [];
  globalThis.fetch = (async (url) => {
    urls.push(String(url));
    if (urls.length === 1) return { ok: true, json: async () => [] } as Response;
    return { ok: true, json: async () => ({
      name: 'projects/test/databases/(default)/documents/tickets/ticket-doc-20630',
      fields: { companyId: field('liquid-gold'), ticketNumber: field('20630') },
    }) } as Response;
  }) as typeof fetch;
  try {
    const tickets = await fetchInvoiceTicketDetails(invoice, authHeaders);
    assert.deepEqual(tickets.map(ticket => ticket.ticketNumber), ['20630']);
    assert.match(urls[1], /tickets\/ticket-doc-20630/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
