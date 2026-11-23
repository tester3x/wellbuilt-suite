const fs=require('fs'),ts=require('typescript'),vm=require('vm'),assert=require('node:assert/strict');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const user={companyId:'c',driverId:'d'},key='suiteEtcEndV1:c:d',now=Date.now();
function fixture(){const store=new Map(),calls=[],notices=[];let notice='WB S ended your shift, but ETC has not confirmed going off duty. Open ETC and check your clock.';const api={};vm.runInNewContext(compile(fs.readFileSync('src/core/services/etcStart/etcEndDispatch.ts','utf8')),{exports:api,require:n=>{
 if(n.includes('async-storage'))return{default:{getItem:async k=>store.get(k)||null,setItem:async(k,v)=>store.set(k,v)}};
 if(n==='react-native')return{AppState:{currentState:'active'}};
 if(n==='./etcProduction')return{createEtcPort:()=>({call:async(method,payload)=>{const r=JSON.parse(payload);calls.push({method,...r});return{ok:false,reason:'illegal_argument'};}})};
 if(n==='./etcStartProtocol')return{newEtcRequestId:()=> 'new-id'};
 if(n==='./etcNoticeStore')return{currentEtcNotice:()=>notice,publishEtcNotice:x=>{notice=x;notices.push(x);}};throw Error(n);
 },console,setTimeout,clearTimeout});return{store,calls,notices,api};}
const end=(id,time=now-86400000)=>({protocolVersion:1,action:'end_hos',requestId:id,companyId:'c',driverId:'d',suiteShiftId:id,requestedAtMs:time});
const confirmed={state:'completed',hos:'started',request:{protocolVersion:1,action:'start_hos',requestId:'current-start',companyId:'c',driverId:'d',suiteShiftId:'current',requestedAtMs:now-3600000}};
function callback(file,marker){const s=fs.readFileSync(file,'utf8'),a=ts.createSourceFile(file,s,99,true,4);let found;function walk(n){if(ts.isCallExpression(n)&&n.expression.getText(a)==='useEffect'&&n.arguments[0]?.getText(a).includes(marker))found=n.arguments[0].getText(a);ts.forEachChild(n,walk);}walk(a);assert(found,marker);return found;}
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setImmediate(r));};
(async()=>{
 let f=fixture(),old=end('old');f.store.set(key,JSON.stringify([old]));await f.api.retryEtcEnds(user,{confirmedCurrentStart:confirmed,isCurrent:()=>true});assert.equal(f.calls.length,0);assert.equal(f.notices.at(-1),null);assert.deepEqual(JSON.parse(f.store.get(key)),[old]);const history=JSON.parse(f.store.get(key+':historical'));assert.equal(history.old.outcome,'unconfirmed_historical');assert.equal(history.old.supersededBy,'current');
 await f.api.retryEtcEnds(user);assert.equal(f.calls.length,0,'Historical request never retries into later duty');
 f=fixture();f.store.set(key,JSON.stringify([old]));await f.api.retryEtcEnds(user,{confirmedCurrentStart:{...confirmed,hos:'unknown'},isCurrent:()=>true});assert.equal(f.calls[0].method,'getEndStatus');assert(!f.store.has(key+':historical'));
 f=fixture();const fresh=end('fresh',now);f.store.set(key,JSON.stringify([fresh]));await f.api.retryEtcEnds(user,{confirmedCurrentStart:confirmed,isCurrent:()=>true});assert.equal(f.calls[0].method,'prepareEnd');assert(!f.store.has(key+':historical'));
 f=fixture();f.store.set(key,JSON.stringify([old]));await f.api.retryEtcEnds(user,{confirmedCurrentStart:confirmed,isCurrent:()=>false});assert.equal(f.calls.length,0);assert(!f.store.has(key+':historical'));assert.equal(f.notices.length,0);
 const effect=callback('src/core/context/AuthContext.tsx','reconcileEtcOnResume');
 for(const [ui,active,expected]of [[{kind:'none'},false,null],[{kind:'open',periodId:'current'},true,'current']]){
  const args=[];const context={exports:{},user,shiftActive:active,shiftAuthorityUi:ui,authorityGenRef:{current:{current:()=>1,isCurrent:()=>true}},getCurrentShiftId:async()=>ui.kind==='open'?'current':'OLD-CLOSED',retryEtcEnds:async()=>{},AppState:{currentState:'active',addEventListener:()=>({remove(){}})},console,require:n=>n.includes('attachEtcHandoff')?{reconcileEtcOnResume:async input=>{args.push(input);return[];}}:n.includes('etcActivityGate')?{noteEtcActivityState(){},isEtcActivityVisible:()=>true}:n.includes('etcProduction')?{createEtcPort:()=>({}),productionEtcKv:()=>({}),shippedEtcIdentity:()=>({})}:(()=>{throw Error(n)})()};
  vm.runInNewContext(compile('exports.cleanup=('+effect+')();'),context);await flush();assert.equal(args[0].currentSuiteShiftId,expected);context.exports.cleanup();
 }
 const pre=callback('src/ui/shared/ActionCardRow.tsx','setPreTripCheckedFor');let resolve,listener,verified=null,checked=null;
 const ctx={exports:{},active:true,preTripKey:'current',setPreTripVerifiedFor:x=>verified=x,setPreTripCheckedFor:x=>checked=x,AppState:{addEventListener:(_n,fn)=>{listener=fn;return{remove(){}}}},require:n=>n.includes('shiftTracking')?{getCurrentShiftId:async()=>'current'}:n.includes('dvirGate')?{createSuiteDvirGate:()=>({isPreTripComplete:()=>new Promise(r=>resolve=r)})}:(()=>{throw Error(n)})()};
 vm.runInNewContext(compile('exports.cleanup=('+pre+')();'),ctx);await flush();assert.equal(checked,null,'Initial pending check is not missing');resolve(true);await flush();assert.equal(verified,'current');assert.equal(checked,'current');listener('active');await flush();assert.equal(verified,'current','Resume does not clear known signed completion');resolve(true);await flush();ctx.exports.cleanup();
 console.log('PASS expired prior end retained unconfirmed without replay, fresh/missing/current/account fences; off-shift ignores old stored ID; pre-trip checking never flashes missing and resume retains verified state.');
})().catch(e=>{console.error(e);process.exitCode=1;});
