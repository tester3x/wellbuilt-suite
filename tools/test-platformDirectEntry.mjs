import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
const calls=[];const fail=()=>{throw Error('General entry must not await a server, frame or legacy SSO overlay');};
const owner={driverId:'fixture-driver',companyId:'fixture-company'};
const modules={'../../../modules/wellbuilt-platform/appAccess':{useAppAccess:()=>()=>true},react:{useCallback:f=>f,useMemo:f=>f()},'../services/platformRuntime.generated':{PLATFORM_APP_OPEN_HOST:'app-open'},
 '../services/equipmentAppAccessCore':{isEquipmentAppTarget:s=>s==='wbequipment'},
 '../services/appLauncher':{canLaunchApp:()=>true,launchWBApp:async options=>calls.push(options)},
 '../context/AuthContext':{useAuth:()=>({user:owner,shiftActive:false})},
 '../services/driverProfile':{loadVehicleInfo:fail},'../services/shiftTracking':{getCurrentShiftId:fail},
 '../services/dvirGate':{createSuiteDvirGate:()=>({})},'../services/ssoLaunchPolicy':{isCredentialFreeLaunchTarget:s=>['wellbuilt-tickets','wellbuilt-mobile'].includes(s)},
};
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/core/hooks/useAppLauncher.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:m.exports,module:m,require:n=>{assert.ok(modules[n],n);return modules[n];},requestAnimationFrame:fail});
const launch=m.exports.useAppLauncher().launchWBApp;
for(const scheme of ['wellbuilt-tickets','wellbuilt-mobile','wbequipment','jsaapp','wellbuilttimecard','tickettime']){await launch({scheme,name:'Fixture'});const last=calls.at(-1);assert.equal(last.startHost,'app-open');assert.equal(last.sso,undefined);assert.equal(JSON.stringify(last.entryOwner),JSON.stringify(owner));}
console.log('All six destinations launch off shift without a remote lookup, credential URI or legacy overlay.');
