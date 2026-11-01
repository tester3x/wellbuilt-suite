/**
 * Promise bridge: gate service requests a branded handoff confirm;
 * React host (DvirHandoffHost) resolves it. A brief host-mount gap waits for
 * the branded UI; it never opens a native confirmation or launches silently.
 */
import type { DvirReceiptPhase } from './receiptTypes';

export type EquipmentHandoffRequest = {
  phase: DvirReceiptPhase;
  title: string;
  message: string;
};

type Handler = (req: EquipmentHandoffRequest) => Promise<boolean>;

let handler: Handler | null = null;
export const EQUIPMENT_HANDOFF_HOST_WAIT_MS = 2000;
type Pending = {req:EquipmentHandoffRequest;promise:Promise<boolean>;resolve:(ok:boolean)=>void;owner:Handler|null;timer?:ReturnType<typeof setTimeout>};
let pending:Pending|null=null;

function finish(request:Pending,ok:boolean){
  if(pending!==request)return;
  if(request.timer)clearTimeout(request.timer);
  pending=null;request.resolve(ok);
}
function present(request:Pending,next:Handler){
  if(request.timer)clearTimeout(request.timer);
  request.owner=next;
  Promise.resolve().then(()=>pending===request&&handler===next?next(request.req):false).then(ok=>finish(request,ok===true),()=>finish(request,false));
}

/** Register the UI host that shows the branded modal. */
export function setEquipmentHandoffConfirmHandler(next: Handler | null): () => void {
  if(handler!==next&&pending?.owner)finish(pending,false);
  handler = next;
  if(next&&pending&&!pending.owner)present(pending,next);
  // An old host cleanup cannot unregister its replacement.
  return ()=>{if(handler===next)setEquipmentHandoffConfirmHandler(null);};
}

/** True when a React host is registered (tests / production UI). */
export function hasEquipmentHandoffConfirmHandler(): boolean {
  return handler != null;
}

/**
 * Ask the driver to leave Suite for eQuipment.
 * Resolves true to continue launch, false to cancel.
 */
export function requestEquipmentHandoffConfirm(
  req: EquipmentHandoffRequest,
): Promise<boolean> {
  if(pending)return pending.req.phase===req.phase?pending.promise:Promise.resolve(false);
  let resolve!:(ok:boolean)=>void;
  const promise=new Promise<boolean>(r=>{resolve=r;});
  const request:Pending={req,promise,resolve,owner:null};pending=request;
  if(handler)present(request,handler);
  else request.timer=setTimeout(()=>finish(request,false),EQUIPMENT_HANDOFF_HOST_WAIT_MS);
  return promise;
}
