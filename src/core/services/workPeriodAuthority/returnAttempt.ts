/**
 * Return-attempt identity (client-minted).
 *
 * A driver can start a return-to-yard drive, divert to a new job, then start
 * and divert ANOTHER return in the SAME shift. Each such attempt needs its own
 * identity so the governed server callables key idempotency on
 * (type, periodId, attemptId): a repeated tap of one attempt no-ops, while a
 * second attempt gets its own depart_return and its own return_abandoned.
 *
 * The id is minted when the return starts and persisted (SecureStore) so it
 * survives an app restart and is reused for that attempt's abandonment. It is
 * opaque to the server, which only validates its shape — the regex here MUST
 * stay in lock-step with ATTEMPT_ID_PATTERN on the server
 * (functions/src/security/operational/shiftAuthority.ts).
 */
export const RETURN_ATTEMPT_ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

export function isReturnAttemptId(v: unknown): v is string {
  return typeof v === 'string' && RETURN_ATTEMPT_ID_RE.test(v);
}

/**
 * Mint a fresh attempt id for a return that starts in `periodId`. Deterministic
 * given `now`/`rand` (injected for tests). periodId already uses only safe
 * chars (digits, '-', '_'); the timestamp/random suffix keeps two returns in
 * the same period distinct. Clamped to the 80-char server ceiling.
 */
export function mintReturnAttemptId(
  periodId: string,
  now: number = Date.now(),
  rand: () => number = Math.random,
): string {
  const ts = Math.floor(now).toString(36);
  const r = Math.floor(rand() * 1e9).toString(36);
  // Keep 'ret-' prefix + a bounded suffix; if periodId were ever long, the
  // slice guarantees we never exceed the server ceiling while staying in the
  // safe charset (slicing a safe string yields a safe string).
  return `ret-${periodId}-${ts}${r}`.slice(0, 80);
}
