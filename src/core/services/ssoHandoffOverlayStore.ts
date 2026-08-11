/**
 * Continuous outbound-handoff overlay — visual state store.
 *
 * ── The artifact this removes ─────────────────────────────────────────────
 * Cold Suite→WB-T handoffs read as "Suite Home appeared twice": Home before
 * the tap, WB-T's Connecting interlude, then Home AGAIN for the first frames
 * after the returned authorize intent re-fronts Suite — because Android
 * redraws the Activity's last-rendered tree before any JS can commit
 * claim-driven state. A returned-claim overlay therefore cannot win; the
 * covered tree has to exist BEFORE Suite backgrounds.
 *
 * So the overlay arms at the Tickets-card tap, commits a frame before
 * `openURL`, rides the backgrounded tree, and is already on screen when the
 * authorize intent brings Suite forward. Claim processing merely updates its
 * copy. (Hybrid: a claim-side arm covers counterpart-originated or
 * process-death recovery — where the prior covered tree no longer exists and
 * one pre-JS Home frame is honestly possible.)
 *
 * ── What this store is NOT ────────────────────────────────────────────────
 * Visual state only. It cannot issue, retry, re-drive, dispatch, or own any
 * route: it imports nothing but protocol constants, and nothing here is
 * awaited by the authorization path. Deleting this file would change pixels,
 * never protocol.
 *
 * ── Phases ────────────────────────────────────────────────────────────────
 *   idle              — no handoff; overlay hidden; Home renders normally.
 *   opening           — armed at the outbound tap, before openURL. The
 *                       initial background transition to WB-T must NOT clear
 *                       this phase: clearing on AppState is callback_launched-
 *                       only by construction (see noteAppStateChange).
 *   authorizing       — the returned authorize URL was claimed.
 *   callback_launched — issuance succeeded and the callback intent was
 *                       opened. DELIBERATELY NOT CLEARED YET: the retained
 *                       trace shows a possible Home frame between callback
 *                       launch and WB-T actually taking the foreground.
 *                       The overlay clears only after Suite OBSERVES itself
 *                       leaving the active foreground — i.e. after WB-T has
 *                       provably taken over — so the next ordinary Suite
 *                       resume shows Home normally.
 *
 * A callback_launched overlay whose WB-T never takes over (or any phase that
 * outlives its welcome) falls to the bounded stale timeout and clears to
 * ordinary Home — no retry, no route action; recovery is the ordinary tap.
 */
import {
  SSO_AUDIENCE_EQUIPMENT,
  SSO_AUDIENCE_WBT,
  type SsoAudience,
} from './ssoProtocol.generated';

export type SsoHandoffPhase = 'idle' | 'opening' | 'authorizing' | 'callback_launched';

export interface SsoHandoffState {
  phase: SsoHandoffPhase;
  audience: SsoAudience | null;
  /** When THIS handoff began. Repeated arms inside a live handoff keep it. */
  sinceMs: number | null;
}

/**
 * Stale bound. Generous — the slowest observed healthy issuance was 4.7 s
 * and WB-T's own pending UI bounds at 45 s; aligned so neither app strands
 * the driver longer than the other.
 */
export const SSO_HANDOFF_STALE_TIMEOUT_MS = 45_000;

type Listener = (s: SsoHandoffState) => void;

let phase: SsoHandoffPhase = 'idle';
let audience: SsoAudience | null = null;
let sinceMs: number | null = null;
/**
 * The latest OBSERVED AppState, tracked continuously regardless of phase.
 *
 * This is what makes callback completion and foreground departure
 * ORDER-INDEPENDENT. The real event order can be either:
 *   A. callback reported first:  authorizing → callback_launched(active)
 *      → inactive → idle
 *   B. departure first:          authorizing → inactive REMEMBERED here
 *      → callback reported → idle immediately (WB-T already took over)
 * Without the memory, ordering B ignores the inactive event — it never
 * repeats — and the overlay covers Suite until the stale timeout.
 *
 * Refreshed to 'active' on every fresh arm and on every claim: arming and
 * claiming both happen with Suite foreground, so a value left over from a
 * PRIOR handoff's departure (or from this handoff's own outbound leg) can
 * never masquerade as "WB-T already took over".
 */
let latestAppState: string = 'active';
const listeners = new Set<Listener>();

function snapshot(): SsoHandoffState {
  return { phase, audience, sinceMs };
}

function publish(): void {
  const s = snapshot();
  for (const cb of listeners) {
    try { cb(s); } catch { /* a bad subscriber cannot break the store */ }
  }
}

function set(nextPhase: SsoHandoffPhase, nextAudience: SsoAudience | null, nextSince: number | null): void {
  phase = nextPhase;
  audience = nextAudience;
  sinceMs = nextSince;
  publish();
}

export function getSsoHandoffState(): SsoHandoffState {
  return snapshot();
}

export function subscribeSsoHandoff(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/**
 * The outbound tap: arm before openURL.
 *
 * From idle (or from a stuck callback_launched — a re-tap is a genuinely
 * new handoff) this starts fresh. From opening/authorizing it KEEPS the
 * original sinceMs, so repeated arms cannot extend the stale TTL.
 */
export function armSsoHandoffOutbound(aud: SsoAudience, nowMs: number): void {
  if (phase === 'opening' || phase === 'authorizing') {
    set('opening', aud, sinceMs); // no TTL extension
    return;
  }
  // A fresh arm happens with Suite foreground (the driver just tapped), so
  // the remembered AppState resets: a departure left over from a PRIOR
  // handoff can never clear this one at callback time.
  latestAppState = 'active';
  set('opening', aud, nowMs);
}

/**
 * Claim-side arm/update: the returned authorize URL was claimed.
 *
 * opening → authorizing keeps sinceMs (same handoff). idle → authorizing is
 * the FALLBACK arm (counterpart-originated leg or Suite process death) and
 * starts fresh — with the honest caveat that a freshly-created process has
 * no covered tree, so one pre-JS Home frame is possible there and the
 * zero-frame invariant is claimed only for process-preserved handoffs.
 */
export function noteSsoHandoffClaim(aud: SsoAudience, nowMs: number): void {
  // Processing a claim means Suite's JS is running in the returned
  // foreground. Refresh the remembered AppState HERE, deterministically,
  // rather than racing the host's 'active' event against the Linking
  // listener: after this, the only way callback completion can observe a
  // non-active state is a departure that happened AFTER the claim — i.e.
  // WB-T genuinely taking over.
  latestAppState = 'active';
  if (phase === 'opening' || phase === 'authorizing') {
    set('authorizing', aud, sinceMs);
    return;
  }
  set('authorizing', aud, nowMs);
}

/**
 * Issuance succeeded and the callback intent was opened.
 *
 * ORDER-INDEPENDENT with the foreground departure:
 *  - If the remembered AppState is already non-active, WB-T has ALREADY
 *    taken the foreground (the departure event fired before the adapter's
 *    promise resolution reached us — a real JS ordering). Clear now; the
 *    departure will not repeat.
 *  - If still active, enter callback_launched and wait for the subsequent
 *    departure (or the bounded timeout, if the transfer never happens).
 */
export function noteSsoHandoffCallbackLaunched(): void {
  if (phase !== 'authorizing' && phase !== 'opening') return;
  if (latestAppState !== 'active') {
    set('idle', null, null);
    return;
  }
  set('callback_launched', audience, sinceMs);
}

/**
 * Terminal authorize failure with no callback (answered/error, abandoned,
 * callback-failed): clear so the existing bounded error UI renders.
 * Never fires from callback_launched — that phase's ending is the AppState
 * transition or the timeout, not an error from a later, unrelated route.
 */
export function noteSsoHandoffTerminalError(): void {
  if (phase === 'authorizing' || phase === 'opening') {
    set('idle', null, null);
  }
}

/** The outbound launch itself failed before leaving Suite: clear now. */
export function noteSsoHandoffLaunchFailure(): void {
  if (phase === 'opening') set('idle', null, null);
}

/**
 * AppState observation — ALWAYS RECORDED, phase-gated for clearing.
 *
 * Every event updates the remembered value (that memory is what makes
 * ordering B work at callback time). The only phase an event can CLEAR is
 * callback_launched: leaving the active foreground after the callback was
 * launched means WB-T has taken over, so the covered tree has done its job
 * and the next ordinary Suite resume should show Home.
 *
 * PROOF THAT INITIAL BACKGROUNDING CANNOT CLEAR OR DISARM: during the
 * outbound Suite→WB-T transition the phase is 'opening' (or 'authorizing');
 * for those phases this function only records. The recorded departure also
 * cannot bleed into callback time, because noteSsoHandoffClaim resets the
 * memory to 'active' when Suite returns with the authorize — so only a
 * departure AFTER the claim can satisfy the callback-time check. There is
 * no other AppState-driven path to 'idle'.
 *
 * The always-mounted host seeds this with AppState.currentState when it
 * subscribes, so initialization reflects reality even if the first change
 * event is still to come.
 */
export function noteSsoHandoffAppState(nextState: string): void {
  latestAppState = nextState;
  if (phase !== 'callback_launched') return;
  if (nextState !== 'active') set('idle', null, null);
}

/**
 * Bounded staleness. Measured against the CURRENT handoff's sinceMs, so a
 * stale timer armed for an earlier handoff cannot clear a newer one — the
 * same elapsed-guard pattern proven in WB-T's bridge gate.
 */
export function noteSsoHandoffTimeoutCheck(nowMs: number): void {
  if (phase === 'idle' || sinceMs === null) return;
  if (nowMs - sinceMs >= SSO_HANDOFF_STALE_TIMEOUT_MS) set('idle', null, null);
}

/** Test-only: return to a cold state between cases. */
export function __resetSsoHandoffForTests(): void {
  latestAppState = 'active';
  set('idle', null, null);
  listeners.clear();
}

/** Driver-facing copy — audience-aware, total over phases that render. */
export function ssoHandoffCopy(p: SsoHandoffPhase, aud: SsoAudience | null): string {
  const app =
    aud === SSO_AUDIENCE_WBT ? 'WellBuilt Tickets'
      : aud === SSO_AUDIENCE_EQUIPMENT ? 'WellBuilt eQuipment'
        : 'WellBuilt app';
  return p === 'opening' ? `Opening ${app}…` : `Authorizing ${app}…`;
}
