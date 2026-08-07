/**
 * Keyed equality token for one login submission.
 *
 * Its ONLY job is to answer "is this the same submission as the one
 * already in flight?" so duplicate taps coalesce onto a single exchange
 * while a different name or credential does not. It is never a password
 * hash, never persisted, never transmitted, and never authority for
 * anything.
 *
 * Isolated behind injected crypto ops for the same reason as
 * authSessionCore: the initialization race below is an ordering property
 * and can only be proven by controlling when the random bytes arrive.
 */

/** The crypto primitives this needs. Supplied by expo-crypto in production. */
export interface TokenCryptoOps {
  /** Cryptographically secure random bytes. */
  randomBytes(count: number): Promise<Uint8Array>;
  /** SHA-256 of a UTF-8 string, hex-encoded. */
  sha256(input: string): Promise<string>;
}

export interface AttemptTokenizer {
  /** The equality token for this submission. */
  token(displayName: string, passcode: string): Promise<string>;
}

const PROCESS_KEY_BYTES = 32; // 256 bits

/**
 * Frame a field so concatenation cannot produce an ambiguous tuple.
 *
 * Without framing, ("ab", "c") and ("a", "bc") would digest identically
 * under plain concatenation, and a separator character alone only moves
 * the problem to inputs containing that character. Length-prefixing each
 * field makes the encoding injective for any input whatsoever.
 */
function frame(value: string): string {
  return `${value.length}:${value}`;
}

export function createAttemptTokenizer(ops: TokenCryptoOps): AttemptTokenizer {
  /**
   * Random 256-bit process key, held only in memory. Never persisted,
   * logged, or transmitted; it dies with the process, so a token from one
   * run means nothing in another.
   *
   * Stored as the in-flight PROMISE, not the value. Generation is async,
   * so two submissions arriving before it completes would otherwise each
   * see "not initialized yet" and generate their own key — producing
   * different tokens for identical submissions, which would defeat the
   * coalescing this exists to provide. Holding the promise makes
   * concurrent initialization coalesce onto one key.
   */
  let processKey: Promise<string> | null = null;

  function key(): Promise<string> {
    if (processKey === null) {
      processKey = ops.randomBytes(PROCESS_KEY_BYTES).then((bytes) =>
        Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''),
      );
    }
    return processKey;
  }

  return {
    async token(displayName, passcode) {
      const normalizedName = displayName.trim().toLowerCase();
      // A KEYED digest, not a plain salted one. A passcode is low entropy,
      // so a digest under a knowable salt would be cheap to brute-force;
      // keyed under a secret random value that never leaves memory, it is
      // not. (Not HMAC: the supported crypto boundary here — expo-crypto —
      // exposes digestStringAsync and getRandomBytesAsync but no HMAC, and
      // adding a dependency for the label alone is not worth it. The
      // secret-prefix construction is sound for an in-process equality
      // check with fixed-length key and injectively framed inputs.)
      const digest = await ops.sha256(
        frame(await key()) + frame(normalizedName) + frame(passcode),
      );
      // The normalized name stays in the clear deliberately: the server
      // resolves identity through driver_name_index/{nameNorm} to a single
      // driverId, so it IS the account identifier and is already in local
      // storage. Only the credential component needs concealing.
      return `${normalizedName}#${digest}`;
    },
  };
}
