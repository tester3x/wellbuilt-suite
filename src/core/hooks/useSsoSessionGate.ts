import { useSyncExternalStore } from 'react';
import { getSsoSessionGate, subscribeSsoSessionGate } from '../services/ssoSessionGate';

/** Includes verified Firebase reconciliation, beyond optimistic local login. */
export function useSsoSessionGate() {
  return useSyncExternalStore(subscribeSsoSessionGate, getSsoSessionGate, getSsoSessionGate);
}
