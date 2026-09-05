/**
 * Composite, generation-owned SSO readiness.
 *
 * Auth `ready` requires, for the SAME captured identity generation:
 *   - secure session revalidation SUCCEEDED, and
 *   - authentication reconciliation VERIFIED.
 *
 * Equipment `open` is a parallel gate. Non-equipment audiences dispatch on
 * auth ready alone. Equipment audiences additionally require a server-
 * authoritative open period plus a matching governed handoff.
 *
 * Reconciliation results MUST be reported with the generation captured when
 * that reconciliation operation started — never with whatever
 * readinessGenRef.current happens to be when a listener fires.
 */
import type { AuthReconciliationState } from './reconciliationCore';
import type { SsoShiftBinding } from './ssoProtocol.generated';
import {
  computeEquipmentRelease,
  initialEquipmentAuthority,
  type EquipmentHandoffView,
  type EquipmentRelease,
  type EquipmentRestoration,
} from './ssoEquipmentAuthority';
import type { SsoTerminalReason } from './ssoTerminalResponder';

export type RevalReadiness = 'pending' | 'ok' | 'failed';
export type CompositeGate = 'pending' | 'ready' | 'failed';

export interface CompositeReadinessState {
  generation: number;
  reval: RevalReadiness;
  recon: AuthReconciliationState;
  /** One post-revalidation reconciliation retry has been requested. */
  reconRetriedAfterReval: boolean;
  restoration: EquipmentRestoration;
  periodId: string | null;
  equipment: EquipmentRelease;
  binding: SsoShiftBinding | null;
}

export type CompositePublish = {
  gate: CompositeGate;
  equipment: EquipmentRelease;
  terminalReason?: SsoTerminalReason;
};

export function initialCompositeReadiness(generation: number): CompositeReadinessState {
  const eq = initialEquipmentAuthority(generation);
  return {
    generation,
    reval: 'pending',
    recon: 'verifying',
    reconRetriedAfterReval: false,
    restoration: eq.restoration,
    periodId: eq.periodId,
    equipment: eq.release,
    binding: eq.binding,
  };
}

/**
 * PURE auth gate. `ready` requires BOTH revalidation ok AND reconciliation
 * verified. Equipment is NOT folded in — tickets/JSA/WB-M must not wait on
 * equipment-shift restoration.
 */
export function computeCompositeGate(s: CompositeReadinessState): CompositeGate {
  if (s.reval === 'failed') return 'failed';
  if (s.recon === 'rejected') return 'failed';
  if (s.reval === 'ok' && s.recon === 'verified') return 'ready';
  if (
    s.reval === 'ok' &&
    (s.recon === 'unavailable' || s.recon === 'local-only') &&
    s.reconRetriedAfterReval
  ) {
    return 'failed';
  }
  return 'pending';
}

export function authTerminalReason(s: CompositeReadinessState): SsoTerminalReason | undefined {
  if (s.reval === 'failed') return 'revalidation_failed';
  if (s.recon === 'rejected') return 'reconciliation_rejected';
  if (
    s.reval === 'ok' &&
    (s.recon === 'unavailable' || s.recon === 'local-only') &&
    s.reconRetriedAfterReval
  ) {
    return 'reconciliation_unavailable';
  }
  return undefined;
}

export function shouldRetryReconciliation(s: CompositeReadinessState): boolean {
  return (
    s.reval === 'ok' &&
    (s.recon === 'unavailable' || s.recon === 'local-only') &&
    !s.reconRetriedAfterReval
  );
}

export interface CompositeReadinessBridge {
  generation(): number;
  reset(generation: number): void;
  reportRevalidation(generation: number, outcome: 'ok' | 'failed'): void;
  /** `generation` MUST be the gen captured when this recon operation started. */
  reportReconciliation(generation: number, recon: AuthReconciliationState): void;
  reportEquipmentRestoration(
    generation: number,
    restoration: EquipmentRestoration,
    periodId?: string | null,
  ): void;
  reconsiderEquipmentHandoff(): void;
  peek(): CompositeReadinessState;
}

export function createCompositeReadinessBridge(deps: {
  onPublish: (pub: CompositePublish) => void;
  onRetryReconciliation: () => void;
  readHandoff: () => Promise<EquipmentHandoffView | null>;
  nowMs?: () => number;
}): CompositeReadinessBridge {
  let s = initialCompositeReadiness(0);
  let publishedGate: CompositeGate = 'pending';
  let publishedEquipment: EquipmentRelease = 'pending';
  let handoffInflight: Promise<void> | null = null;

  function publish() {
    const gate = computeCompositeGate(s);
    if (gate === publishedGate && s.equipment === publishedEquipment) return;
    publishedGate = gate;
    publishedEquipment = s.equipment;
    deps.onPublish({
      gate,
      equipment: s.equipment,
      terminalReason: gate === 'failed' ? authTerminalReason(s) : undefined,
    });
  }

  function applyAuthSettle() {
    if (shouldRetryReconciliation(s)) {
      s = { ...s, reconRetriedAfterReval: true, recon: 'verifying' };
      deps.onRetryReconciliation();
    }
    publish();
  }

  function applyEquipment(handoff: EquipmentHandoffView | null) {
    const next = computeEquipmentRelease({
      restoration: s.restoration,
      periodId: s.periodId,
      handoff,
      nowMs: deps.nowMs?.() ?? Date.now(),
    });
    s = { ...s, equipment: next.release, binding: next.binding };
    publish();
  }

  function refreshEquipment() {
    const gen = s.generation;
    const p = deps.readHandoff().then((handoff) => {
      if (gen !== s.generation) return;
      applyEquipment(handoff);
    }).catch(() => {
      if (gen !== s.generation) return;
      applyEquipment(null);
    }).finally(() => {
      if (handoffInflight === p) handoffInflight = null;
    });
    handoffInflight = p;
  }

  return {
    generation: () => s.generation,
    reset(generation) {
      s = initialCompositeReadiness(generation);
      publishedGate = 'pending';
      publishedEquipment = 'pending';
      deps.onPublish({ gate: 'pending', equipment: 'pending' });
    },
    reportRevalidation(generation, outcome) {
      if (generation !== s.generation) return;
      s = { ...s, reval: outcome };
      applyAuthSettle();
    },
    reportReconciliation(generation, recon) {
      if (generation !== s.generation) return;
      s = { ...s, recon };
      applyAuthSettle();
    },
    reportEquipmentRestoration(generation, restoration, periodId) {
      if (generation !== s.generation) return;
      s = {
        ...s,
        restoration,
        periodId: restoration === 'open' ? (periodId ?? null) : null,
        binding: null,
        equipment: restoration === 'pending' ? 'pending' : s.equipment,
      };
      if (restoration === 'open') {
        refreshEquipment();
        return;
      }
      applyEquipment(null);
    },
    reconsiderEquipmentHandoff() {
      if (s.restoration !== 'open') return;
      refreshEquipment();
    },
    peek: () => s,
  };
}

let liveBridge: CompositeReadinessBridge | null = null;
export function bindCompositeReadinessBridge(b: CompositeReadinessBridge | null): void {
  liveBridge = b;
}
export function liveCompositeReadiness(): CompositeReadinessBridge | null {
  return liveBridge;
}
