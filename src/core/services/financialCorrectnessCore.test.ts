/**
 * Financial correctness: characterization of pre-fix WB-S behavior, then golden v1.
 * Run: tsx --test src/core/services/financialCorrectnessCore.test.ts
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  FINANCIAL_CORRECTNESS_CONTRACT_VERSION,
  hoursColumnHeader,
  hoursDisplay,
  isFinanciallyEligibleStatus,
  mixedQuantitySummary,
  moneyDisplay,
  projectFinancialLine,
  quantityColumnHeader,
  quantityDisplay,
  resolveEmployeeSplit,
  resolveFinancialQuantity,
  resolveFinancialRate,
  resolveFinancialTime,
  type CompanyRateSheets,
  type FinancialRateEntry,
} from './financialCorrectnessCore';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, 'financialGoldenFixtures.v1.json');
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));

function legacyWbsLookupRate(
  rateSheets: Record<string, FinancialRateEntry[]>,
  operator: string,
  jobType: string,
): FinancialRateEntry | null {
  const operatorKey = Object.keys(rateSheets).find(k => k.toLowerCase() === operator.toLowerCase());
  const rateSheet = operatorKey ? rateSheets[operatorKey] : null;
  if (!rateSheet || !rateSheet.length) return null;
  const direct = rateSheet.find(r => r.jobType.toLowerCase() === jobType.toLowerCase());
  if (direct) return direct;
  return rateSheet[0] || null;
}

function legacyWbsQty(totalBBL: number, bbls?: string, qty?: string): number {
  let n = totalBBL || 0;
  if (!n) n = parseFloat(bbls || '0') || parseFloat(qty || '0') || 0;
  return n;
}

test('characterization: WB-S lookupRate guesses the first operator rate on no match', () => {
  const sheet: Record<string, FinancialRateEntry[]> = {
    Acme: [
      { jobType: 'Service Work', method: 'hourly', rate: 150 },
      { jobType: 'Production Water', method: 'per_bbl', rate: 2.4 },
    ],
  };
  assert.equal(legacyWbsLookupRate(sheet, 'Acme', 'Skim Oil')!.rate, 150);
  const reordered = { Acme: [...sheet.Acme].reverse() };
  assert.equal(legacyWbsLookupRate(reordered, 'Acme', 'Skim Oil')!.rate, 2.4);
});

test('characterization: WB-S qty treats untyped qty as BBL', () => {
  assert.equal(legacyWbsQty(0, undefined, '40'), 40);
  assert.equal(legacyWbsQty(185), 185);
});

test('characterization: WB-S default split invented 0.25 when missing', () => {
  const missingSplit: number | undefined = undefined;
  const invented = missingSplit ?? 0.25;
  assert.equal(invented, 0.25);
});

test('contract version is 1.0.0', () => {
  assert.equal(FINANCIAL_CORRECTNESS_CONTRACT_VERSION, '1.0.0');
  assert.equal(fixtures.contractVersion, '1.0.0');
});

test('golden statuses: only closed/completed/submitted/approved/paid are eligible', () => {
  for (const row of fixtures.statuses) {
    const got = isFinanciallyEligibleStatus(row.status);
    assert.equal(got.eligible, row.expectEligible, row.id);
  }
});

function sheetOf(name: string): CompanyRateSheets {
  if (name === 'empty') return {};
  return fixtures[name] as CompanyRateSheets;
}

test('golden rates: exact, no-match, empty, reorder, zero, ambiguous', () => {
  for (const row of fixtures.rateCases) {
    const got = resolveFinancialRate(sheetOf(row.sheet), row.operator, row.jobType);
    assert.equal(got.state, row.expectState, row.id);
    if (row.expectReason) {
      assert.equal((got as { reason?: string }).reason, row.expectReason, row.id);
    }
    if (row.expectRate !== undefined && (got.state === 'resolved' || got.state === 'explicit_zero')) {
      assert.equal(got.entry.rate, row.expectRate, row.id);
    }
  }
});

test('Dashboard and WB-S resolve the same golden rate fixtures identically', () => {
  const a = resolveFinancialRate(fixtures.rateSheet, 'Acme', 'Production Water');
  const b = resolveFinancialRate(fixtures.rateSheetReordered, 'Acme', 'Production Water');
  assert.equal(a.state, 'resolved');
  assert.equal(b.state, 'resolved');
  if (a.state === 'resolved' && b.state === 'resolved') assert.equal(a.entry.rate, b.entry.rate);
});

test('golden splits', () => {
  for (const row of fixtures.splitCases) {
    const got = resolveEmployeeSplit(row.raw);
    assert.equal(got.state, row.expectState, row.id);
  }
});

test('golden quantities', () => {
  for (const row of fixtures.quantityCases) {
    const got = resolveFinancialQuantity(row.facts);
    assert.equal(got.state, row.expectState, row.id);
  }
});

test('tons are never labeled or priced as BBL', () => {
  const q = resolveFinancialQuantity({ tons: 22.5 });
  assert.equal(quantityDisplay(q), '22.5 ton');
  assert.equal(quantityDisplay(q).includes('BBL'), false);
  assert.equal(quantityColumnHeader('ton'), 'Tons');
  const line = projectFinancialLine({
    status: 'closed',
    operator: 'Acme',
    jobType: 'Production Water',
    quantity: { tons: 22.5 },
    time: {},
    rateSheets: fixtures.rateSheet,
    defaultSplit: 0.25,
  });
  assert.equal(line.amountBilled, null);
  assert.equal(line.qtyForBblColumn, null);
});

test('golden time provenance', () => {
  for (const row of fixtures.timeCases) {
    const got = resolveFinancialTime(row.facts);
    assert.equal(got.provenance, row.expectProvenance, row.id);
    assert.equal(got.observedHours, row.expectObserved, row.id);
  }
  const split = resolveFinancialTime({ observedHours: 10, allocatedHours: 5, allocationMethod: 'equal' });
  assert.equal(hoursDisplay(split), '5 allocated (equal) · 10 observed');
  assert.equal(hoursColumnHeader('allocated'), 'Allocated hours');
});

test('ineligible statuses never produce billed amount', () => {
  for (const status of ['open', 'in_progress', 'in-progress', 'paused', 'cancelled', 'void', 'transferred', 'transfer_pending', null, 'mystery']) {
    const line = projectFinancialLine({
      status,
      operator: 'Acme',
      jobType: 'Production Water',
      quantity: { totalBBL: 100 },
      time: { totalHours: 2 },
      rateSheets: fixtures.rateSheet,
      defaultSplit: 0.25,
    });
    assert.equal(line.eligible.eligible, false, String(status));
    assert.equal(line.amountBilled, null, String(status));
  }
});

test('post-close invoice workflow states remain eligible and bill', () => {
  for (const status of ['closed', 'completed', 'submitted', 'approved', 'paid']) {
    const line = projectFinancialLine({
      status,
      operator: 'Acme',
      jobType: 'Production Water',
      quantity: { totalBBL: 100 },
      time: { totalHours: 2 },
      rateSheets: fixtures.rateSheet,
      defaultSplit: 0.25,
    });
    assert.equal(line.eligible.eligible, true, String(status));
    assert.equal(line.amountBilled, 240, String(status));
  }
});

test('report helpers never put tons under a BBL heading', () => {
  assert.equal(quantityColumnHeader('ton'), 'Tons');
  assert.equal(mixedQuantitySummary(100, 12), '100 BBL / 12 ton');
});

test('unresolved money is not silent zero', () => {
  const missing = projectFinancialLine({
    status: 'closed',
    operator: 'Acme',
    jobType: 'Skim Oil',
    quantity: { totalBBL: 100 },
    time: {},
    rateSheets: fixtures.rateSheet,
    defaultSplit: 0.25,
  });
  assert.equal(missing.amountBilled, null);
  assert.equal(moneyDisplay(missing.amountBilled, missing.amountReason).startsWith('UNRESOLVED'), true);
});
