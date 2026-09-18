/**
 * WB-S consumer-level financial tests: payroll timesheet summary and labels.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildTimesheetSummary, formatTimesheetMoney, type PayConfig, type TimesheetInvoice } from './payroll';
import {
  moneyContribution,
  moneyDisplay,
  projectFinancialLine,
  selectConfiguredSplit,
} from './financialCorrectnessCore';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = JSON.parse(readFileSync(join(here, 'financialGoldenFixtures.v1.json'), 'utf8'));

function invoice(over: Partial<TimesheetInvoice> = {}): TimesheetInvoice {
  return {
    id: 'id1',
    invoiceNumber: 'INV-1',
    driver: 'Driver A',
    operator: 'Acme',
    wellName: 'Well One',
    hauledTo: 'SWD',
    jobType: 'Production Water',
    totalBBL: 100,
    totalHours: 2,
    status: 'closed',
    date: '09/17/2026',
    createdAt: '2026-09-17T00:00:00.000Z',
    ...over,
  };
}

function pay(over: Partial<PayConfig> = {}): PayConfig {
  return {
    defaultSplit: 0.25,
    rateSheets: fixtures.rateSheet,
    ...over,
  };
}

const period = { label: 'This week', start: new Date('2026-09-14'), end: new Date('2026-09-20') };

test('buildTimesheetSummary: reordered sheets match; duplicates unresolved', () => {
  const a = buildTimesheetSummary([invoice()], pay(), period.label, period.start, period.end);
  const b = buildTimesheetSummary([invoice()], pay({ rateSheets: fixtures.rateSheetReordered }), period.label, period.start, period.end);
  assert.equal(a.rows[0].gross, 240);
  assert.equal(b.rows[0].gross, 240);
  const dup = buildTimesheetSummary([invoice()], pay({ rateSheets: fixtures.rateSheetDuplicate }), period.label, period.start, period.end);
  assert.ok(dup.rows[0].amountUnresolved);
  assert.match(formatTimesheetMoney(dup.rows[0].gross, dup.rows[0].amountUnresolved), /^UNRESOLVED \(/);
});

test('duplicate alias matches are unresolved', () => {
  const aliasDup = {
    Acme: [
      { jobType: 'Production Water', method: 'per_bbl' as const, rate: 2.4 },
      { jobType: 'Production %', method: 'per_bbl' as const, rate: 9.9 },
    ],
  };
  const s = buildTimesheetSummary(
    [invoice({ jobType: 'PRODUCTION WATER' })],
    pay({ rateSheets: aliasDup }),
    period.label, period.start, period.end,
  );
  assert.ok(s.rows[0].amountUnresolved);
  assert.match(String(s.rows[0].amountUnresolved), /ambiguous/);
  assert.match(formatTimesheetMoney(s.rows[0].employeePay, s.rows[0].amountUnresolved), /^UNRESOLVED \(/);
});

test('unknown and transferred statuses are not payable', () => {
  for (const status of ['open', 'in_progress', 'transferred', 'transfer_pending', 'mystery']) {
    const s = buildTimesheetSummary([invoice({ status })], pay(), period.label, period.start, period.end);
    assert.equal(s.rows[0].payable, false);
    assert.equal(s.totalPay, 0);
    assert.match(formatTimesheetMoney(s.rows[0].employeePay, s.rows[0].amountUnresolved), /^UNRESOLVED \(/);
  }
  const paid = buildTimesheetSummary([invoice({ status: 'paid' })], pay(), period.label, period.start, period.end);
  assert.equal(paid.rows[0].payable, true);
  assert.equal(paid.totalPay, 60);
});

test('explicit zero rate/split vs missing/malformed split', () => {
  const zeroRate = buildTimesheetSummary([invoice()], pay({ rateSheets: fixtures.rateSheetZero }), period.label, period.start, period.end);
  assert.equal(zeroRate.rows[0].gross, 0);
  assert.equal(zeroRate.rows[0].amountUnresolved, null);
  const zeroSplit = buildTimesheetSummary([invoice()], pay({ employeeSplit: 0, defaultSplit: 0.25 }), period.label, period.start, period.end);
  assert.equal(zeroSplit.rows[0].employeePay, 0);
  assert.equal(zeroSplit.rows[0].amountUnresolved, null);
  const missing = buildTimesheetSummary([invoice()], { rateSheets: fixtures.rateSheet }, period.label, period.start, period.end);
  assert.ok(missing.rows[0].amountUnresolved);
  assert.match(formatTimesheetMoney(missing.rows[0].employeePay, missing.rows[0].amountUnresolved), /^UNRESOLVED \(/);
  const malformed = buildTimesheetSummary(
    [invoice()],
    { employeeSplit: 'bad' as unknown as number, defaultSplit: 0.25, rateSheets: fixtures.rateSheet },
    period.label, period.start, period.end,
  );
  assert.ok(malformed.rows[0].amountUnresolved);
  assert.match(formatTimesheetMoney(malformed.rows[0].employeePay, malformed.rows[0].amountUnresolved), /^UNRESOLVED \(/);
  assert.equal(selectConfiguredSplit({ employeeSplit: 0, defaultSplit: 0.25 }), 0);
  assert.equal(selectConfiguredSplit({ employeeSplit: 'bad', defaultSplit: 0.25 }), 'bad');
});

test('typed BBL, tons, zero, untyped qty, mixed units, ton vs per-bbl', () => {
  const bbl = buildTimesheetSummary([invoice({ totalBBL: 40 })], pay(), period.label, period.start, period.end);
  assert.equal(bbl.rows[0].qtyUnit, 'bbl');
  const tons = buildTimesheetSummary([invoice({ totalBBL: undefined, tons: 22.5 })], pay(), period.label, period.start, period.end);
  assert.equal(tons.rows[0].qtyUnit, 'ton');
  assert.ok(tons.rows[0].amountUnresolved);
  assert.match(String(tons.rows[0].qtyDisplay), /ton/);
  assert.doesNotMatch(String(tons.rows[0].qtyDisplay), /BBL/);
  const zero = buildTimesheetSummary([invoice({ totalBBL: 0 })], pay(), period.label, period.start, period.end);
  assert.equal(zero.rows[0].qtyValue, 0);
  const untyped = buildTimesheetSummary([invoice({ totalBBL: undefined, qtyField: 40 })], pay(), period.label, period.start, period.end);
  assert.ok(untyped.rows[0].amountUnresolved);
  const mixed = buildTimesheetSummary([invoice({ totalBBL: 100, tons: 12 })], pay(), period.label, period.start, period.end);
  assert.ok(mixed.rows[0].amountUnresolved);
});

test('allocated hours remain distinct from observed 10; legacy totalHours labeled', () => {
  const hourlyPay = pay({
    rateSheets: { Acme: [{ jobType: 'Service Work', method: 'hourly', rate: 150 }] },
  });
  const s = buildTimesheetSummary([invoice({
    jobType: 'Service Work',
    totalHours: 0,
    observedHours: 10,
    allocatedHours: 5,
    allocationMethod: 'equal',
  })], hourlyPay, period.label, period.start, period.end);
  assert.match(s.rows[0].hoursDisplay || '', /5 allocated/);
  assert.match(s.rows[0].hoursDisplay || '', /10 observed/);
  const legacy = buildTimesheetSummary([invoice({ totalHours: 8 })], pay(), period.label, period.start, period.end);
  assert.match(legacy.rows[0].hoursDisplay || '', /legacy/);
});

test('unresolved rows display UNRESOLVED and cannot be summed as money', () => {
  const s = buildTimesheetSummary([
    invoice(),
    invoice({ id: 'id2', invoiceNumber: 'INV-2', jobType: 'Skim Oil' }),
  ], pay(), period.label, period.start, period.end);
  const unresolved = s.rows.find(r => r.amountUnresolved);
  assert.ok(unresolved);
  assert.match(formatTimesheetMoney(unresolved.gross, unresolved.amountUnresolved), /^UNRESOLVED \(/);
  const naive = s.rows.reduce((sum, r) => sum + (r.gross ?? 0), 0);
  const guarded = s.rows.reduce((sum, r) => sum + moneyContribution(r.gross, r.amountUnresolved), 0);
  assert.equal(s.totalGross, guarded);
  assert.ok(s.unresolvedCount >= 1);
  assert.equal(naive >= guarded, true);
  assert.notEqual(formatTimesheetMoney(0, 'rate:no_match'), '0');
});

test('cross-repo identical facts match Dashboard golden projection', () => {
  const core = projectFinancialLine({
    status: 'closed',
    operator: 'Acme',
    jobType: 'Production Water',
    quantity: { totalBBL: 100 },
    time: { totalHours: 2 },
    rateSheets: fixtures.rateSheet,
    defaultSplit: selectConfiguredSplit({ defaultSplit: 0.25 }),
  });
  const summary = buildTimesheetSummary([invoice()], pay(), period.label, period.start, period.end);
  assert.equal(core.amountBilled, 240);
  assert.equal(summary.rows[0].gross, 240);
  assert.equal(core.employeeTake, 60);
  assert.equal(summary.rows[0].employeePay, 60);
  assert.equal(moneyDisplay(core.amountBilled, core.amountReason), '240');
});
