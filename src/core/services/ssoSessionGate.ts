/**
 * Authenticated-session readiness for inbound SSO authorize.
 * AuthContext publishes; the authorize inbox subscribes.
 * Reason codes only — never tokens or identities.
 */
import type { SsoSessionGate } from './ssoAuthorizeInbox';

type Listener = (gate: SsoSessionGate) => void;

let gate: SsoSessionGate = 'pending';
const listeners = new Set<Listener>();

export function getSsoSessionGate(): SsoSessionGate {
  return gate;
}

export function setSsoSessionGate(next: SsoSessionGate): void {
  if (gate === next) return;
  gate = next;
  for (const listener of listeners) listener(gate);
}

export function subscribeSsoSessionGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test-only. */
export function __resetSsoSessionGateForTests(): void {
  gate = 'pending';
  listeners.clear();
}
