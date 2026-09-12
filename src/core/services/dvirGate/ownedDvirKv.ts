import type { DvirReceiptKv } from './dvirReceiptStore';
import { validatePhaseCompletionReceipt } from './validateReceipt';
export interface DvirOwner { driverId: string; companyId: string }

/** Account-scoped state; legacy receipts are adopted only with matching ownership. */
export function createOwnedDvirKv(raw: DvirReceiptKv, getOwner: () => Promise<DvirOwner>,
  sha256Hex: (s: string) => Promise<string>): DvirReceiptKv {
  const scoped = (key: string, owner: DvirOwner) => `${key}/owner/${encodeURIComponent(owner.companyId)}/${encodeURIComponent(owner.driverId)}`;
  async function validReceipt(value: string | null, owner: DvirOwner): Promise<boolean> {
    if (!value) return false;
    try {
      const receipt = JSON.parse(value);
      if (receipt.driverHash !== owner.driverId) return false;
      return (await validatePhaseCompletionReceipt(receipt, { sha256Hex, maxAgeMs: Infinity })).ok;
    } catch { return false; }
  }
  return {
    async getItem(key) {
      const owner = await getOwner();
      const value = await raw.getItem(scoped(key, owner));
      if (!key.includes('/receipt/')) return value;
      if (value) return await validReceipt(value, owner) ? value : null;
      const legacy = await raw.getItem(key);
      if (!(await validReceipt(legacy, owner))) return null;
      await raw.setItem(scoped(key, owner), legacy!);
      return legacy;
    },
    async setItem(key, value) {
      const owner = await getOwner();
      if (key.includes('/receipt/') && !(await validReceipt(value, owner))) {
        throw new Error('DVIR receipt does not belong to the signed-in driver.');
      }
      await raw.setItem(scoped(key, owner), value);
    },
    async removeItem(key) {
      const owner = await getOwner();
      await raw.removeItem(scoped(key, owner));
      // Never erase another owner's legacy receipt or pending obligation.
    },
  };
}
