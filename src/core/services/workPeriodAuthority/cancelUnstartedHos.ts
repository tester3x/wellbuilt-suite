import { acceptEchoedEtcStatus, encodeEtcStartRequest } from '../etcStart/etcStartProtocol';
import type { StoredEtcStart } from '../etcStart/etcStartOutbox';
import type { EtcPort } from '../etcStart/etcStartDispatch';

/** Cancel only a prepared HOS start, never an HOS work record. The provider's
 * atomic cancelStart leaves processing/completed starts untouched. */
export async function hosBlocksUnstartedCancellation(
  stored: { kind: 'missing' | 'corrupt' } | { kind: 'ok'; record: StoredEtcStart },
  port: EtcPort,
): Promise<boolean> {
  if (stored.kind === 'missing') return false;
  if (stored.kind !== 'ok') return true;
  const result = await port.call('cancelStart', encodeEtcStartRequest(stored.record.request));
  if (!result.ok) return true;
  const status = acceptEchoedEtcStatus(stored.record.request, result.response);
  return !(status?.hos === 'not_started' && ['cancelled', 'rejected', 'expired'].includes(status.state));
}
