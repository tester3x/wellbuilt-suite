import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundStartOdometer,resolveShiftMiles,validateEtcMileageReply} from './shiftMileage';
const id={companyId:'company',driverId:'driver',suiteShiftId:'shift'};
test('old/different-shift odometers never leak into current shift',()=>{
 assert.equal(readBoundStartOdometer('77',id),'');
 assert.equal(readBoundStartOdometer(JSON.stringify({...id,reading:'124000'}),id),'124000');
 for(const changes of [{companyId:'other'},{driverId:'other'},{suiteShiftId:'yesterday'}]) assert.equal(readBoundStartOdometer(JSON.stringify({...id,...changes,reading:'77'}),id),'');
 assert.equal(readBoundStartOdometer(JSON.stringify({...id,reading:''}),id),'');
});
test('ETC trip miles never become an absolute odometer; manual override is explicit',()=>{
 assert.equal(resolveShiftMiles('','',241.4),241);
 assert.equal(resolveShiftMiles('124000','124242',241.4),242);
 assert.equal(resolveShiftMiles('','242',241.4),242);
 assert.equal(resolveShiftMiles('124000','123999',241.4),null);
 assert.equal(resolveShiftMiles('','bad',241.4),null);
 assert.equal(resolveShiftMiles('','',null),null);
 assert.equal(resolveShiftMiles('','',0),0);
});
test('ETC mileage requires an exact echoed request, bound shift, fresh numeric observation',()=>{
 const request={...id,requestId:'request',requestedAtMs:100000};
 const reply={...request,etcShiftId:'etc-shift',available:true,miles:241.4,observedAtMs:100000};
 assert.equal(validateEtcMileageReply(reply,request,100001),241.4);
 for(const changes of [{suiteShiftId:'other'},{driverId:'other'},{companyId:'other'},{requestId:'old'},{available:false},{miles:-1},{miles:'241'},{observedAtMs:1},{observedAtMs:200000}]) assert.equal(validateEtcMileageReply({...reply,...changes},request,100001),null);
});
