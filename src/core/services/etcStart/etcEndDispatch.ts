import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEtcPort } from './etcProduction';
import { newEtcRequestId } from './etcStartProtocol';
import { AppState } from 'react-native';
import { currentEtcNotice, publishEtcNotice } from './etcNoticeStore';
import type { EtcHandoffResult } from './etcStartDispatch';
import { listEtcStartsForDriver } from './etcStartOutbox';

export const ETC_END_PENDING_NOTICE = 'WB S ended your shift, but ETC has not confirmed going off duty. Open ETC and check your clock.';

type EndRequest = { protocolVersion: 1; action: 'end_hos'; requestId: string;
  companyId: string; driverId: string; suiteShiftId: string; requestedAtMs: number };
const keyOf = (company: string, driver: string) => `suiteEtcEndV1:${company}:${driver}`;
const locks = new Map<string, Promise<unknown>>();
async function mutate(key: string, update: (rows: EndRequest[]) => EndRequest[]): Promise<void> {
  const previous = locks.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const rows = JSON.parse(await AsyncStorage.getItem(key) || '[]');
    if (!Array.isArray(rows)) throw Error('Unreadable ETC end queue');
    await AsyncStorage.setItem(key, JSON.stringify(update(rows)));
  });
  locks.set(key, next);
  try { await next; } finally { if (locks.get(key) === next) locks.delete(key); }
}
const sameReply = (request: EndRequest, reply: any) => reply
  && Object.keys(request).every(key => reply[key] === request[key as keyof EndRequest]);

async function deliver(request: EndRequest): Promise<boolean> {
  const port = createEtcPort(AppState.currentState === 'active');
  const call = async (method: 'prepareEnd' | 'getEndStatus') => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([port.call(method, JSON.stringify(request)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('ETC end timeout')), 4000); })]);
    } finally { if (timer) clearTimeout(timer); }
  };
  // Old requests are observation-only. Never refresh their timestamp to make
  // an expired end execute against a later duty session.
  const age = Date.now() - request.requestedAtMs;
  const fresh = age >= -30000 && age <= 600000;
  const prepared = await call(fresh ? 'prepareEnd' : 'getEndStatus');
  if (!prepared.ok) {
    console.warn('[ETC] Off-duty provider did not confirm:', prepared.reason, JSON.stringify({ shiftId: request.suiteShiftId }));
    return false;
  }
  if (!sameReply(request, prepared.response)) {
    console.warn('[ETC] Off-duty response did not match the queued request');
    return false;
  }
  if ((prepared.response as any).state === 'completed') return true;
  if (!fresh || prepared.startIntent !== 'sent') return false;
  for (let i = 0; i < 12; i++) {
    await new Promise(resolve => setTimeout(resolve, 250));
    const result = await call('getEndStatus');
    if (!result.ok || !sameReply(request, result.response)) return false;
    if ((result.response as any).state === 'completed') return true;
    if ((result.response as any).state === 'failed') return false;
  }
  return false;
}

// End is recorded only after Suite's close is acknowledged, and survives a lost reply.
export async function endEtcForSuiteShift(user: { companyId?: string | null; driverId: string }, shiftId: string | null): Promise<void> {
  if (!shiftId || !user.companyId || !user.driverId) return;
  const key = keyOf(user.companyId, user.driverId);
  const request: EndRequest = { protocolVersion: 1, action: 'end_hos', requestId: newEtcRequestId(),
    companyId: user.companyId, driverId: user.driverId, suiteShiftId: shiftId, requestedAtMs: Date.now() };
  await mutate(key, rows => rows.some(r => r.suiteShiftId === shiftId) ? rows : [...rows, request]);
  await retryEtcEnds(user);
}

const running = new Set<string>();
export async function retryEtcEnds(user: { companyId?: string | null; driverId: string }, context?: {
  confirmedCurrentStart?: EtcHandoffResult; isCurrent: () => boolean;
}): Promise<void> {
  if (!user.companyId || !user.driverId) return;
  const key = keyOf(user.companyId, user.driverId);
  if (running.has(key)) return;
  running.add(key);
  try {
    const pending: EndRequest[] = JSON.parse(await AsyncStorage.getItem(key) || '[]');
    if (!Array.isArray(pending)) throw Error('Unreadable ETC end queue');
    const historyKey = key + ':historical';
    const historical: Record<string, { request: EndRequest; supersededBy: string; observedAtMs: number; outcome: 'unconfirmed_historical' }> = JSON.parse(await AsyncStorage.getItem(historyKey) || '{}');
    if (!historical || typeof historical !== 'object' || Array.isArray(historical)) throw Error('Unreadable ETC end history');
    const isHistorical = (request: EndRequest) => historical[request.requestId]?.outcome === 'unconfirmed_historical'
      && sameReply(request, historical[request.requestId]?.request);
    const observed = context?.confirmedCurrentStart;
    const cachedStarts = context?.isCurrent() ? await listEtcStartsForDriver(AsyncStorage, user.driverId, user.companyId) : [];
    // A persisted successful start is historical evidence even after that newer
    // shift ended. Do not publish it as the driver's current duty state.
    const start = observed?.state === 'completed' && observed.hos === 'started' ? observed.request
      : cachedStarts.filter(row => row.lastState === 'completed' && row.lastHos === 'started')
        .sort((a, b) => b.request.requestedAtMs - a.request.requestedAtMs)[0]?.request;
    for (const request of pending) {
      if (context && !context.isCurrent()) return;
      if (request.companyId !== user.companyId || request.driverId !== user.driverId) continue;
      if (isHistorical(request)) continue;
      // A confirmed newer duty session makes an expired older end observation
      // historical. Preserve both request and unconfirmed outcome; never replay
      // it into the current session or claim the old session was closed.
      if (context?.isCurrent() && start?.companyId === user.companyId && start.driverId === user.driverId
        && start.suiteShiftId !== request.suiteShiftId && start.requestedAtMs > request.requestedAtMs
        && Date.now() - request.requestedAtMs > 600000) {
        historical[request.requestId] = { request, supersededBy: start.suiteShiftId, observedAtMs: Date.now(), outcome: 'unconfirmed_historical' };
        await AsyncStorage.setItem(historyKey, JSON.stringify(historical));
        console.log('[ETC] Retained historical shift-end request', JSON.stringify({ oldShiftId: request.suiteShiftId, currentShiftId: start.suiteShiftId, outcome: 'unconfirmed_historical' }));
        continue;
      }
      try {
        if (await deliver(request)) {
          await mutate(key, rows => rows.filter(r => r.requestId !== request.requestId));
        }
      } catch (error) {
        // A lost reply for an older end must not prevent delivery of the next
        // exact, independently bound shift end. The durable row stays queued.
        console.warn('[ETC] Off-duty confirmation remains pending:', String(error));
      }
    }
    const remaining: EndRequest[] = JSON.parse(await AsyncStorage.getItem(key) || '[]');
    if (context && !context.isCurrent()) return;
    if (remaining.some(row => !isHistorical(row))) publishEtcNotice(ETC_END_PENDING_NOTICE);
    else if (currentEtcNotice() === ETC_END_PENDING_NOTICE) publishEtcNotice(null);
  } finally { running.delete(key); }
}
