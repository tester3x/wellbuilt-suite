export interface ReverifyOwner {driverId:string;companyId:string;displayName:string;shiftId:string|null}
export interface ReverifyOps {
 epoch():number; local():Promise<ReverifyOwner|null>;
 authenticate(name:string,passcode:string):Promise<{driverId?:string;companyId?:string;customToken?:string}>;
 establish(token:string,owner:ReverifyOwner):Promise<void>;
 reconcile(owner:ReverifyOwner):Promise<boolean>;
}
const same=(a:ReverifyOwner|null,b:ReverifyOwner)=>!!a&&a.driverId===b.driverId&&a.companyId===b.companyId&&a.shiftId===b.shiftId;
export async function reverifySameAccount(ops:ReverifyOps,passcode:string,active:()=>boolean=()=>true):Promise<void>{
 const epoch=ops.epoch();const owner=await ops.local();
 if(!owner||!owner.driverId||!owner.companyId||!owner.displayName||!passcode||passcode.length>128)throw Error('verification_required');
 const current=async()=>{if(!active()||ops.epoch()!==epoch||!same(await ops.local(),owner))throw Error('verification_changed');};
 await current();const result=await ops.authenticate(owner.displayName,passcode);await current();
 // Check the credential owner's binding BEFORE any SDK mutation. Never switch accounts during a shift.
 if(result.driverId!==owner.driverId||result.companyId!==owner.companyId||typeof result.customToken!=='string'||!result.customToken)throw Error('verification_account_mismatch');
 await ops.establish(result.customToken,owner);await current();
 if(!await ops.reconcile(owner))throw Error('verification_unavailable');await current();
 // No local session, shift, departure, JSA, or inspection writers in this path.
}
