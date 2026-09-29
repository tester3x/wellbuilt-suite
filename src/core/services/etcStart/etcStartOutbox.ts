/**
 * One durable ETC start request per company, driver, Suite period, and action.
 * The stored request, including requestId and requestedAtMs, is never replaced.
 */
import {
  type EtcGps,
  type EtcHos,
  type EtcStartRequest,
  type EtcState,
  requestIdentityKey,
} from './etcStartProtocol';

const ROOT = '@wb/suite-etc-start/v1';
const INDEX_KEY = `${ROOT}/index`;

export interface EtcKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface StoredEtcStart {
  request: EtcStartRequest;
  dispatchUncertain: boolean;
  lastHos: EtcHos | null;
  lastState: EtcState | 'unknown' | null;
  lastGps: EtcGps | null;
}

const locks = new Map<string, Promise<unknown>>();

function recordKey(identity: string): string {
  return `${ROOT}/record/${encodeURIComponent(identity)}`;
}

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  locks.set(key, run.then(() => undefined, () => undefined));
  return run;
}

function parseStored(raw: string): StoredEtcStart | null {
  try {
    const parsed = JSON.parse(raw) as StoredEtcStart;
    if (!parsed?.request?.requestId || parsed.request.action !== 'start_hos') return null;
    if (parsed.request.protocolVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function readIndex(kv: EtcKv): Promise<string[]> {
  const raw = await kv.getItem(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export async function readEtcStart(kv: EtcKv, identity: string): Promise<
  { kind: 'missing' } | { kind: 'ok'; record: StoredEtcStart } | { kind: 'corrupt' }
> {
  const raw = await kv.getItem(recordKey(identity));
  if (!raw) return { kind: 'missing' };
  const record = parseStored(raw);
  return record ? { kind: 'ok', record } : { kind: 'corrupt' };
}

export async function putEtcStartOnce(
  kv: EtcKv,
  request: EtcStartRequest,
): Promise<{ created: boolean; record: StoredEtcStart | null; corrupt: boolean }> {
  const identity = requestIdentityKey(request);
  return withLock(identity, async () => {
    const existing = await readEtcStart(kv, identity);
    if (existing.kind === 'ok') return { created: false, record: existing.record, corrupt: false };
    if (existing.kind === 'corrupt') return { created: false, record: null, corrupt: true };
    const record: StoredEtcStart = {
      request,
      dispatchUncertain: false,
      lastHos: null,
      lastState: null,
      lastGps: null,
    };
    await kv.setItem(recordKey(identity), JSON.stringify(record));
    const index = await readIndex(kv);
    if (!index.includes(identity)) {
      index.push(identity);
      await kv.setItem(INDEX_KEY, JSON.stringify(index));
    }
    return { created: true, record, corrupt: false };
  });
}

export async function saveEtcStartObservation(
  kv: EtcKv,
  request: EtcStartRequest,
  patch: Pick<StoredEtcStart, 'dispatchUncertain' | 'lastHos' | 'lastState' | 'lastGps'>,
): Promise<void> {
  const identity = requestIdentityKey(request);
  await withLock(identity, async () => {
    const existing = await readEtcStart(kv, identity);
    if (existing.kind !== 'ok') return;
    const next: StoredEtcStart = {
      request: existing.record.request,
      dispatchUncertain: patch.dispatchUncertain,
      lastHos: patch.lastHos,
      lastState: patch.lastState,
      lastGps: patch.lastGps,
    };
    await kv.setItem(recordKey(identity), JSON.stringify(next));
  });
}

export async function listEtcStartsForDriver(
  kv: EtcKv,
  driverId: string,
  companyId: string | null,
): Promise<StoredEtcStart[]> {
  const index = await readIndex(kv);
  const found: StoredEtcStart[] = [];
  for (const identity of index) {
    const existing = await readEtcStart(kv, identity);
    if (existing.kind !== 'ok') continue;
    const request = existing.record.request;
    if (request.driverId !== driverId) continue;
    if (request.companyId !== companyId) continue;
    found.push(existing.record);
  }
  return found;
}

export function memoryEtcKv(seed?: Map<string, string>): EtcKv & { store: Map<string, string> } {
  const store = seed ?? new Map<string, string>();
  return {
    store,
    async getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
  };
}
