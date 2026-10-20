/** Continuation only: a server-observed open period, bound to this device login.
 * Never discovers/mints a shift or overrides a readable server response. */
export const OFFLINE_SHIFT_RECEIPT_KEY = 'wellbuilt-verified-open-shift-v1';
export type ReceiptOwner = { uid: string; driverId: string; companyId: string; grantId: string };
export type OpenPeriod = { state: 'open'; periodId: string; originLocalDate: string; protocolVersion: 1 };
export function matchingOfflineShift(raw: unknown, owner: ReceiptOwner | null, binding: string | null): OpenPeriod | null {
  const r = raw as { owner?: ReceiptOwner; period?: OpenPeriod } | null;
  const p = r?.period;
  if (!owner || !r?.owner || !p || p.state !== 'open' || p.protocolVersion !== 1
    || !/^\d{4}-\d{2}-\d{2}_\d{6}$/.test(p.periodId)
    || p.originLocalDate !== p.periodId.slice(0, 10) || p.periodId !== binding
    || !(['uid', 'driverId', 'companyId', 'grantId'] as const).every(k => owner[k] === r.owner![k])) return null;
  return p;
}
