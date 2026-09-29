/**
 * Suite Activity visibility for the ETC PendingIntent send.
 * Fail closed until a host observes AppState 'active'.
 */
let activityVisible = false;

export function noteEtcActivityState(state: string): void {
  activityVisible = state === 'active';
}

export function isEtcActivityVisible(): boolean {
  return activityVisible;
}

export function setEtcActivityVisibleForTests(visible: boolean): void {
  activityVisible = visible;
}
