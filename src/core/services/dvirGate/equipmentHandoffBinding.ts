/**
 * Durable governed equipment handoff intent (WB-S).
 *
 * SecureStore-backed, versioned, TTL-bounded. Local persistence is NOT
 * authority — resolveAuthoritativeEquipmentShiftBinding re-checks the
 * live shift before issuance.
 */
import type { SsoDvirPhase, SsoShiftBinding } from '../ssoProtocol.generated';
import { isSsoShiftBinding } from '../ssoProtocol.generated';

export const GOVERNED_HANDOFF_RECORD_V = 1 as const;
export const GOVERNED_HANDOFF_KEY = 'wbs_governed_equipment_handoff_v1';
/** Short-lived: physical Suite↔equipment round-trip + cold starts. */
export const GOVERNED_HANDOFF_TTL_MS = 10 * 60 * 1000;

export type GovernedHandoffStage =
  | 'launched'
  | 'authorizing'
  | 'completed'
  | 'cancelled'
  | 'expired'
  | 'rejected';

/** Non-secret fields only in diagnostics. Secrets: none in this record. */
export type GovernedEquipmentHandoffRecord = {
  v: typeof GOVERNED_HANDOFF_RECORD_V;
  shiftId: string;
  phase: SsoDvirPhase;
  returnHost: string;
  createdAtMs: number;
  expiresAtMs: number;
  stage: GovernedHandoffStage;
  /** Nonsecret correlation for logs (not a credential). */
  correlationId: string;
};

export type SecureKv = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

let memoryFallback: GovernedEquipmentHandoffRecord | null = null;
let injectedKv: SecureKv | null = null;

export function setGovernedHandoffKv(kv: SecureKv | null): void {
  injectedKv = kv;
}

async function kv(): Promise<SecureKv> {
  if (injectedKv) return injectedKv;
  try {
    const SecureStore = await import('expo-secure-store');
    return {
      getItem: (k) => SecureStore.getItemAsync(k),
      setItem: (k, v) => SecureStore.setItemAsync(k, v),
      removeItem: (k) => SecureStore.deleteItemAsync(k),
    };
  } catch {
    return {
      getItem: async () => (memoryFallback ? JSON.stringify(memoryFallback) : null),
      setItem: async (_k, v) => {
        try {
          memoryFallback = JSON.parse(v) as GovernedEquipmentHandoffRecord;
        } catch {
          memoryFallback = null;
        }
      },
      removeItem: async () => {
        memoryFallback = null;
      },
    };
  }
}

function newCorrelationId(nowMs: number): string {
  return `gh_${nowMs.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function isValidGovernedRecord(
  raw: unknown,
  nowMs: number,
): GovernedEquipmentHandoffRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== GOVERNED_HANDOFF_RECORD_V) return null;
  if (typeof o.shiftId !== 'string' || !o.shiftId || o.shiftId.length > 128) return null;
  if (o.phase !== 'pre_trip' && o.phase !== 'post_trip') return null;
  if (typeof o.createdAtMs !== 'number' || typeof o.expiresAtMs !== 'number') return null;
  if (typeof o.stage !== 'string' || typeof o.correlationId !== 'string') return null;
  if (typeof o.returnHost !== 'string') return null;
  if (nowMs > o.expiresAtMs) return null;
  if (o.stage === 'completed' || o.stage === 'cancelled' || o.stage === 'expired' || o.stage === 'rejected') {
    return null;
  }
  return o as unknown as GovernedEquipmentHandoffRecord;
}

export async function rememberGovernedEquipmentHandoff(
  shiftId: string,
  phase: SsoDvirPhase,
  nowMs: number = Date.now(),
  returnHost: string = 'wellbuilt-suite://dvir-complete',
): Promise<GovernedEquipmentHandoffRecord | null> {
  if (!shiftId || (phase !== 'pre_trip' && phase !== 'post_trip')) {
    await clearGovernedEquipmentHandoff('invalid_input');
    return null;
  }
  const rec: GovernedEquipmentHandoffRecord = {
    v: GOVERNED_HANDOFF_RECORD_V,
    shiftId,
    phase,
    returnHost,
    createdAtMs: nowMs,
    expiresAtMs: nowMs + GOVERNED_HANDOFF_TTL_MS,
    stage: 'launched',
    correlationId: newCorrelationId(nowMs),
  };
  const store = await kv();
  // Atomic replace of any older attempt
  await store.setItem(GOVERNED_HANDOFF_KEY, JSON.stringify(rec));
  try {
    console.log(
      `[Suite-DVIR] dvir.handoff.intent.persisted stage=launched phase=${phase} shiftId=${shiftId} corr=${rec.correlationId}`,
    );
  } catch { /* ignore */ }
  return rec;
}

export async function clearGovernedEquipmentHandoff(reason: string = 'cleared'): Promise<void> {
  const store = await kv();
  await store.removeItem(GOVERNED_HANDOFF_KEY);
  memoryFallback = null;
  try {
    console.log(`[Suite-DVIR] dvir.handoff.intent.cleared reason=${reason}`);
  } catch { /* ignore */ }
}

export async function markGovernedHandoffStage(stage: GovernedHandoffStage): Promise<void> {
  const rec = await hydrateGovernedEquipmentHandoff();
  if (!rec) return;
  rec.stage = stage;
  const store = await kv();
  if (stage === 'completed' || stage === 'cancelled' || stage === 'expired' || stage === 'rejected') {
    await store.removeItem(GOVERNED_HANDOFF_KEY);
    try {
      console.log(`[Suite-DVIR] dvir.handoff.intent.cleared reason=stage_${stage}`);
    } catch { /* ignore */ }
    return;
  }
  await store.setItem(GOVERNED_HANDOFF_KEY, JSON.stringify(rec));
}

/** Cold-start hydrate. Clears expired/malformed. */
export async function hydrateGovernedEquipmentHandoff(
  nowMs: number = Date.now(),
): Promise<GovernedEquipmentHandoffRecord | null> {
  const store = await kv();
  let raw: string | null;
  try {
    raw = await store.getItem(GOVERNED_HANDOFF_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await store.removeItem(GOVERNED_HANDOFF_KEY);
    console.log('[Suite-DVIR] dvir.handoff.intent.cleared reason=malformed');
    return null;
  }
  const rec = isValidGovernedRecord(parsed, nowMs);
  if (!rec) {
    await store.removeItem(GOVERNED_HANDOFF_KEY);
    console.log('[Suite-DVIR] dvir.handoff.intent.cleared reason=expired_or_invalid');
    return null;
  }
  try {
    console.log(
      `[Suite-DVIR] dvir.handoff.intent.hydrated stage=${rec.stage} phase=${rec.phase} corr=${rec.correlationId}`,
    );
  } catch { /* ignore */ }
  return rec;
}

export async function peekGovernedEquipmentHandoff(
  nowMs: number = Date.now(),
): Promise<GovernedEquipmentHandoffRecord | null> {
  return hydrateGovernedEquipmentHandoff(nowMs);
}

/**
 * Resolve shift binding for equipment issuance after hydration + live checks.
 */
export async function resolveAuthoritativeEquipmentShiftBinding(deps: {
  getCurrentShiftId: () => Promise<string | null>;
  isShiftActive?: () => boolean | Promise<boolean>;
  nowMs?: () => number;
}): Promise<SsoShiftBinding | null> {
  const now = deps.nowMs?.() ?? Date.now();
  const handoff = await hydrateGovernedEquipmentHandoff(now);
  if (!handoff) return null;

  if (deps.isShiftActive) {
    const active = await deps.isShiftActive();
    if (!active) return null;
  }

  const current = await deps.getCurrentShiftId();
  if (!current || current !== handoff.shiftId) return null;

  const binding: SsoShiftBinding = {
    shiftId: handoff.shiftId,
    phase: handoff.phase,
  };
  if (!isSsoShiftBinding(binding)) return null;

  await markGovernedHandoffStage('authorizing');
  return binding;
}

/** On accepted completion receipt — clear matching intent. */
export async function completeGovernedHandoffIfMatches(
  shiftId: string,
  phase: SsoDvirPhase,
): Promise<void> {
  const rec = await hydrateGovernedEquipmentHandoff();
  if (!rec) return;
  if (rec.shiftId === shiftId && rec.phase === phase) {
    await clearGovernedEquipmentHandoff('receipt_accepted');
  }
}

/** Test seam */
export async function __resetEquipmentHandoffBindingForTests(): Promise<void> {
  memoryFallback = null;
  if (injectedKv) await injectedKv.removeItem(GOVERNED_HANDOFF_KEY);
  else {
    try {
      const SecureStore = await import('expo-secure-store');
      await SecureStore.deleteItemAsync(GOVERNED_HANDOFF_KEY);
    } catch { /* ignore */ }
  }
}
