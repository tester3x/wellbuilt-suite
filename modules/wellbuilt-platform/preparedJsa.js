'use strict';

/** Same durable protocol in Suite, Tickets and JSA. Ports make the real lifecycle
 * executable in tests. A local event and a server confirmation are distinct. */
exports.createPreparedJsaRuntime=function({store,owner,call,mint,hash,now=Date.now}){
 const same=(a,b)=>a&&b&&a.uid===b.uid&&a.companyId===b.companyId&&a.driverId===b.driverId&&a.grantId===b.grantId;
 const scope=(a,b)=>a&&b&&a.companyId===b.companyId&&a.driverId===b.driverId;
 const keyOf=v=>String(v||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 const failure=message=>Object.assign(Error(message),{code:'jsa/offline-not-ready'});
 async function current(){const o=await owner();if(!o)throw failure('Sign in to WellBuilt before opening this job.');return o;}
 async function check(o){if(!same(o,await owner()))throw failure('Account changed. Reopen this job.');}
 async function read(key,o,verify=true){const raw=await store.read(key);if(verify)await check(o);if(!raw)return null;const row=JSON.parse(raw);return scope(row,o)?row:null;}
 async function write(key,value,o){await check(o);await store.write(key,JSON.stringify({...value,companyId:o.companyId,driverId:o.driverId}));await check(o);}
 async function rows(prefix,o,period){const keys=(await store.keys()).filter(k=>k.startsWith(prefix+'/'+(period?period+'_':'')));const out=[];for(let i=0;i<keys.length;i+=8){const page=await Promise.all(keys.slice(i,i+8).map(k=>read(k,o,false)));out.push(...page.filter(Boolean));}await check(o);return out;}
 async function preload(options={}){
  if(options.reuseMs)try{const {g}=await bundle();if((!options.shiftId||g.shiftId===options.shiftId)&&now()-g.issuedAtMs<options.reuseMs)return g;}catch{}
  const o=await current(),reply=await call({version:1,operation:'prepare'});await check(o);
  const g=reply?.grant;
  if(reply?.version!==1||g?.version!==1||!scope(g,o)||!/^[a-f0-9]{64}$/.test(g.id)||!g.shiftId||!g.binding?.jsaPeriodId
   ||!['off','per_shift','per_job'].includes(g.mode)||!Array.isArray(g.operators)||!g.operators.length||!Array.isArray(g.assessments)||g.mode!=='off'&&!g.assessments.length)throw failure('Shift JSA preparation could not be verified.');
  await write('bundle/'+g.id,{...g,accountGrantId:o.grantId},o);
  await write('head/'+g.issuedAtMs+'_'+g.id,{id:g.id,accountGrantId:o.grantId},o);
  return g;
 }
 async function bundle(operator){
  const o=await current(),heads=(await store.keys()).filter(k=>k.startsWith('head/')).sort((a,b)=>Number(b.split('/')[1].split('_')[0])-Number(a.split('/')[1].split('_')[0]));
  let g=null;
  for(const key of heads){const head=await read(key,o,false);if(head?.accountGrantId===o.grantId){g=await read('bundle/'+head.id,o,false);break;}}
  await check(o);
  if(g&&(g.issuedAtMs>now()+120000||g.expiresAtMs<now()))g=null;
  if(!g)throw failure('This shift is not prepared for offline jobs yet. Connect once to finish shift preparation.');
  if(await read('ended/'+g.binding.jsaPeriodId,o))throw failure('This shift has ended. Start your next shift before creating a job.');
  if(operator&&!g.operators.some(x=>keyOf(x)===keyOf(operator)))throw failure('This operator was not included in shift preparation. Connect to refresh the operator list.');
  return {o,g};
 }
 async function qualifyingRead(g,o){
  if(g.fullReadId)return g.fullReadId;
  const reads=(await rows('event',o,g.binding.jsaPeriodId)).filter(e=>e.kind==='read'
   &&g.assessments.some(a=>a.contentHash===e.assessmentHash)).sort((a,b)=>a.occurredAtMs-b.occurredAtMs);
  return reads[0]?.id||null;
 }
 async function inspect(jobRef,operator){
  const {o,g}=await bundle(operator),previous=await proof(jobRef),mine=previous?.grant.binding.jsaPeriodId===g.binding.jsaPeriodId?previous.event:null;
  const fullReadId=await qualifyingRead(g,o);
  return {grant:g,fullReadId,event:mine||null,decision:g.mode==='off'?'off':mine?'satisfied':!fullReadId?'read':g.mode==='per_shift'?'satisfied':g.allowAcknowledge?'acknowledge':'read'};
 }
 const recording=new Map();
 async function record(jobRef,operator,kind,details={},frozenGrantId){
  const key=jobRef;if(recording.has(key))return recording.get(key);
  const run=recordOnce(jobRef,operator,kind,details,frozenGrantId);recording.set(key,run);try{return await run;}finally{recording.delete(key);}
 }
 async function recordOnce(jobRef,operator,kind,details={},frozenGrantId){
  if(!/^[A-Za-z0-9._-]{1,128}$/.test(jobRef)||typeof operator!=='string'||!['read','acknowledged','scope_read','off'].includes(kind))throw failure('Job identity could not be verified.');
  const active=await bundle(operator),o=active.o,g=frozenGrantId?await read('bundle/'+frozenGrantId,o):active.g;
  if(!g||g.accountGrantId!==o.grantId||g.binding.jsaPeriodId!==active.g.binding.jsaPeriodId||g.expiresAtMs<now())throw failure('The prepared JSA scope changed. Reopen this job.');
  const previous=await proof(jobRef);if(previous){if(previous.grant.binding.jsaPeriodId!==g.binding.jsaPeriodId)throw failure('This job belongs to another shift.');return previous.event;}
  const fullReadId=await qualifyingRead(g,o);
  if(kind==='off'&&g.mode!=='off'||kind==='acknowledged'&&(g.mode!=='per_job'||!g.allowAcknowledge||!fullReadId)
   ||kind==='scope_read'&&(g.mode!=='per_shift'||!fullReadId)||kind==='read'&&g.mode==='off')throw failure('Complete the required JSA before starting this job.');
  const e={version:1,id:await mint(),grantId:g.id,jobRef,operator,occurredAtMs:now(),kind,...(kind==='read'?details:kind==='off'?{}:{fullReadId})};
  if(kind==='read'){
   const a=g.assessments.find(a=>a.contentHash===e.assessmentHash),s=e.snapshot;
   if(!a||!s||!s.printedName?.trim()||s.signature?.mimeType!=='image/png'||typeof s.signature.data!=='string'||!s.signature.data.startsWith('iVBORw0KGgo')||s.signature.data.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(s.signature.data)||s.signature.data.length>174764||!s.stepsAcknowledged||a.steps.some(x=>s.stepAcks?.[x.id]!==true)||a.preparedItems.some(x=>s.prepared?.[x.id]!==true)||(a.ppeItems||[]).some(x=>x.required===true&&s.ppeSelected?.[x.id]!==true))throw failure('Read and confirm every required item, and sign this JSA.');
  }
  await check(o);
  const routed=value=>JSON.stringify({...value,companyId:o.companyId,driverId:o.driverId});
  await store.writeBatch([{key:'event/'+g.binding.jsaPeriodId+'_'+e.id,value:routed(e)},{key:'proof/'+jobRef,value:routed({eventId:e.id,grantId:g.id})}]);
  await check(o);return e;
 }
 async function eventById(id,o){const key=(await store.keys()).find(k=>k.startsWith('event/')&&k.endsWith('_'+id));return key?read(key,o):null;}
 async function proof(jobRef){
  const o=await current(),index=await read('proof/'+jobRef,o);if(!index)return null;
  const [event,grant]=await Promise.all([eventById(index.eventId,o),read('bundle/'+index.grantId,o)]);
  if(!event||!grant||event.jobRef!==jobRef||event.grantId!==grant.id)return null;
  return {event,grant};
 }
 async function commitEvent(id){
  const o=await current(),saved=await eventById(id,o);if(!saved)throw failure('The saved JSA update is missing.');
  // Stored routing fields are not part of the immutable wire event.
  const {companyId,driverId,...e}=saved,eventHash=await hash(e),prior=await read('receipt/'+id,o);
  if(prior){if(prior.eventHash!==eventHash)throw failure('Saved JSA confirmation does not match.');return prior;}
  const r=await call({version:1,operation:'commit',event:e});await check(o);
  if(r?.version!==1||r.state!=='confirmed'||r.eventId!==id||r.eventHash!==eventHash||typeof r.recordId!=='string')throw failure('JSA delivery has not been confirmed. It remains saved on this phone.');
  await write('receipt/'+id,r,o);return r;
 }
 let draining=null;
 async function drain(){
  if(draining)return draining;
  draining=(async()=>{const o=await current(),events=await rows('event',o);const outcomes=[];
   // Full reads precede dependent acknowledgments across jobs. A refusal retains
   // that event and cannot turn into a successful local receipt.
   events.sort((a,b)=>(a.kind==='read'?0:1)-(b.kind==='read'?0:1)||a.occurredAtMs-b.occurredAtMs||a.id.localeCompare(b.id));
   for(const e of events){try{await commitEvent(e.id);outcomes.push({id:e.id,confirmed:true});}catch(error){outcomes.push({id:e.id,confirmed:false,code:error?.code||'unconfirmed'});}}
   return outcomes;
  })().finally(()=>{draining=null;});return draining;
 }
 async function endShift(shiftId){const o=await current(),all=await rows('bundle',o);for(const g of all.filter(g=>g.shiftId===shiftId))if(!await read('ended/'+g.binding.jsaPeriodId,o))await write('ended/'+g.binding.jsaPeriodId,{shiftId,at:now()},o);}
 return {preload,bundle,inspect,record,proof,commitEvent,drain,endShift,
  async request(job){const {o,g}=await bundle(job.operator);const id=await mint();await write('request/'+id,{id,grantId:g.id,job,at:now()},o);return id;},
  async readRequest(id){const o=await current(),r=await read('request/'+id,o);if(!r)return null;const {g}=await bundle(r.job.operator);const original=await read('bundle/'+r.grantId,o);return original?.accountGrantId===o.grantId&&original.binding.jsaPeriodId===g.binding.jsaPeriodId&&original.expiresAtMs>=now()?{...r,grant:original}:null;},
  async readEvent(id){return eventById(id,await current());},
 };
};

/** Android's signature-pinned peer providers share protected local records.
 * Firebase SDK still supplies authentication for every server request. */
exports.createNativePreparedJsa=function({user,call}){
 const native=require('./index'),Crypto=require('expo-crypto');
 return exports.createPreparedJsaRuntime({
  store:{keys:()=>native.jsaKeys(),read:k=>native.jsaRead(k),write:(k,v)=>native.jsaWrite(k,v),writeBatch:items=>native.jsaWriteBatch(JSON.stringify(items))},call,
  owner:async()=>{const u=user();if(!u)return null;const row=JSON.parse(await native.readAccount()||'null');
   const a=row?.access,o=a?.owner;return !row?.revoked&&a?.version===1&&o?.uid===u.uid?{...o,grantId:a.grantId}:null;},
  mint:async()=>{const b=await Crypto.getRandomBytesAsync(32);let out='',bits=0,n=0;const abc='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';for(const x of b){n=(n<<8)|x;bits+=8;while(bits>=6){bits-=6;out+=abc[(n>>>bits)&63];}}if(bits)out+=abc[(n<<(6-bits))&63];return out;},
  hash:e=>Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify(e)),
 });
};
