// Focused test: completed-load summary joins invoices by STABLE driverId,
// not by display name. Run: npx tsx --test src/core/services/daySummary.driverIdJoin.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchTodayInvoices } from './daySummary';

const DRV = '2cad521c-13ac-4b6c-b1ab-07843c6bf06f';

function stubFetch(docs: any[]) {
  const calls: any[] = [];
  (globalThis as any).fetch = async (_url: string, init?: any) => {
    calls.push(init ? JSON.parse(init.body) : null);
    return { ok: true, status: 200, json: async () => docs, text: async () => '' } as any;
  };
  return calls;
}

function invoiceDoc(id: string, driverId: string) {
  return {
    document: {
      name: `projects/wellbuilt-sync/databases/(default)/documents/invoices/${id}`,
      fields: {
        status: { stringValue: 'closed' },
        wellName: { stringValue: 'GABRIEL 5-36-25TFH' },
        totalBBL: { integerValue: '140' },
        createdAt: { timestampValue: '2026-09-24T13:30:16Z' },
        driver: { stringValue: 'Mike ZFold7 Burger' }, // canonical name (must NOT be the join key)
        driverId: { stringValue: driverId },
      },
    },
  };
}

test('query filters by driverId (not the driver display name)', async () => {
  const calls = stubFetch([invoiceDoc('INV1', DRV)]);
  await fetchTodayInvoices(DRV, 'liquid-gold');
  const body = calls[0];
  const filters = body.structuredQuery.where.compositeFilter.filters.map((f: any) => f.fieldFilter);
  const driverIdFilter = filters.find((f: any) => f.field.fieldPath === 'driverId');
  assert.ok(driverIdFilter, 'must filter by driverId');
  assert.equal(driverIdFilter.op, 'EQUAL');
  assert.equal(driverIdFilter.value.stringValue, DRV);
  // The fragile name join must be gone.
  assert.equal(filters.some((f: any) => f.field.fieldPath === 'driver'), false, 'must NOT filter by driver name');
  // Company + createdAt boundaries preserved.
  assert.ok(filters.some((f: any) => f.field.fieldPath === 'companyId'), 'company boundary kept');
  assert.equal(filters.filter((f: any) => f.field.fieldPath === 'createdAt').length, 2, 'today (start+end) boundary kept');
});

test('Z Fold: closed invoices under this driverId ARE returned', async () => {
  stubFetch([invoiceDoc('XzDNUjqP', DRV), invoiceDoc('QmgsgIrI', DRV)]);
  const invoices = await fetchTodayInvoices(DRV, 'liquid-gold');
  assert.equal(invoices.length, 2);
  assert.equal(invoices[0].totalBBL, 140);
});

test('S24 with no invoice records → zero loads (only what its invoices back)', async () => {
  stubFetch([]); // no invoices synced for this driverId
  const invoices = await fetchTodayInvoices('99ff4b35-51ab-4d45-8d54-18b3b8515c9b', 'liquid-gold');
  assert.equal(invoices.length, 0);
});
