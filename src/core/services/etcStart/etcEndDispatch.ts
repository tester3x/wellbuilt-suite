import AsyncStorage from '@react-native-async-storage/async-storage';
import { createEtcPort } from './etcProduction';
import { newEtcRequestId } from './etcStartProtocol';
import { AppState } from 'react-native';

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
  const prepared = await call('prepareEnd');
  if (!prepared.ok || !sameReply(request, prepared.response)) return false;
  if ((prepared.response as any).state === 'completed') return true;
  if (prepared.startIntent !== 'sent') return false;
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
export async function retryEtcEnds(user: { companyId?: string | null; driverId: string }): Promise<void> {
  if (!user.companyId || !user.driverId) return;
  const key = keyOf(user.companyId, user.driverId);
  if (running.has(key)) return;
  running.add(key);
  try {
    const pending: EndRequest[] = JSON.parse(await AsyncStorage.getItem(key) || '[]');
    if (!Array.isArray(pending)) throw Error('Unreadable ETC end queue');
    for (const request of pending) {
      if (request.companyId !== user.companyId || request.driverId !== user.driverId) continue;
      if (await deliver(request)) {
        await mutate(key, rows => rows.filter(r => r.requestId !== request.requestId));
      }
    }
  } finally { running.delete(key); }
}
