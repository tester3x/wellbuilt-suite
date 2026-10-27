import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEquipmentAccessHandler,equipmentAccessRequest,isEquipmentAppTarget,equipmentAppEntryUrl,type EquipmentAccessOps} from './equipmentAppAccessCore';
const req={state:'s'.repeat(43),codeChallenge:'c'.repeat(43)};
function harness(){
 let epoch=1;const issued:string[]=[];const opened:string[]=[];
 const ops:EquipmentAccessOps={epoch:()=>epoch,local:async()=>({driverId:'driver-a',companyId:'company-a'}),reconcile:async()=> 'verified',
 identity:async()=>({uid:'uid-a',kind:'driver',driverId:'driver-a',companyId:'company-a'}),issue:async challenge=>{issued.push(challenge);return{version:1,code:'a'.repeat(43),expiresAtMs:2000};},open:async url=>{opened.push(url);},now:()=>1000};
 return{ops,issued,opened,change:()=>++epoch};
}
test('ordinary Equipment targets are identified without changing other app policies',()=>{
 assert.equal(isEquipmentAppTarget('wbequipment'),true);assert.equal(isEquipmentAppTarget('legacy','com.wellbuilt.equipment'),true);
 assert.equal(isEquipmentAppTarget('waterticket'),false);assert.equal(isEquipmentAppTarget('wellbuilt-mobile'),false);
});
test('request accepts only exact PKCE challenge and state, never identity or redirects',()=>{
 assert.deepEqual(equipmentAccessRequest(req),req);
 for(const r of [{...req,hash:'bad'},{...req,redirect:'evil://'}, {...req,state:[req.state]},{...req,codeChallenge:'short'}])assert.throws(()=>equipmentAccessRequest(r));
});
test('verified caller gets one fixed callback; repeated route deliveries do not mint or open twice',async()=>{
 const h=harness();const run=createEquipmentAccessHandler(h.ops);
 await Promise.all([run(req),run(req)]);await run(req);
 assert.equal(h.issued.length,1);assert.equal(h.opened.length,1);
 const u=new URL(h.opened[0]);assert.equal(u.protocol,'wbequipment:');assert.equal(u.hostname,'app-callback');assert.equal(u.searchParams.get('state'),req.state);
});
test('local-only, missing, or mismatched identity cannot mint access',async()=>{
 for(const mode of ['offline','missing','wrongCompany','wrongDriver','staff']){
   const h=harness();if(mode==='offline')h.ops.reconcile=async()=> 'local-only';
   if(mode==='missing')h.ops.identity=async()=>null;
   if(mode==='wrongCompany')h.ops.identity=async()=>({uid:'uid-a',kind:'driver',driverId:'driver-a',companyId:'b'});
   if(mode==='wrongDriver')h.ops.identity=async()=>({uid:'uid-a',kind:'driver',driverId:'b',companyId:'company-a'});
   if(mode==='staff')h.ops.identity=async()=>({uid:'uid-a',kind:'staff',driverId:'driver-a',companyId:'company-a'});
   await assert.rejects(createEquipmentAccessHandler(h.ops)(req));assert.equal(h.issued.length,0);assert.equal(h.opened.length,0);
 }
});
test('logout, account switch, and navigation cancellation during issuance suppress callbacks',async()=>{
 for(const mode of ['epoch','uid','cancel']){
 const h=harness();let active=true;h.ops.issue=async()=>{if(mode==='epoch')h.change();if(mode==='uid')h.ops.identity=async()=>({uid:'different',kind:'driver',driverId:'driver-a',companyId:'company-a'});if(mode==='cancel')active=false;return{version:1,code:'a'.repeat(43),expiresAtMs:2000};};
 await assert.rejects(createEquipmentAccessHandler(h.ops)(req,()=>active));assert.equal(h.opened.length,0);
 }
});
test('expired or malformed server answer never opens the destination',async()=>{
 for(const answer of [{version:1,code:'a'.repeat(43),expiresAtMs:500},{version:1,code:'invalid',expiresAtMs:2000},{version:2,code:'a'.repeat(43),expiresAtMs:2000}]){
 const h=harness();h.ops.issue=async()=>answer;await assert.rejects(createEquipmentAccessHandler(h.ops)(req));assert.equal(h.opened.length,0);
 }
});


test('Equipment routing hints identify only the requested account and contain no credential or shift action',()=>{
 const url=new URL(equipmentAppEntryUrl({driverId:'driver/a',companyId:'company-a'}));
 assert.equal(url.protocol,'wbequipment:');assert.equal(url.hostname,'app-open');
 assert.equal(url.searchParams.get('driverId'),'driver/a');
 assert.deepEqual([...url.searchParams.keys()].sort(),['companyId','driverId']);
 assert.equal(equipmentAppEntryUrl(),'wbequipment://app-open');
});

test('issuance uses the persisted SDK token without a redundant forced refresh',async()=>{
 const h=harness();const refreshes:boolean[]=[];const identity=h.ops.identity;
 h.ops.identity=async refresh=>{refreshes.push(refresh);return identity(refresh);};
 await createEquipmentAccessHandler(h.ops)(req);
 assert.deepEqual(refreshes,[false,false]);assert.equal(h.issued.length,1);
});


test('timeout is not cached: retry revalidates identity and can deliver once',async()=>{
 const h=harness();let count=0;
 h.ops.issue=async()=>{if(++count===1)throw {code:'functions/deadline-exceeded'};return {version:1,code:'a'.repeat(43),expiresAtMs:2000};};
 const run=createEquipmentAccessHandler(h.ops);
 await assert.rejects(run(req));await run(req);await run(req);
 assert.equal(count,2);assert.equal(h.opened.length,1);
});

test('cancelled stalled issuance cannot block retry or open a late callback',async()=>{
 const h=harness();let active=true;let release!:(v:unknown)=>void;let count=0;
 h.ops.issue=async()=>{if(++count===1)return new Promise(resolve=>{release=resolve;});return {version:1,code:'b'.repeat(43),expiresAtMs:2000};};
 const run=createEquipmentAccessHandler(h.ops);const old=run(req,()=>active);
 await new Promise(resolve=>setImmediate(resolve));active=false;
 await run(req);release({version:1,code:'a'.repeat(43),expiresAtMs:2000});
 await assert.rejects(old);await run(req);
 assert.equal(count,2);assert.equal(h.opened.length,1);assert(h.opened[0].includes('b'.repeat(43)));
});

test('retry after failure still rejects a changed account',async()=>{
 const h=harness();h.ops.issue=async()=>{throw {code:'functions/unavailable'};};
 const run=createEquipmentAccessHandler(h.ops);await assert.rejects(run(req));
 h.ops.identity=async()=>({uid:'other',kind:'driver',driverId:'other',companyId:'company-a'});
 await assert.rejects(run(req),/not_authorized/);assert.equal(h.opened.length,0);
});
