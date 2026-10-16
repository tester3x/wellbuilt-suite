import { AppState } from 'react-native';
import { createEtcPort } from './etcProduction';
import { buildEtcStartRequest, newEtcRequestId } from './etcStartProtocol';
import { validateEtcMileageReply, type ShiftMileageIdentity } from '../shiftMileage';

/** Read only. This method cannot start/end HOS or change a duty status. */
export async function readEtcShiftMiles(identity: ShiftMileageIdentity): Promise<number | null> {
  if (!identity.companyId || !identity.driverId || !identity.suiteShiftId) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const request = buildEtcStartRequest({ ...identity, requestId: newEtcRequestId(), requestedAtMs: Date.now() });
    const result = await Promise.race([
      createEtcPort(AppState.currentState === 'active').call('getMileage', JSON.stringify(request)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('Mileage read timed out')), 4000); }),
    ]);
    return result.ok ? validateEtcMileageReply(result.response, { ...request }, Date.now()) : null;
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); }
}
