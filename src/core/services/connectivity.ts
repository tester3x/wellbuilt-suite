// src/core/services/connectivity.ts
// Network connectivity monitoring for WellBuilt Suite
//
// Simpler than WB T/WB M since Suite is primarily a hub/launcher.
// No packet queue needed — just connectivity state + listeners.

import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

let _isOnline = true;
let _listeners: Array<(online: boolean) => void> = [];
let _unsubscribeNetInfo: (() => void) | null = null;

export function isOnline(): boolean {
  return _isOnline;
}

/** Subscribe to online/offline state changes. Returns unsubscribe function. */
export function onConnectivityChange(listener: (online: boolean) => void): () => void {
  _listeners.push(listener);
  return () => {
    _listeners = _listeners.filter(l => l !== listener);
  };
}

/** Start monitoring network state. Call once at app startup. */
export function startConnectivityMonitor(): void {
  if (_unsubscribeNetInfo) return;

  _unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
    const nowOnline = state.isConnected === true && state.isInternetReachable !== false;

    if (_isOnline !== nowOnline) {
      _isOnline = nowOnline;
      console.log(`[Connectivity-Suite] Status changed: ${nowOnline ? 'ONLINE' : 'OFFLINE'}`);
      for (const listener of _listeners) {
        try { listener(nowOnline); } catch {}
      }
    }
  });

  // Initial check
  NetInfo.fetch().then((state) => {
    _isOnline = state.isConnected === true && state.isInternetReachable !== false;
    console.log(`[Connectivity-Suite] Initial status: ${_isOnline ? 'ONLINE' : 'OFFLINE'}`);
  });

  console.log('[Connectivity-Suite] Monitor started');
}

/** Stop monitoring (cleanup). */
export function stopConnectivityMonitor(): void {
  if (_unsubscribeNetInfo) {
    _unsubscribeNetInfo();
    _unsubscribeNetInfo = null;
  }
}
