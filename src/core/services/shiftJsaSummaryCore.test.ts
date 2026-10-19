import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchOwnedShiftJsaSummary} from './shiftJsaSummaryCore';
const owner={companyId:'c',driverId:'d'},identity={...owner,uid:'u',kind:'driver'},shift='2026-10-18_230000';
const result={...owner,protocolVersion:1,shiftId:shift,status:'recorded',lifecycle:'finalized',fullReadCount:1,acknowledgementCount:2,coveredJobCount:0,jobCount:3,firstReadAt:'2026-10-19T04:30:00Z',jsaNumbers:['JSA-1'],issues:0};
test('closed overnight shift request contains only exact scope; credentials are not projected',async()=>{
 let payload:unknown;
 const out=await fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>identity,call:async b=>{payload=b;return {...result,secret:'must not leak'};}});
 assert.deepEqual(payload,{protocolVersion:1,shiftId:shift});assert.equal(out.lifecycle,'finalized');assert.equal(out.acknowledgementCount,2);assert.ok(!JSON.stringify(out).includes('secret'));
});
test('no scope requests canonical server selection, never a date',async()=>{
 let payload:unknown;await fetchOwnedShiftJsaSummary(owner,null,{identity:async()=>identity,call:async b=>{payload=b;return result;}});assert.deepEqual(payload,{protocolVersion:1});
});
test('an account switch while the callable is pending refuses publication',async()=>{
 let current=identity;
 await assert.rejects(()=>fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>current,call:async()=>{current={...identity,uid:'another'};return result;}}),/identity_changed/);
});
test('foreign identity cannot make the call',async()=>{
 let called=false;await assert.rejects(()=>fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>({...identity,driverId:'other'}),call:async()=>{called=true;return result;}}),/identity_unavailable/);assert.equal(called,false);
});
test('malformed, cross-tenant, cross-shift and false completion responses fail explicitly',async()=>{
 for(const response of [null,{...result,companyId:'other'},{...result,driverId:'other'},{...result,shiftId:'2026-10-19_080000'}, {...result,fullReadCount:0},{...result,issues:1},{...result,jobCount:-1},{...result,firstReadAt:'invalid'}]){
  await assert.rejects(()=>fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>identity,call:async()=>response}),/response_invalid/);
 }
});
test('transport failure stays unavailable rather than becoming an empty result',async()=>{
 await assert.rejects(()=>fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>identity,call:async()=>{throw Error('offline');}}),/offline/);
});
test('partial evidence and verified absence are distinguishable',async()=>{
 const call=async(raw:unknown)=>fetchOwnedShiftJsaSummary(owner,shift,{identity:async()=>identity,call:async()=>raw});
 assert.equal((await call({...result,status:'partial',issues:1})).status,'partial');
 assert.equal((await call({...result,status:'no_evidence',fullReadCount:0,acknowledgementCount:0,jobCount:0,firstReadAt:null,jsaNumbers:[]})).status,'no_evidence');
});
