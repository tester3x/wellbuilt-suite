/** Canonical app entry and transport policy. Pure: no Firebase, React or storage.
 * Adapters provide only SDK-owned identities and server-established access.
 * URL identity hints select a session; they can never grant access.
 * App entry is deliberately independent of shift state and connection quality.
 */
export const PLATFORM_RUNTIME_VERSION = 1 as const;
export const PLATFORM_RUNTIME_APPS = Object.freeze(['suite','tickets','mobile','jsa','equipment','etc','tickettime'] as const);
export type PlatformRuntimeApp = typeof PLATFORM_RUNTIME_APPS[number];
export interface PlatformAccount { uid: string; driverId: string; companyId: string }
export interface PlatformEntrySession { owner: PlatformAccount; establishedAccess: boolean }
export interface PlatformOwnerHint { driverId: string; companyId: string }
export const PLATFORM_APP_OPEN_HOST = 'app-open' as const;
/** Strict, noncredential app-open query; no shift, redirect or auth material. */
export function parsePlatformOwnerHint(raw:Record<string,unknown>): {ok:true;owner:PlatformOwnerHint|null}|{ok:false} {
  if(Object.keys(raw).some(k=>k!=='driverId'&&k!=='companyId'))return {ok:false};
  if(Object.keys(raw).length===0)return {ok:true,owner:null};
  const valid=(v:unknown):v is string=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=200;
  if(!valid(raw.driverId)||!valid(raw.companyId))return {ok:false};
  return {ok:true,owner:{driverId:raw.driverId,companyId:raw.companyId}};
}
export type PlatformEntryAction = 'wait_for_local_restore' | 'resume' | 'authorize' | 'access_denied';
function account(value: PlatformAccount | null | undefined): value is PlatformAccount {
  return !!value && [value.uid,value.driverId,value.companyId].every(s=>typeof s==='string' && s.trim().length>0);
}
export function samePlatformAccount(a: PlatformAccount | null | undefined,b: PlatformAccount | null | undefined): boolean {
  return account(a)&&account(b)&&a.uid===b.uid&&a.driverId===b.driverId&&a.companyId===b.companyId;
}
export function decidePlatformAppEntry(input: {
  restored: boolean; session: PlatformEntrySession | null; sdkUid: string | null;
  requestedOwner?: PlatformOwnerHint | null;
  /** Confirmed, owner-matching server refusal; never infer denial from timeout. */
  accessDenied?: boolean;
}): PlatformEntryAction {
  if(!input.restored)return 'wait_for_local_restore';
  const saved=input.session;
  const matches=!!saved&&account(saved.owner)&&saved.owner.uid===input.sdkUid
    && (!input.requestedOwner || (input.requestedOwner.driverId===saved.owner.driverId
      && input.requestedOwner.companyId===saved.owner.companyId));
  if(input.accessDenied && matches)return 'access_denied';
  return matches&&saved!.establishedAccess?'resume':'authorize';
}
export type PlatformFailureKind = 'transport' | 'access' | 'other';
export function classifyPlatformFailure(error: unknown): PlatformFailureKind {
  const e=error as {code?:unknown;name?:unknown;message?:unknown}|null;
  const code=typeof e?.code==='string'?e.code.toLowerCase():'';
  const message=typeof e?.message==='string'?e.message.toLowerCase():typeof error==='string'?error.toLowerCase():'';
  if(['auth/user-disabled','auth/user-token-expired','auth/invalid-user-token','auth/user-not-found',
    'functions/permission-denied','functions/unauthenticated','permission-denied','unauthenticated'].includes(code))return 'access';
  if(['auth/network-request-failed','functions/unavailable','functions/deadline-exceeded',
    'unavailable','deadline-exceeded','network-request-failed','etimedout','enotfound','econnreset'].includes(code)
    || e?.name==='AbortError' || /network request failed|failed to fetch|safe_op_timeout:|timed out|timeout|enetunreach|econnrefused/.test(message))return 'transport';
  return 'other';
}
/** These bounds concern delivery attempts, never local saves or app opening. */
export const PLATFORM_CONNECTION_LIMITS=Object.freeze({failureWindowMs:60000,failuresToHold:2,slowRequestMs:8000,initialHoldMs:30000,maxHoldMs:120000});
export interface PlatformConnectionState { failures: number; lastFailureAt: number; holdUntil: number; holds: number }
export function newPlatformConnectionState(): PlatformConnectionState {return {failures:0,lastFailureAt:0,holdUntil:0,holds:0};}
export function platformDeliveryMayAttempt(state: PlatformConnectionState, now: number, reachable: boolean): boolean {
  return reachable&&now>=state.holdUntil;
}
export function notePlatformDeliveryResult(state: PlatformConnectionState, result: {ok:true}|{ok:false;error:unknown;elapsedMs:number}, now:number): PlatformConnectionState {
  if(result.ok)return newPlatformConnectionState();
  if(classifyPlatformFailure(result.error)!=='transport')return state;
  const limits=PLATFORM_CONNECTION_LIMITS;
  const failures=now-state.lastFailureAt>limits.failureWindowMs?1:state.failures+1;
  if(failures<limits.failuresToHold&&result.elapsedMs<limits.slowRequestMs)return {...state,failures,lastFailureAt:now};
  const holds=state.holds+1;
  return {failures,lastFailureAt:now,holds,holdUntil:now+Math.min(limits.initialHoldMs*2**Math.min(holds-1,2),limits.maxHoldMs)};
}

/** One general app-open contract. Required job/DVIR/shift links use their own protocols. */
export function buildPlatformAppEntryUrl(target:{scheme?:string;androidPackage?:string},owner?:PlatformOwnerHint|null):string|null {
  const aliases:Record<string,string>={
    'wellbuilt-suite':'wellbuilt-suite','com.wellbuilt.suite':'wellbuilt-suite',
    'wellbuilt-tickets':'wellbuilt-tickets','waterticket':'wellbuilt-tickets','com.testerxxx.waterticket':'wellbuilt-tickets',
    'wellbuilt-mobile':'wellbuiltmobile','wellbuiltmobile':'wellbuiltmobile','com.wellbuiltmobile.app':'wellbuiltmobile',
    'jsaapp':'jsaapp','com.syconik801.jsaapp':'jsaapp',
    'wellbuilt-equipment':'wbequipment','wellbuiltequipment':'wbequipment','wbequipment':'wbequipment','com.wellbuilt.equipment':'wbequipment',
    'wellbuilttimecard':'wellbuilttimecard','com.wellbuilt.electronictimecard':'wellbuilttimecard',
    'tickettime':'tickettime','com.michaelburger.tickettime':'tickettime',
  };
  const scheme=aliases[(target.scheme||'').trim().toLowerCase()]||aliases[target.androidPackage||''];
  if(!scheme)return null;
  // Local tools and the hub already restore their local shell; opening them is not a shift command.
  if(['wellbuilt-suite','wellbuilttimecard','tickettime'].includes(scheme))return scheme+'://';
  const parsed=parsePlatformOwnerHint(owner?{driverId:owner.driverId,companyId:owner.companyId}:{});if(!parsed.ok)return null;
  const hint=parsed.owner;
  return scheme+'://'+PLATFORM_APP_OPEN_HOST+(hint?'?driverId='+encodeURIComponent(hint.driverId)+'&companyId='+encodeURIComponent(hint.companyId):'');
}

/** Queue adapters own one timer. Never poll a disconnected link or bypass an
 * entry's existing retry deadline. No payload or account data is retained here. */
export function platformDeliveryWakeDelay(state:PlatformConnectionState, now:number, reachable:boolean, deadlines:ReadonlyArray<number|null|undefined>):number|null {
  if(!reachable || deadlines.length===0)return null;
  const due=deadlines.reduce<number>((earliest,value)=>Math.min(earliest,typeof value==='number'&&Number.isFinite(value)?value:now),Infinity);
  return Math.max(1000,Math.min(3600000,Math.max(due,state.holdUntil)-now));
}

export interface PlatformDeliveryQueue {
 /** Retry deadlines of this owner's executable durable entries; never quarantined work. */
 pending():Promise<Array<number|null|undefined>>;
 flush():Promise<unknown>;
}
/** Shared scheduler over existing durable queues, never a second payload store. */
export function createPlatformDeliveryRuntime(ops:{now:()=>number;schedule:(fn:()=>void,delay:number)=>()=>void;notifyPending:()=>void}){
 let state=newPlatformConnectionState(),reachable=true,notice=false,stopped=false;
 let cancel:(()=>void)|null=null,generation=0,draining:Promise<void>|null=null;
 const queues=new Map<string,PlatformDeliveryQueue>();
 const retryAfter=new Map<string,number>();
 const canAttempt=()=>!stopped&&platformDeliveryMayAttempt(state,ops.now(),reachable);
 const changed=async()=>{
  const captured=++generation;if(cancel){cancel();cancel=null;}
  if(stopped)return;
  const rows=await Promise.all([...queues.entries()].map(async([name,q])=>(await q.pending().catch(()=>[])).map(at=>Math.max(at||ops.now(),retryAfter.get(name)||0))));
  if(captured!==generation||stopped)return;
  const deadlines=rows.flat();
  if(!deadlines.length){notice=false;return;}
  if(!canAttempt()&&!notice){notice=true;ops.notifyPending();}
  const delay=platformDeliveryWakeDelay(state,ops.now(),reachable,deadlines);
  if(delay!==null)cancel=ops.schedule(()=>{cancel=null;void drain();},delay);
 };
 const drain=():Promise<void>=>{
  if(draining)return draining;
  draining=(async()=>{try{for(const [name,q] of queues){if(!canAttempt())break;if((retryAfter.get(name)||0)>ops.now())continue;try{await q.flush();}catch{/* queue retains its own data */}finally{retryAfter.set(name,ops.now()+PLATFORM_CONNECTION_LIMITS.initialHoldMs);}}}finally{await changed();}})().finally(()=>{draining=null;});
  return draining;
 };
 return {
  canAttempt,
  wakeDelay(deadlines:ReadonlyArray<number|null|undefined>,link=reachable){return platformDeliveryWakeDelay(state,ops.now(),link,deadlines);},
  record(result:{ok:true}|{ok:false;error:unknown;elapsedMs:number}){state=notePlatformDeliveryResult(state,result,ops.now());void changed();},
  async attempt<T>(send:()=>Promise<T>):Promise<T>{
   if(!canAttempt())throw Object.assign(Error('Saved on device; will send when connected.'),{code:'platform/delivery-held'});
   const start=ops.now();
   try{const result=await send();state=notePlatformDeliveryResult(state,{ok:true},ops.now());return result;}
   catch(error){state=notePlatformDeliveryResult(state,{ok:false,error,elapsedMs:ops.now()-start},ops.now());throw error;}
   finally{void changed();}
  },
  changed,
  setReachable(value:boolean){reachable=value;void changed();},
  register(name:string,queue:PlatformDeliveryQueue){queues.set(name,queue);void changed();return()=>{if(queues.get(name)===queue)queues.delete(name);void changed();};},
  drain,
  stop(){stopped=true;++generation;if(cancel)cancel();cancel=null;queues.clear();},
 };
}
