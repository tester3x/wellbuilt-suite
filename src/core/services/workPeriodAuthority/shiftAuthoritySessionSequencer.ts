/**
 * Sequences post-login shift-authority resolution behind secure-session
 * readiness. Pure: no I/O, no shift mutations. AuthContext applies the
 * resulting commands.
 *
 * Resolve ownership is a generation-tagged monotonic lease. reset and
 * cold_start increment generation and never recycle nextToken, so an old
 * generation's token 1 cannot match a new generation's in-flight lease.
 */
import type { ShiftAuthorityUiState } from './postLoginShiftRestoration';

export type SessionReadiness = 'pending' | 'ready' | 'failed';

export type AuthorityResolveClass =
  | 'none'
  | 'open'
  | 'driver_session_required'
  | 'transient_failure';

export type AuthorityResolveLease = {
  generation: number;
  token: number;
};

export type AuthoritySessionState = {
  session: SessionReadiness;
  generation: number;
  inFlight: AuthorityResolveLease | null;
  nextToken: number;
  applied: AuthorityResolveLease | null;
  ui: ShiftAuthorityUiState;
};

export type AuthoritySessionEvent =
  | { type: 'reset' }
  | { type: 'cold_start' }
  | { type: 'session_ready' }
  | { type: 'session_failed' }
  | {
      type: 'resolve_result';
      generation: number;
      token: number;
      result: AuthorityResolveClass;
      open?: { periodId: string; originLocalDate: string };
    }
  | { type: 'retry' };

export type AuthoritySessionCommand = {
  cmd: 'resolve';
  generation: number;
  token: number;
};

export const initialAuthoritySessionState: AuthoritySessionState = {
  session: 'pending',
  generation: 0,
  inFlight: null,
  nextToken: 1,
  applied: null,
  ui: { kind: 'checking' },
};

export function leasesEqual(
  a: AuthorityResolveLease | null | undefined,
  b: { generation: number; token: number } | null | undefined,
): boolean {
  return !!a && !!b && a.generation === b.generation && a.token === b.token;
}

function startResolve(state: AuthoritySessionState): {
  state: AuthoritySessionState;
  commands: AuthoritySessionCommand[];
  applyUi: boolean;
} {
  const lease: AuthorityResolveLease = {
    generation: state.generation,
    token: state.nextToken,
  };
  return {
    state: {
      ...state,
      nextToken: lease.token + 1,
      inFlight: lease,
      ui: { kind: 'checking' },
    },
    commands: [{ cmd: 'resolve', generation: lease.generation, token: lease.token }],
    applyUi: true,
  };
}

function alreadySettledSuccess(state: AuthoritySessionState): boolean {
  return !!state.applied && (state.ui.kind === 'none' || state.ui.kind === 'open');
}

function beginEpoch(state: AuthoritySessionState): AuthoritySessionState {
  return {
    session: 'pending',
    generation: state.generation + 1,
    inFlight: null,
    nextToken: state.nextToken,
    applied: null,
    ui: { kind: 'checking' },
  };
}

export function reduceAuthoritySession(
  state: AuthoritySessionState,
  event: AuthoritySessionEvent,
): {
  state: AuthoritySessionState;
  commands: AuthoritySessionCommand[];
  applyUi: boolean;
} {
  switch (event.type) {
    case 'reset':
    case 'cold_start':
      return {
        state: beginEpoch(state),
        commands: [],
        applyUi: true,
      };

    case 'session_failed':
      return {
        state: {
          ...state,
          session: 'failed',
          inFlight: null,
          ui: { kind: 'unavailable', reason: 'revalidation_failed' },
        },
        commands: [],
        applyUi: true,
      };

    case 'session_ready': {
      const next: AuthoritySessionState = { ...state, session: 'ready' };
      if (next.inFlight !== null) {
        return { state: next, commands: [], applyUi: false };
      }
      if (alreadySettledSuccess(next)) {
        return { state: next, commands: [], applyUi: false };
      }
      return startResolve(next);
    }

    case 'retry': {
      if (state.session === 'failed') {
        return {
          state: {
            ...state,
            ui: { kind: 'unavailable', reason: 'revalidation_failed' },
          },
          commands: [],
          applyUi: true,
        };
      }
      if (state.session === 'pending') {
        return {
          state: { ...state, ui: { kind: 'checking' } },
          commands: [],
          applyUi: true,
        };
      }
      if (state.inFlight !== null) {
        return { state, commands: [], applyUi: false };
      }
      return startResolve(state);
    }

    case 'resolve_result': {
      if (!leasesEqual(state.inFlight, event)) {
        return { state, commands: [], applyUi: false };
      }
      if (event.generation !== state.generation) {
        return { state, commands: [], applyUi: false };
      }
      if (state.applied && event.token <= state.applied.token && event.generation === state.applied.generation) {
        return {
          state: { ...state, inFlight: null },
          commands: [],
          applyUi: false,
        };
      }

      if (event.result === 'driver_session_required' && state.session === 'pending') {
        return {
          state: {
            ...state,
            inFlight: null,
            ui: { kind: 'checking' },
          },
          commands: [],
          applyUi: true,
        };
      }

      const applied: AuthorityResolveLease = {
        generation: event.generation,
        token: event.token,
      };

      if (event.result === 'none') {
        return {
          state: {
            ...state,
            inFlight: null,
            applied,
            ui: { kind: 'none' },
          },
          commands: [],
          applyUi: true,
        };
      }
      if (event.result === 'open' && event.open) {
        return {
          state: {
            ...state,
            inFlight: null,
            applied,
            ui: {
              kind: 'open',
              periodId: event.open.periodId,
              originLocalDate: event.open.originLocalDate,
            },
          },
          commands: [],
          applyUi: true,
        };
      }
      const reason =
        event.result === 'driver_session_required'
          ? 'driver_session_required'
          : 'authority_transient';
      return {
        state: {
          ...state,
          inFlight: null,
          applied,
          ui: { kind: 'unavailable', reason },
        },
        commands: [],
        applyUi: true,
      };
    }
  }
}

export function classifyAuthorityResolveUi(ui: ShiftAuthorityUiState): AuthorityResolveClass {
  if (ui.kind === 'none') return 'none';
  if (ui.kind === 'open') return 'open';
  if (ui.kind === 'unavailable' && /driver_session_required/.test(ui.reason)) {
    return 'driver_session_required';
  }
  return 'transient_failure';
}

export function createAuthoritySessionMachine(
  initial: AuthoritySessionState = initialAuthoritySessionState,
) {
  let state = initial;
  return {
    peek(): AuthoritySessionState {
      return state;
    },
    dispatch(event: AuthoritySessionEvent) {
      const reduced = reduceAuthoritySession(state, event);
      state = reduced.state;
      return reduced;
    },
    reset() {
      const reduced = reduceAuthoritySession(state, { type: 'reset' });
      state = reduced.state;
      return reduced;
    },
  };
}
