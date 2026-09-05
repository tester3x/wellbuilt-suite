/**
 * Durable inbound authorize inbox.
 *
 * Android can deliver wellbuilt-suite://sso-authorize as a pending
 * onNewIntent while Suite is STOPPED (task reuse). Linking then only
 * surfaces the URL if/when the activity resumes — or not at all if a
 * counterpart permission overlay wins the foreground. This inbox:
 *
 *   - accepts initial URL, runtime URL, and resume replays;
 *   - deduplicates identical deliveries;
 *   - holds one pending authorize until the authenticated session is ready;
 *   - dispatches exactly once;
 *   - fails closed if revalidation failed;
 *   - fences stale generations so logout cannot issue.
 *
 * Pure: dispatch is injected. Never logs URL query material.
 */
import { isSsoAuthorizeUrl } from './ssoRouteAdapter';

export type SsoSessionGate = 'pending' | 'ready' | 'failed';
export type SsoDeliverPath = 'initial' | 'runtime' | 'resume' | 'onNewIntent';

export type SsoInboxState = {
  gate: SsoSessionGate;
  generation: number;
  queued: string | null;
  inFlightToken: number | null;
  nextToken: number;
  handled: string | null;
};

export type SsoInboxEvent =
  | { type: 'reset' }
  | { type: 'session'; gate: SsoSessionGate }
  | { type: 'deliver'; url: string; path: SsoDeliverPath }
  | { type: 'dispatched'; token: number };

export type SsoInboxCommand =
  | { cmd: 'dispatch'; url: string; token: number }
  // `url` present ⇒ a real queued authorize request that must receive a bounded
  // terminal error callback (never a code). Absent / `not_sso` ⇒ log-only.
  | { cmd: 'reject_closed'; reason: 'revalidation_failed' | 'not_sso'; url?: string };

export const initialSsoInboxState: SsoInboxState = {
  gate: 'pending',
  generation: 0,
  queued: null,
  inFlightToken: null,
  nextToken: 1,
  handled: null,
};

function dispatchQueued(state: SsoInboxState): {
  state: SsoInboxState;
  commands: SsoInboxCommand[];
} {
  if (state.gate !== 'ready' || !state.queued || state.inFlightToken !== null) {
    return { state, commands: [] };
  }
  const token = state.nextToken;
  const url = state.queued;
  return {
    state: {
      ...state,
      queued: null,
      inFlightToken: token,
      nextToken: token + 1,
      handled: url,
    },
    commands: [{ cmd: 'dispatch', url, token }],
  };
}

export function reduceSsoInbox(
  state: SsoInboxState,
  event: SsoInboxEvent,
): { state: SsoInboxState; commands: SsoInboxCommand[] } {
  switch (event.type) {
    case 'reset':
      return {
        state: { ...initialSsoInboxState, generation: state.generation + 1 },
        commands: [],
      };

    case 'session': {
      if (event.gate === 'failed') {
        // A queued request that never dispatched is terminally stranded — return
        // its bounded error callback so WB-E is not left on "handoff incomplete".
        const stranded = state.queued;
        return {
          state: {
            ...state,
            gate: 'failed',
            queued: null,
            inFlightToken: null,
            handled: stranded ?? state.handled,
            generation: state.generation + 1,
          },
          commands: [
            { cmd: 'reject_closed', reason: 'revalidation_failed', url: stranded ?? undefined },
          ],
        };
      }
      const next = { ...state, gate: event.gate };
      if (event.gate === 'ready') return dispatchQueued(next);
      return { state: next, commands: [] };
    }

    case 'deliver': {
      if (!isSsoAuthorizeUrl(event.url)) {
        return { state, commands: [{ cmd: 'reject_closed', reason: 'not_sso' }] };
      }
      if (state.handled === event.url || state.queued === event.url) {
        return { state, commands: [] };
      }
      if (state.gate === 'failed') {
        // Arriving into a terminally-failed generation: emit the bounded error
        // callback once (dedupe by `handled`) — never a code.
        if (state.handled === event.url) return { state, commands: [] };
        return {
          state: { ...state, handled: event.url },
          commands: [{ cmd: 'reject_closed', reason: 'revalidation_failed', url: event.url }],
        };
      }
      const next = { ...state, queued: event.url };
      return dispatchQueued(next);
    }

    case 'dispatched': {
      if (event.token !== state.inFlightToken) {
        return { state, commands: [] };
      }
      return { state: { ...state, inFlightToken: null }, commands: [] };
    }
  }
}

export function createSsoAuthorizeInbox() {
  let state: SsoInboxState = { ...initialSsoInboxState };
  return {
    peek(): SsoInboxState {
      return state;
    },
    dispatch(event: SsoInboxEvent) {
      const reduced = reduceSsoInbox(state, event);
      state = reduced.state;
      return reduced;
    },
    reset() {
      const reduced = reduceSsoInbox(state, { type: 'reset' });
      state = reduced.state;
      return reduced;
    },
  };
}

const liveInbox = createSsoAuthorizeInbox();
let liveDispatch: (url: string) => Promise<unknown> = async () => {};
// Terminal-error dispatch: routes a stranded authorize URL through the normal
// SSO handler, which (because reconciliation is NOT verified — the reason the
// gate is failed) short-circuits to a bounded credential-free error callback in
// ssoAuthorizationCore and issues NO code.
let liveTerminalDispatch: (url: string) => Promise<unknown> = async () => {};

export function bindSsoAuthorizeDispatch(fn: (url: string) => Promise<unknown>): void {
  liveDispatch = fn;
}

export function bindSsoTerminalDispatch(fn: (url: string) => Promise<unknown>): void {
  liveTerminalDispatch = fn;
}

async function runInboxCommands(commands: SsoInboxCommand[]): Promise<void> {
  for (const command of commands) {
    if (command.cmd === 'dispatch') {
      try {
        await liveDispatch(command.url);
      } finally {
        liveInbox.dispatch({ type: 'dispatched', token: command.token });
      }
    } else if (command.cmd === 'reject_closed') {
      if (command.reason === 'revalidation_failed' && command.url) {
        // Real queued request reached a terminal authority failure: return the
        // bounded error callback to the fixed audience so WB-E is not stranded.
        console.log('[sso] sso.route.terminal_error: revalidation_failed');
        await liveTerminalDispatch(command.url);
      } else {
        // not_sso, or a failed transition with nothing queued — log only.
        console.log(`[sso] sso.route.queued_closed: ${command.reason}`);
      }
    }
  }
}

export function acceptSsoAuthorizeUrl(
  url: string | null | undefined,
  path: SsoDeliverPath,
): void {
  if (!url) return;
  const { commands } = liveInbox.dispatch({ type: 'deliver', url, path });
  void runInboxCommands(commands);
}

export function notifySsoInboxSession(gate: SsoSessionGate): void {
  const { commands } = liveInbox.dispatch({ type: 'session', gate });
  void runInboxCommands(commands);
}

export function resetLiveSsoAuthorizeInbox(): void {
  liveInbox.reset();
}
