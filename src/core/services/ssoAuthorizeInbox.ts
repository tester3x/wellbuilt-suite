/**
 * Durable inbound authorize inbox.
 *
 * Holds one pending authorize until the authenticated session is ready,
 * and for the equipment audience until server-authoritative shift + matching
 * governed handoff are present. Dispatches exactly once. Terminal failures
 * return a bounded error callback via an issuance-incapable responder.
 *
 * Pure: dispatch / terminal dispatch are injected. Never logs URL query material.
 */
import { isSsoAuthorizeUrl } from './ssoRouteAdapter';
import { isSsoAudience, parseSsoAuthorizationUrl, SSO_AUDIENCE_EQUIPMENT } from './ssoProtocol.generated';
import type { EquipmentRelease } from './ssoEquipmentAuthority';
import type { SsoTerminalReason } from './ssoTerminalResponder';

export type SsoSessionGate = 'pending' | 'ready' | 'failed';
export type SsoDeliverPath = 'initial' | 'runtime' | 'resume' | 'onNewIntent';

export type SsoInboxState = {
  gate: SsoSessionGate;
  equipment: EquipmentRelease;
  generation: number;
  queued: string | null;
  inFlightToken: number | null;
  nextToken: number;
  handled: string | null;
  /** Survives reset so a terminally answered URL cannot re-enter issuance. */
  terminalClosed: readonly string[];
};

export type SsoInboxEvent =
  | { type: 'reset' }
  | {
      type: 'session';
      gate: SsoSessionGate;
      equipment?: EquipmentRelease;
      terminalReason?: SsoTerminalReason;
    }
  | { type: 'deliver'; url: string; path: SsoDeliverPath }
  | { type: 'dispatched'; token: number };

export type SsoInboxCommand =
  | { cmd: 'dispatch'; url: string; token: number }
  | { cmd: 'reject_closed'; reason: SsoTerminalReason; url?: string };

export const initialSsoInboxState: SsoInboxState = {
  gate: 'pending',
  equipment: 'pending',
  generation: 0,
  queued: null,
  inFlightToken: null,
  nextToken: 1,
  handled: null,
  terminalClosed: [],
};

function isEquipmentAuthorizeUrl(url: string): boolean {
  const parsed = parseSsoAuthorizationUrl(url);
  if (parsed.ok) return parsed.value.audience === SSO_AUDIENCE_EQUIPMENT;
  // Scheme/host already matched. Read allowlisted `aud` only — never log.
  const qAt = url.indexOf('?');
  if (qAt < 0) return false;
  const params = new URLSearchParams(url.slice(qAt + 1));
  const aud = params.get('aud');
  return isSsoAudience(aud) && aud === SSO_AUDIENCE_EQUIPMENT;
}

function closeUrl(state: SsoInboxState, url: string | null): readonly string[] {
  if (!url) return state.terminalClosed;
  if (state.terminalClosed.includes(url)) return state.terminalClosed;
  return [...state.terminalClosed, url];
}

function dispatchQueued(state: SsoInboxState): {
  state: SsoInboxState;
  commands: SsoInboxCommand[];
} {
  if (!state.queued || state.inFlightToken !== null) {
    return { state, commands: [] };
  }
  if (state.gate === 'failed') {
    return { state, commands: [] };
  }
  const equipmentUrl = isEquipmentAuthorizeUrl(state.queued);
  if (equipmentUrl) {
    if (state.gate !== 'ready') return { state, commands: [] };
    if (state.equipment === 'pending') return { state, commands: [] };
    if (state.equipment !== 'open') {
      const url = state.queued;
      return {
        state: {
          ...state,
          queued: null,
          handled: url,
          terminalClosed: closeUrl(state, url),
        },
        commands: [{ cmd: 'reject_closed', reason: 'equipment_unavailable', url }],
      };
    }
  } else if (state.gate !== 'ready') {
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
        state: {
          ...initialSsoInboxState,
          generation: state.generation + 1,
          terminalClosed: state.terminalClosed,
        },
        commands: [],
      };

    case 'session': {
      const next: SsoInboxState = {
        ...state,
        gate: event.gate,
        equipment: event.equipment ?? state.equipment,
      };
      if (event.gate === 'failed') {
        const stranded = next.queued;
        const reason: SsoTerminalReason = event.terminalReason ?? 'revalidation_failed';
        return {
          state: {
            ...next,
            queued: null,
            inFlightToken: null,
            handled: stranded ?? next.handled,
            generation: next.generation + 1,
            terminalClosed: closeUrl(next, stranded),
          },
          commands: [
            {
              cmd: 'reject_closed',
              reason,
              url: stranded ?? undefined,
            },
          ],
        };
      }
      return dispatchQueued(next);
    }

    case 'deliver': {
      if (!isSsoAuthorizeUrl(event.url)) {
        return { state, commands: [{ cmd: 'reject_closed', reason: 'not_sso' }] };
      }
      if (state.terminalClosed.includes(event.url)) {
        return { state, commands: [] };
      }
      if (state.handled === event.url || state.queued === event.url) {
        return { state, commands: [] };
      }
      if (state.gate === 'failed') {
        return {
          state: {
            ...state,
            handled: event.url,
            terminalClosed: closeUrl(state, event.url),
          },
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
  let state: SsoInboxState = { ...initialSsoInboxState, terminalClosed: [] };
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
let liveTerminal: (url: string, reason: SsoTerminalReason) => Promise<unknown> = async () => {};

export function bindSsoAuthorizeDispatch(fn: (url: string) => Promise<unknown>): void {
  liveDispatch = fn;
}

export function bindSsoTerminalDispatch(
  fn: (url: string, reason: SsoTerminalReason) => Promise<unknown>,
): void {
  liveTerminal = fn;
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
      if (command.reason === 'not_sso' || !command.url) {
        console.log(`[sso] sso.route.queued_closed: ${command.reason}`);
      } else {
        await liveTerminal(command.url, command.reason);
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

export function notifySsoInboxSession(
  gate: SsoSessionGate,
  equipment?: EquipmentRelease,
  terminalReason?: SsoTerminalReason,
): void {
  const { commands } = liveInbox.dispatch({ type: 'session', gate, equipment, terminalReason });
  void runInboxCommands(commands);
}

export function resetLiveSsoAuthorizeInbox(): void {
  liveInbox.reset();
}

/** Test-only: inspect the live inbox without exposing URL query material in production. */
export function __peekLiveSsoAuthorizeInboxForTests(): SsoInboxState {
  return liveInbox.peek();
}
