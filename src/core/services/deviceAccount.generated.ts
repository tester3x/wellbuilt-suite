// Generated from wellbuilt-contracts/src/runtime/deviceAccount.ts. Do not edit.
/** Canonical protected device account; native Binder provides the trusted cache.
 * No password, Firebase refresh token, or authority-bearing URI is used. */
export type DeviceApp='suite'|'tickets'|'mobile'|'jsa'|'equipment'|'etc'|'tickettime';
export interface DeviceOwner {uid:string;driverId:string;companyId:string}
export interface DeviceAccess {version:1;grantId:string;owner:DeviceOwner;establishedAtMs:number;checkedAtMs:number;allowedApps:DeviceApp[];profile:{displayName:string|null;legalName:string|null}}
export interface DeviceAccount {credential?:string;access:DeviceAccess;revoked?:boolean}
export interface DeviceExchange {version:1;customToken:string;access:DeviceAccess;jsaBinding?:unknown}
export interface DeviceAccountNative {readAccount():Promise<string|null>;publishAccount(raw:string,expectedGrant:string|null):Promise<boolean>;revokeAccount(grantId:string):Promise<boolean>}
export const deviceOwnerMatches=(a:DeviceOwner|null|undefined,b:DeviceOwner|null|undefined)=>!!a&&!!b&&a.uid===b.uid&&a.driverId===b.driverId&&a.companyId===b.companyId;
const apps:DeviceApp[]=['suite','tickets','mobile','jsa','equipment','etc','tickettime'];
export function parseDeviceAccount(raw:unknown):DeviceAccount|null {
 try{const r=typeof raw==='string'?JSON.parse(raw):raw,a=r?.access,o=a?.owner;
 if(!r||typeof r!=='object'||a?.version!==1||typeof a.grantId!=='string'||!/^[a-f0-9]{64}$/.test(a.grantId)||!o||!['uid','driverId','companyId'].every(k=>typeof o[k]==='string'&&o[k].trim().length>0)||!Number.isFinite(a.establishedAtMs)||a.establishedAtMs<=0||!Number.isFinite(a.checkedAtMs)||!Array.isArray(a.allowedApps)||a.allowedApps.some((v:unknown)=>!apps.includes(v as DeviceApp))||new Set(a.allowedApps).size!==a.allowedApps.length||!a.profile||!['displayName','legalName'].every(k=>a.profile[k]===null||typeof a.profile[k]==='string'))return null;
 if(r.revoked!==true&&(typeof r.credential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(r.credential)))return null;
 return r as DeviceAccount;
 }catch{return null;}
}
export function createDeviceAccountClient(native:DeviceAccountNative|null,call:(name:string,data:Record<string,unknown>)=>Promise<unknown>){
 const read=async()=>native?parseDeviceAccount(await native.readAccount()):null;
 let restoring:Promise<'absent'|'current'|'restored'>|null=null;
 const current=async(expected:DeviceAccount)=>{const r=await read();return !!r&&!r.revoked&&r.access.grantId===expected.access.grantId&&deviceOwnerMatches(r.access.owner,expected.access.owner);};
 const refreshing=new Map<string,Promise<void>>();
 const refreshAccess=(prior:DeviceAccount,isCurrent:()=>boolean):Promise<void>=>{
  if(!native||Date.now()-prior.access.checkedAtMs<300000)return Promise.resolve();
  const key=prior.access.grantId,existing=refreshing.get(key);if(existing)return existing;
  const task=(async()=>{
   try{
    const result=await call('platformRefreshDeviceAccount',{version:1,grantId:key}) as {access:DeviceAccess};
    const updated=parseDeviceAccount({...prior,access:result.access});
    if(updated&&isCurrent()&&await current(prior)&&updated.access.grantId===key&&deviceOwnerMatches(updated.access.owner,prior.access.owner))await native.publishAccount(JSON.stringify(updated),key);
   }catch(error){const e=error as {code?:string;message?:string};if(e.code==='functions/permission-denied'&&['device_account_unavailable','account_unavailable'].includes(e.message||'')&&isCurrent()&&await current(prior))await native.revokeAccount(key);}
  })().finally(()=>{refreshing.delete(key);});refreshing.set(key,task);return task;
 };
 return {
  read,
  async publish(owner:DeviceOwner,isCurrent:()=>boolean,explicit=false):Promise<void>{
   if(!native||!isCurrent())return;
   const prior=await read();
   if(prior&&!prior.revoked&&deviceOwnerMatches(prior.access.owner,owner)&&!explicit&&Date.now()-prior.access.establishedAtMs<60*86400000){
    await refreshAccess(prior,isCurrent);
    return;
   }
   if(prior&&!deviceOwnerMatches(prior.access.owner,owner)&&!explicit)return;
   if(prior?.revoked&&!explicit)return; // A restored old SDK session cannot replace a newer device login.
   const r=await call('platformIssueDeviceAccount',{version:1}) as DeviceAccount;
   const parsed=parseDeviceAccount(r);
   if(!parsed||parsed.revoked||!deviceOwnerMatches(parsed.access.owner,owner)||!isCurrent())return;
   await native.publishAccount(JSON.stringify(parsed),prior?.access.grantId||null);
  },
  restore(app:DeviceApp,owner:DeviceOwner|null,install:(reply:DeviceExchange)=>Promise<void>):Promise<'absent'|'current'|'restored'>{
   if(restoring)return restoring;
   restoring=(async()=>{
    const saved=await read();if(!saved)return 'absent' as const;
    if(saved.revoked)throw Object.assign(Error('Your WellBuilt account was signed out on this device.'),{code:'platform/signed-out'});
    if(!saved.access.allowedApps.includes(app))throw Object.assign(Error('This app is not included in your WellBuilt account.'),{code:'platform/access-denied'});
    if(deviceOwnerMatches(saved.access.owner,owner)){void refreshAccess(saved,()=>true);return 'current' as const;}
    let reply:DeviceExchange;
    try{reply=await call('platformExchangeDeviceAccount',{version:1,credential:saved.credential,app}) as DeviceExchange;}
    catch(error){
     const e=error as {code?:string;message?:string};
     if(e.code==='functions/permission-denied' && await current(saved)){
      if(e.message==='app_unavailable')throw Object.assign(Error('This app is not included in your WellBuilt account.'),{code:'platform/access-denied'});
      if(e.message==='device_account_unavailable'||e.message==='account_unavailable'){
       await native?.revokeAccount(saved.access.grantId);
       throw Object.assign(Error('Your WellBuilt account needs to be signed in again.'),{code:'platform/signed-out'});
      }
     }
     throw error;
    }
    if(!reply||reply.version!==1||!reply.customToken||!deviceOwnerMatches(reply.access?.owner,saved.access.owner)||reply.access.grantId!==saved.access.grantId||!reply.access.allowedApps.includes(app)||!await current(saved))throw Object.assign(Error('WellBuilt account changed. Please reopen this app.'),{code:'platform/superseded'});
    await install(reply);
    if(!await current(saved))throw Object.assign(Error('WellBuilt account changed. Please reopen this app.'),{code:'platform/superseded'});
    await native?.publishAccount(JSON.stringify({...saved,access:reply.access}),saved.access.grantId);
    return 'restored' as const;
   })().finally(()=>{restoring=null;});return restoring;
  },
  async revoke(owner:DeviceOwner):Promise<void>{
   const saved=await read();if(!native||!saved||!deviceOwnerMatches(owner,saved.access.owner))return;
   await native.revokeAccount(saved.access.grantId);
   void call('platformRevokeDeviceAccount',{version:1,grantId:saved.access.grantId,credential:saved.credential}).catch(()=>{});
  }
 };
}
