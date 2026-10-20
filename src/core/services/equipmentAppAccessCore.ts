/** General app access is distinct from a required, shift-bound DVIR launch. */
export function isEquipmentAppTarget(scheme?:string,androidPackage?:string):boolean {
  return scheme === 'wbequipment' || androidPackage === 'com.wellbuilt.equipment';
}
export const EQUIPMENT_APP_START = 'wbequipment://app-start';
/** Routing hints only. Equipment must match them against its own verified SDK session. */
export function equipmentAppEntryUrl(owner?: {driverId: string; companyId: string}): string {
  if (!owner?.driverId || !owner.companyId) return EQUIPMENT_APP_START;
  return EQUIPMENT_APP_START+'?'+new URLSearchParams({driverId:owner.driverId,companyId:owner.companyId}).toString();
}
export interface EquipmentAccessIdentity { uid:string;kind:string|null;driverId:string|null;companyId:string|null }
export interface EquipmentAccessOps {
  epoch():number;
  local():Promise<{driverId:string|null;companyId:string|null}>;
  reconcile(local:{driverId:string|null;companyId:string|null}):Promise<string>;
  identity(refresh:boolean):Promise<EquipmentAccessIdentity|null>;
  issue(challenge:string):Promise<unknown>;
  open(url:string):Promise<unknown>;
  now():number;
}
const exact=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
export function equipmentAccessRequest(raw:Record<string,unknown>):{state:string;codeChallenge:string} {
  if(Object.keys(raw).some(k=>!['state','codeChallenge'].includes(k))||!exact(raw.state)||!exact(raw.codeChallenge))throw Error('invalid_request');
  return {state:raw.state,codeChallenge:raw.codeChallenge};
}
export function createEquipmentAccessHandler(ops:EquipmentAccessOps) {
  const attempts=new Map<string,{at:number;work:Promise<void>}>();
  return (raw:Record<string,unknown>, stillCurrent:()=>boolean=()=>true):Promise<void>=>{
    let request:{state:string;codeChallenge:string};
    try{request=equipmentAccessRequest(raw);}catch(e){return Promise.reject(e);}
    const key=request.state+'/'+request.codeChallenge;
    const previous=attempts.get(key);
    if(previous&&ops.now()-previous.at<300000)return previous.work;
    // Bound memory; never retain authorization codes or URLs after callback.
    for(const [k,a] of attempts)if(ops.now()-a.at>=300000)attempts.delete(k);
    while(attempts.size>=32)attempts.delete(attempts.keys().next().value!);
    const work=(async()=>{
      const epoch=ops.epoch();const local=await ops.local();
      if(!local.driverId||!local.companyId)throw Error('session_missing');
      const reconciliation=await ops.reconcile(local);
      if(reconciliation!=='verified')throw Error(reconciliation==='local-only'?'session_unverified':reconciliation==='unavailable'?'connection_unavailable':'session_changed');
      const owner=await ops.identity(false);
      if(ops.epoch()!==epoch||!stillCurrent())throw Error('account_changed');
      if(!owner||owner.kind!=='driver'||owner.driverId!==local.driverId||owner.companyId!==local.companyId)throw Error('not_authorized');
      const result=await ops.issue(request.codeChallenge) as {version?:unknown;code?:unknown;expiresAtMs?:unknown};
      const current=await ops.identity(false);const liveLocal=await ops.local();
      if(ops.epoch()!==epoch||!stillCurrent()||!current||current.uid!==owner.uid||current.kind!=='driver'||current.driverId!==owner.driverId||current.companyId!==owner.companyId
          ||liveLocal.driverId!==local.driverId||liveLocal.companyId!==local.companyId)throw Error('account_changed');
      if(result?.version!==1||!exact(result.code)||typeof result.expiresAtMs!=='number'||result.expiresAtMs<=ops.now())throw Error('invalid_response');
      // Destination is fixed; caller cannot select another app or redirect.
      await ops.open('wbequipment://app-callback?'+new URLSearchParams({code:result.code,state:request.state}).toString());
    })();
    attempts.set(key,{at:ops.now(),work});
    return work;
  };
}
