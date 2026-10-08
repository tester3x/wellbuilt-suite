import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchDriverInvoices } from './payroll';

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
