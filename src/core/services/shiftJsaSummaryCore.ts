export type ShiftJsaSummary={
  protocolVersion:1;companyId:string;driverId:string;shiftId:string|null;
  status:'recorded'|'partial'|'no_evidence'|'no_shift';lifecycle:'open'|'finalized'|'unknown';
  fullReadCount:number;acknowledgementCount:number;coveredJobCount:number;jobCount:number;
  firstReadAt:string|null;jsaNumbers:string[];issues:number;
};
export type SummaryIdentity={uid:string;driverId:string|null;companyId:string|null;kind:string|null};
export async function fetchOwnedShiftJsaSummary(
  expected:{driverId:string;companyId:string},shiftId:string|null,
  deps:{identity():Promise<SummaryIdentity|null>;call(body:Record<string,unknown>):Promise<unknown>},
):Promise<ShiftJsaSummary>{
  const before=await deps.identity();
  const matches=(p:SummaryIdentity|null)=>p?.kind==='driver'&&p.driverId===expected.driverId&&p.companyId===expected.companyId;
  if(!matches(before))throw Error('summary_identity_unavailable');
  if(shiftId&&!/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(shiftId))throw Error('summary_shift_invalid');
  const raw=await deps.call({protocolVersion:1,...(shiftId?{shiftId}:{})});
  const after=await deps.identity();
  if(!matches(after)||before!.uid!==after!.uid)throw Error('summary_identity_changed');
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('summary_response_invalid');
  const r=raw as ShiftJsaSummary;
  const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=6000;
  if(r.protocolVersion!==1||r.companyId!==expected.companyId||r.driverId!==expected.driverId
    ||(shiftId&&r.shiftId!==shiftId)||(r.shiftId!==null&&!/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(r.shiftId))
    ||!['recorded','partial','no_evidence','no_shift'].includes(r.status)||!['open','finalized','unknown'].includes(r.lifecycle)
    ||![r.fullReadCount,r.acknowledgementCount,r.coveredJobCount,r.jobCount,r.issues].every(count)
    ||!Array.isArray(r.jsaNumbers)||r.jsaNumbers.length>6000||r.jsaNumbers.some(n=>typeof n!=='string'||n.length>160)
    ||(r.firstReadAt!==null&&(typeof r.firstReadAt!=='string'||!Number.isFinite(Date.parse(r.firstReadAt))))
    ||(r.status==='recorded'&&(!r.fullReadCount||r.issues))||(r.status==='partial'&&!r.issues)
    ||(r.status==='no_shift'&&r.shiftId!==null)
    ||(['no_shift','no_evidence'].includes(r.status)&&(r.fullReadCount||r.acknowledgementCount||r.coveredJobCount||r.jobCount||r.issues||r.firstReadAt!==null||r.jsaNumbers.length))
    ||r.jobCount<Math.max(r.acknowledgementCount,r.coveredJobCount))throw Error('summary_response_invalid');
  // Explicit projection: no credentials, signatures or unrecognized server data.
  return {protocolVersion:1,companyId:r.companyId,driverId:r.driverId,shiftId:r.shiftId,status:r.status,lifecycle:r.lifecycle,
    fullReadCount:r.fullReadCount,acknowledgementCount:r.acknowledgementCount,coveredJobCount:r.coveredJobCount,jobCount:r.jobCount,
    firstReadAt:r.firstReadAt,jsaNumbers:r.jsaNumbers,issues:r.issues};
}
