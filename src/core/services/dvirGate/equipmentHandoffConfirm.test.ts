import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setEquipmentHandoffConfirmHandler,requestEquipmentHandoffConfirm,EQUIPMENT_HANDOFF_HOST_WAIT_MS} from './equipmentHandoffConfirm';
const request={phase:'pre_trip' as const,title:'Equipment',message:'Pre-Trip'};
afterEach(()=>setEquipmentHandoffConfirmHandler(null));
test('request during host mount waits for branded driver decision',async()=>{
 const result=requestEquipmentHandoffConfirm(request);let decide!:(ok:boolean)=>void;
 setEquipmentHandoffConfirmHandler(async()=>new Promise<boolean>(r=>{decide=r;}));
 await Promise.resolve();decide(true);assert.equal(await result,true);
});
test('duplicate same-phase request shares one decision; another phase cannot overwrite it',async()=>{
 let calls=0,decide!:(ok:boolean)=>void;
 setEquipmentHandoffConfirmHandler(async()=>{calls++;return new Promise<boolean>(r=>{decide=r;});});
 const first=requestEquipmentHandoffConfirm(request),second=requestEquipmentHandoffConfirm(request);
 assert.equal(first,second);assert.equal(await requestEquipmentHandoffConfirm({...request,phase:'post_trip'}),false);
 decide(false);assert.equal(await first,false);assert.equal(calls,1);
});
test('host unmount cancels; late Continue cannot affect replacement request',async()=>{
 let decide!:(ok:boolean)=>void;
 const unregister=setEquipmentHandoffConfirmHandler(async()=>new Promise<boolean>(r=>{decide=r;}));
 const first=requestEquipmentHandoffConfirm(request);await Promise.resolve();unregister();assert.equal(await first,false);
 setEquipmentHandoffConfirmHandler(async()=>false);const next=requestEquipmentHandoffConfirm(request);decide(true);assert.equal(await next,false);
});
test('old cleanup cannot unregister the replacement host',async()=>{
 const old=setEquipmentHandoffConfirmHandler(async()=>false);
 setEquipmentHandoffConfirmHandler(async()=>true);old();assert.equal(await requestEquipmentHandoffConfirm(request),true);
});
test('missing host times out without authorizing a handoff',async()=>{
 const start=Date.now();assert.equal(await requestEquipmentHandoffConfirm(request),false);
 assert.ok(Date.now()-start>=EQUIPMENT_HANDOFF_HOST_WAIT_MS-30);
});
test('host error fails closed',async()=>{
 setEquipmentHandoffConfirmHandler(async()=>{throw Error('UI unavailable');});assert.equal(await requestEquipmentHandoffConfirm(request),false);
});
