/**
 * Separate from shift success. The shift card does not change shape;
 * listeners may show this one line of honest ETC copy.
 */
type Listener = (text: string | null) => void;

let current: string | null = null;
const listeners = new Set<Listener>();

export function publishEtcNotice(text: string | null): void {
  current = text && text.trim() ? text : null;
  for (const listener of listeners) listener(current);
}

export function subscribeEtcNotice(listener: Listener): () => void {
  listener(current);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function currentEtcNotice(): string | null {
  return current;
}

export function resetEtcNoticeForTests(): void {
  current = null;
  listeners.clear();
}
