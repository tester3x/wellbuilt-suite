import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDaySummary, fetchCompletedLoads } from './daySummary';

const row = (id: string, bbl: number, group?: string, sequence?: number) => ({
  id, wellName: id, hauledTo: 'Destination', operator: 'Test', totalBBL: bbl,
  totalHours: 1, status: 'closed', timeline: [], createdAt: '2026-10-21T12:00:00Z',
  dispatchSplitGroupId: group, dispatchSplitSequence: sequence,
});

test('split cargo counts once, source wins in either query order; multi-haul quantities remain distinct', () => {
  const a = row('source', 140, 'split-test', 1);
  const b = row('destination', 140, 'split-test', 2);
  const multi = [{...row('multi-a', 70), haulGroupId: 'multi'}, {...row('multi-b', 70), haulGroupId: 'multi'}];
  for (const pair of [[a, b], [b, a]]) {
    const result = calculateDaySummary([...pair, ...multi], []);
    assert.equal(result.totalLoads, 3);
    assert.equal(result.totalBBL, 280);
    assert.deepEqual(result.wellStats.find(w => w.name === 'source'), {name: 'source', bbls: 140, loads: 1});
    assert.equal(result.wellStats.some(w => w.name === 'destination'), false);
  }
});

test('different split families stay separate and a lone completed B still represents delivered cargo', () => {
  const result = calculateDaySummary([row('b', 100, 'one', 2), row('a2', 140, 'two', 1), row('b2', 140, 'two', 2)], []);
  assert.equal(result.totalLoads, 2);
  assert.equal(result.totalBBL, 240);
});

test('both split legs still contribute activity time', () => {
  const event = (type: string, timestamp: string) => ({type, timestamp, lat: null, lng: null});
  const a = {...row('a', 140, 's', 1), timeline: [event('arrive','2026-10-21T12:00:00Z'),event('depart_site','2026-10-21T12:15:00Z')]};
  const b = {...row('b', 140, 's', 2), timeline: [event('arrive','2026-10-21T12:45:00Z'),event('close','2026-10-21T13:00:00Z')]};
  const result = calculateDaySummary([a,b], []);
  assert.equal(result.pickupMinutes, 15);
  assert.equal(result.dropoffMinutes, 15);
  assert.equal(result.driveMinutes, 30);
});

test('REST projection preserves split identity before the calculation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => ({ok: true, json: async () => ['a','b'].map((id,index) => ({document: {
    name: 'projects/test/databases/(default)/documents/invoices/' + id,
    fields: {driverId:{stringValue:'driver'},companyId:{stringValue:'company'},status:{stringValue:'closed'},
      createdAt:{stringValue:'2026-10-21T12:00:00Z'},totalBBL:{integerValue:'140'},
      dispatchSplitGroupId:{stringValue:'split'},dispatchSplitSequence:{integerValue:String(index+1)}}
  }}))})) as unknown as typeof fetch;
  try {
    const result = await fetchCompletedLoads({identity:{driverId:'driver'}, companyId:'company',authHeaders:async()=>({Authorization:'Bearer test'})});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.invoices[1].dispatchSplitSequence, 2);
    assert.equal(calculateDaySummary(result.invoices, []).totalBBL, 140);
  } finally { globalThis.fetch = original; }
});
