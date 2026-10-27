import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { saveReceiptIdempotent, getReceipt, type DvirReceiptKv } from './dvirReceiptStore';
import { isPostTripCompleteForShift } from './dvirGateService';
import type { PhaseCompletionReceipt } from './receiptTypes';
const old:PhaseCompletionReceipt={schemaVersion:'wb-equipment-dvir-receipt/1',version:1,receiptId:'old-receipt',shiftId:'2026-10-27_123456',inspectionId:'old-truck',phase:'post_trip',completedAt:'2026-10-27T17:00:00Z',integrity:'fixture',driverHash:'fixture-driver'};
function memory(){const rows=new Map<string,string>();const kv:DvirReceiptKv={getItem:async k=>rows.get(k)??null,setItem:async(k,v)=>{rows.set(k,v);},removeItem:async k=>{rows.delete(k);}};return {rows,kv};}
test('verified replacement receipt supersedes the old vehicle while retaining its receipt history',async()=>{
 const {rows,kv}=memory();await saveReceiptIdempotent(kv,old);
 const next={...old,receiptId:'replacement-receipt',inspectionId:'replacement-truck',completedAt:'2026-10-27T18:00:00Z'};
 assert.equal(await saveReceiptIdempotent(kv,next), 'already_exists','an unverified URI cannot replace a receipt');
 assert.equal(await saveReceiptIdempotent(kv,next,true),'created');
 assert.equal((await getReceipt(kv,old.shiftId,'post_trip'))!.inspectionId,'replacement-truck');
 assert.ok([...rows.values()].some(raw=>raw===JSON.stringify(old)));
 assert.equal(await saveReceiptIdempotent(kv,old,true),'already_exists','late old receipt cannot roll back to old truck');
 assert.equal((await getReceipt(kv,old.shiftId,'post_trip'))!.inspectionId,'replacement-truck');
});
test('current-vehicle validation prevents a cached old-truck post-trip satisfying the replacement',async()=>{
 const {kv}=memory();await saveReceiptIdempotent(kv,old);
 assert.equal(await isPostTripCompleteForShift({kv,isCurrentReceipt:async()=>false},old.shiftId),false);
 assert.equal(await isPostTripCompleteForShift({kv,isCurrentReceipt:async r=>r.inspectionId==='old-truck'},old.shiftId),true);
});
test('archive write failure preserves the old receipt and leaves replacement retryable',async()=>{
 const {kv}=memory();await saveReceiptIdempotent(kv,old);
 const next={...old,receiptId:'next',inspectionId:'new-truck',completedAt:'2026-10-27T18:00:00Z'};
 await assert.rejects(()=>saveReceiptIdempotent({...kv,setItem:async()=>{throw Error('disk error');}},next,true),/disk error/);
 assert.equal((await getReceipt(kv,old.shiftId,'post_trip'))!.receiptId,old.receiptId);
 await saveReceiptIdempotent(kv,next,true);assert.equal((await getReceipt(kv,old.shiftId,'post_trip'))!.receiptId,'next');
});
test('production verifier uses only the canonical owner and current server phase',async()=>{
 let post:unknown=null;let owner:unknown={kind:'driver',driverId:'fixture-driver',companyId:'fixture-company'};
 const calls:any[]=[];const exports:any={};
 runInNewContext(ts.transpileModule(readFileSync('src/core/services/dvirGate/currentEquipmentReceipt.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports,require:(id:string)=>id==='firebase/functions'?{getFunctions:()=>({}),httpsCallable:(_f:unknown,name:string)=>async(payload:unknown)=>{calls.push({name,payload});return {data:{protocolVersion:1,driverId:'fixture-driver',companyId:'fixture-company',shiftId:old.shiftId,postTrip:post}};}}:
   id==='../firebaseAuthBoundary'?{getOwnedVerifiedIdentity:async()=>owner}:{getFirebaseApp:()=>({}),FIREBASE_REGION:'us-central1'},
 });
 assert.equal(await exports.isCurrentEquipmentReceipt(old),false);
 post={inspectionId:old.inspectionId,completedAt:old.completedAt};assert.equal(await exports.isCurrentEquipmentReceipt(old),true);
 post={inspectionId:'replacement',completedAt:old.completedAt};assert.equal(await exports.isCurrentEquipmentReceipt(old),false);
 owner={kind:'driver',driverId:'other-driver',companyId:'fixture-company'};assert.equal(await exports.isCurrentEquipmentReceipt(old),false);
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.name==='resolveDriverDvirStatus'&&c.payload.expectedDriverId==='fixture-driver'));
});
