import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jsaDisplayReference} from './jsaDisplayReference';
import {fetchOwnedShiftJsaSummary} from './shiftJsaSummaryCore';

test('short display retains leading zeros and does not turn the date into the reference',()=>{
  assert.equal(jsaDisplayReference('JSA-20261026-103524-000042'),'000042');
  assert.equal(jsaDisplayReference('JSA-20261027-003524-000042'),'000042');
});

test('legacy opaque identities are not truncated into misleading user numbers',()=>{
  assert.equal(jsaDisplayReference('JSA-'+'a'.repeat(43)),'Pending sync');
  assert.equal(jsaDisplayReference('012345'),'012345');
});

test('rendering compact numbers leaves every canonical summary reference intact',async()=>{
  const owner={companyId:'company',driverId:'driver'},shift='2026-10-26_070000';
  const numbers=['JSA-20261026-103524-000042','JSA-20261026-150444-100001','JSA-20261026-155556-100002','JSA-20261026-164347-100003','JSA-20261026-174723-100004'];
  const raw={...owner,protocolVersion:1,shiftId:shift,status:'recorded',lifecycle:'finalized',fullReadCount:1,acknowledgementCount:4,coveredJobCount:0,jobCount:5,firstReadAt:'2026-10-26T15:35:24Z',jsaNumbers:numbers,issues:0};
  const result=await fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>({...owner,uid:'user',kind:'driver'}),call:async()=>raw});
  assert.equal(result.jsaNumbers.map(jsaDisplayReference).join(' · '),'000042 · 100001 · 100002 · 100003 · 100004');
  assert.deepEqual(result.jsaNumbers,numbers);
  assert.deepEqual(raw.jsaNumbers,numbers);
  assert.equal(result.jobCount,5);
});
