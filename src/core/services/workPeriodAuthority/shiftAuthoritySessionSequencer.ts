/**
 * Sequences post-login shift-authority resolution behind secure-session
 * readiness. Pure: no I/O, no shift mutations. AuthContext applies the
 * resulting commands.
 *
 * Cold start used to call resolveActiveDriverShift while
 * revalidateDriverSession was still in flight. The callable (or the
 * local session-ready gate) returned driver_session_required, the tile
 * froze on Unavailable, and a later successful revalidation never
 * re-resolved. This reducer is the exactly-once recovery contract.
 */
import type { ShiftAuthorityUiState } from './postLoginShiftRestoration';

export type SessionReadiness = 'pending' | 'ready' | 'failed';

export type AuthorityResolveClass =
  | 'none'
  | 'open'
  | 'driver_session_required'
  | 'transient_failure';

export type AuthoritySessionState = {
  session: SessionReadiness;
  inFlightToken: number | null;
  nextToken: number;
  appliedToken: number;
  ui: ShiftAuthorityUiState;
};

export type AuthoritySessionEvent =
  | { type: 'reset' }
  | { type: 'cold_start' }
  | { type: 'session_ready' }
  | { type: 'session_failed' }
  | {
      type: 'resolve_result';
      token: number;
      result: AuthorityResolveClass;
      open?: { periodId: string; originLocalDate: string };
    }
  | { type: 'retry' };

export type AuthoritySessionCommand = { cmd: 'resolve'; token: number };

export const initialAuthoritySessionState: AuthoritySessionState = {
  session: 'pending',
  inFlightToken: null,
  nextToken: 1,
  appliedToken: 0,
  ui: { kind: 'checking' },
};

function startResolve(state: AuthoritySessionState): {
  state: AuthoritySessionState;
  commands: AuthoritySessionCommand[];
  applyUi: boolean;
} {
  const token = state.nextToken;
  return {
    state: {
      ...state,
      nextToken: token + 1,
      inFlightToken: token,
      ui: { kind: 'checking' },
    },
    commands: [{ cmd: 'resolve', token }],
    applyUi: true,
  };
}

function alreadySettledSuccess(state: AuthoritySessionState): boolean {
  return state.appliedToken > 0 && (state.ui.kind === 'none' || state.ui.kind === 'open');
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
        state: { ...initialAuthoritySessionState },
        commands: [],
        applyUi: true,
      };

    case 'session_failed':
      return {
        state: {
          ...state,
          session: 'failed',
          inFlightToken: null,
          nextToken: state.nextToken + 1,
          ui: { kind: 'unavailable', reason: 'revalidation_failed' },
        },
        commands: [],
        applyUi: true,
      };

    case 'session_ready': {
      const next: AuthoritySessionState = { ...state, session: 'ready' };
      if (next.inFlightToken !== null) {
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
      if (state.inFlightToken !== null) {
        return { state, commands: [], applyUi: false };
      }
      return startResolve(state);
    }

    case 'resolve_result': {
      if (event.token !== state.inFlightToken) {
        return { state, commands: [], applyUi: false };
      }
      if (event.token <= state.appliedToken) {
        return {
          state: { ...state, inFlightToken: null },
          commands: [],
          applyUi: false,
        };
      }

      if (event.result === 'driver_session_required' && state.session === 'pending') {
        return {
          state: {
            ...state,
            inFlightToken: null,
            ui: { kind: 'checking' },
          },
          commands: [],
          applyUi: true,
        };
      }

      if (event.result === 'none') {
        return {
          state: {
            ...state,
            inFlightToken: null,
            appliedToken: event.token,
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
            inFlightToken: null,
            appliedToken: event.token,
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
          inFlightToken: null,
          appliedToken: event.token,
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
