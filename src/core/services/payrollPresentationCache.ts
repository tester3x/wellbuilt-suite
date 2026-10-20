import type {TimesheetSummary} from './payroll';
export interface PayrollViewOwner {uid:string;driverId:string;companyId:string}
export interface PayrollViewWindow {startISO:string;endISO:string}
export interface PayrollPresentation {summary:TimesheetSummary;noRateSheet:boolean;savedAtMs:number}
export function payrollViewKey(owner:PayrollViewOwner,period:PayrollViewWindow):string {
 return '@wb-suite/payroll-view/v1/'+encodeURIComponent(JSON.stringify([owner.uid,owner.driverId,owner.companyId,period.startISO,period.endISO]));
}
export function serializePayrollView(owner:PayrollViewOwner,period:PayrollViewWindow,view:PayrollPresentation):string|null {
 const raw=JSON.stringify({version:1,owner,period,...view});return raw.length<=400_000?raw:null;
}
export function parsePayrollView(raw:string|null,owner:PayrollViewOwner,period:PayrollViewWindow,now:number):PayrollPresentation|null {
 try {
  const r=JSON.parse(raw||'null');
  if(r?.version!==1||!['uid','driverId','companyId'].every(k=>r.owner?.[k]===owner[k as keyof PayrollViewOwner])
   ||r.period?.startISO!==period.startISO||r.period?.endISO!==period.endISO
   ||!Number.isFinite(r.savedAtMs)||r.savedAtMs>now||now-r.savedAtMs>30*86400000
   ||typeof r.noRateSheet!=='boolean'||!Array.isArray(r.summary?.rows)
   ||!['totalLoads','totalBBLs','totalTons','unresolvedCount','totalHours','totalGross','totalPay'].every(k=>Number.isFinite(r.summary[k]))
   ||!['periodLabel','periodStart','periodEnd'].every(k=>typeof r.summary[k]==='string'))return null;
  return {summary:r.summary,noRateSheet:r.noRateSheet,savedAtMs:r.savedAtMs};
 } catch{return null;}
}
