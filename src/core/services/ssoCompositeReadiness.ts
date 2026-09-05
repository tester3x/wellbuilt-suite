/**
 * Composite, generation-owned SSO readiness.
 *
 * The authorize inbox may dispatch a queued request ONLY when, for the SAME
 * identity generation, BOTH:
 *   - secure session revalidation has SUCCEEDED, and
 *   - authentication reconciliation is VERIFIED.
 *
 * Publishing `ready` from `revalidateDriverSession()` / `authVerified` alone let
 * the inbox drain while reconciliation was still `verifying`; ssoAuthorizationCore
 * then returned an error callback and the URL was burned (never retried). This
 * module gates the two independent async results together, and terminalizes a
 * genuinely-unverifiable session so a queued request receives a bounded error
 * callback instead of hanging forever.
 *
 * The equipment-audience governed shift binding is NOT gated here: it is enforced
 * per-issuance in ssoRuntime/ssoAuthorizationCore, and a binding failure returns
 * the same bounded error callback path.
 *
 * Reason codes / states only — never tokens, claims, identity, PKCE, or URLs.
 */
import type { AuthReconciliationState } from './reconciliationCore';

export type RevalReadiness = 'pending' | 'ok' | 'failed';
export type CompositeGate = 'pending' | 'ready' | 'failed';

export interface CompositeReadinessState {
  generation: number;
  reval: RevalReadiness;
  recon: AuthReconciliationState;
  /** One post-revalidation reconciliation retry has been requested. */
  reconRetriedAfterReval: boolean;
}

export function initialCompositeReadiness(generation: number): CompositeReadinessState {
  return { generation, reval: 'pending', recon: 'verifying', reconRetriedAfterReval: false };
}

/**
 * PURE gate. `ready` requires BOTH revalidation ok AND reconciliation verified.
 * A reconciliation that has settled to a non-verifiable terminal state after a
 * successful revalidation (and been retried once) fails closed so the queued
 * request gets a bounded terminal error rather than stranding WB-E.
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

/**
 * Exactly one reconciliation retry is warranted once revalidation succeeds and
 * reconciliation had settled non-verified BEFORE the owned SDK session existed
 * (the cold-start ordering defect). Never permanently suppressed.
 */
export function shouldRetryReconciliation(s: CompositeReadinessState): boolean {
  return (
    s.reval === 'ok' &&
    (s.recon === 'unavailable' || s.recon === 'local-only') &&
    !s.reconRetriedAfterReval
  );
}

export interface CompositeReadinessBridge {
  generation(): number;
  /** New identity generation — resets readiness to pending and republishes. */
  reset(generation: number): void;
  reportRevalidation(generation: number, outcome: 'ok' | 'failed'): void;
  reportReconciliation(generation: number, recon: AuthReconciliationState): void;
  peek(): CompositeReadinessState;
}

/**
 * Live bridge. `onGate` publishes the composite gate (AuthContext wires it to
 * setSsoSessionGate + notifySsoInboxSession). `onRetryReconciliation` re-runs the
 * same-generation reconciliation once. Stale-generation reports are ignored, so
 * a prior driver's late result can never drive the current gate.
 */
export function createCompositeReadinessBridge(deps: {
  onGate: (gate: CompositeGate) => void;
  onRetryReconciliation: () => void;
}): CompositeReadinessBridge {
  let s = initialCompositeReadiness(0);
  let published: CompositeGate = 'pending';

  function settle() {
    if (shouldRetryReconciliation(s)) {
      // Arm exactly one retry; hold the gate pending until it resolves.
      s = { ...s, reconRetriedAfterReval: true, recon: 'verifying' };
      deps.onRetryReconciliation();
    }
    const gate = computeCompositeGate(s);
    if (gate !== published) {
      published = gate;
      deps.onGate(gate);
    }
  }

  return {
    generation: () => s.generation,
    reset(generation) {
      s = initialCompositeReadiness(generation);
      published = 'pending';
      deps.onGate('pending');
    },
    reportRevalidation(generation, outcome) {
      if (generation !== s.generation) return;
      s = { ...s, reval: outcome };
      settle();
    },
    reportReconciliation(generation, recon) {
      if (generation !== s.generation) return;
      s = { ...s, recon };
      settle();
    },
    peek: () => s,
  };
}

// Live singleton, bound by AuthContext for the app; null in tests that use their
// own bridge instance.
let liveBridge: CompositeReadinessBridge | null = null;
export function bindCompositeReadinessBridge(b: CompositeReadinessBridge | null): void {
  liveBridge = b;
}
export function liveCompositeReadiness(): CompositeReadinessBridge | null {
  return liveBridge;
}
