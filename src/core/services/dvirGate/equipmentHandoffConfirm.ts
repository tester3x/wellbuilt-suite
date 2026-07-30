/**
 * Promise bridge: gate service requests a branded handoff confirm;
 * React host (DvirHandoffHost) resolves it. Falls back to Alert if host unset.
 */
import type { DvirReceiptPhase } from './receiptTypes';

export type EquipmentHandoffRequest = {
  phase: DvirReceiptPhase;
  title: string;
  message: string;
};

type Handler = (req: EquipmentHandoffRequest) => Promise<boolean>;

let handler: Handler | null = null;

/** Register the UI host that shows the branded modal. */
export function setEquipmentHandoffConfirmHandler(next: Handler | null): void {
  handler = next;
}

/** True when a React host is registered (tests / production UI). */
export function hasEquipmentHandoffConfirmHandler(): boolean {
  return handler != null;
}

/**
 * Ask the driver to leave Suite for eQuipment.
 * Resolves true to continue launch, false to cancel.
 */
export async function requestEquipmentHandoffConfirm(
  req: EquipmentHandoffRequest,
): Promise<boolean> {
  if (!handler) {
    // Host not mounted (early boot / unit tests without UI) — fail closed
    // unless caller injects confirmLeaveForEquipment.
    return false;
  }
  return handler(req);
}
