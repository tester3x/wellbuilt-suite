/**
 * Process-key initialization concurrency and input framing.
 *
 * Run: npm run test:auth-core
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { createAttemptTokenizer, type TokenCryptoOps } from './attemptToken.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((r) => setImmediate(r));

class FakeCrypto {
  randomCalls = 0;
  sha256Calls: string[] = [];
  /** When set, randomBytes parks until released. */
  gate: Deferred<void> | null = null;

  readonly ops: TokenCryptoOps = {
    randomBytes: async (count) => {
      this.randomCalls += 1;
      const nth = this.randomCalls;
      if (this.gate) await this.gate.promise;
      // Distinct bytes per call, so two keys are detectably different.
      return Uint8Array.from({ length: count }, (_, i) => (i + nth * 101) & 0xff);
    },
    sha256: async (input) => {
      this.sha256Calls.push(input);
      return createHash('sha256').update(input, 'utf8').digest('hex');
    },
  };
}

describe('process key initialization', () => {
  it('two simultaneous first-use calls share one key generation', async () => {
    const fake = new FakeCrypto();
    fake.gate = deferred<void>();
    const t = createAttemptTokenizer(fake.ops);

    // Both start BEFORE key generation completes.
    const a = t.token('Driver One', '1234');
    const b = t.token('Driver One', '1234');
    await flush();
    assert.equal(fake.randomCalls, 1, 'the process key must be generated exactly once');

    fake.gate.resolve();
    const [tokenA, tokenB] = await Promise.all([a, b]);

    assert.equal(tokenA, tokenB, 'identical submissions must produce the same token');
    assert.equal(fake.randomCalls, 1);
  });

  it('many concurrent first-use calls still generate one key', async () => {
    const fake = new FakeCrypto();
    fake.gate = deferred<void>();
    const t = createAttemptTokenizer(fake.ops);

    const pending = Array.from({ length: 25 }, () => t.token('Driver One', '1234'));
    await flush();
    fake.gate.resolve();
    const tokens = await Promise.all(pending);

    assert.equal(fake.randomCalls, 1);
    assert.equal(new Set(tokens).size, 1, 'all identical submissions share one token');
  });

  it('the key is generated once per process, not once per call', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);

    await t.token('Driver One', '1234');
    await t.token('Driver Two', '9999');
    await t.token('Driver One', '1234');

    assert.equal(fake.randomCalls, 1);
  });

  it('the key is 256 bits', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);
    let requested = -1;
    const wrapped = createAttemptTokenizer({
      ...fake.ops,
      randomBytes: async (count) => {
        requested = count;
        return fake.ops.randomBytes(count);
      },
    });
    await wrapped.token('Driver One', '1234');
    assert.equal(requested, 32);
    void t;
  });

  it('separate tokenizer instances do not share a key', async () => {
    const fake = new FakeCrypto();
    const one = createAttemptTokenizer(fake.ops);
    const two = createAttemptTokenizer(fake.ops);

    const a = await one.token('Driver One', '1234');
    const b = await two.token('Driver One', '1234');

    assert.equal(fake.randomCalls, 2);
    assert.notEqual(a, b, 'a token from one process must mean nothing in another');
  });
});

describe('token equality semantics', () => {
  it('identical name and credential match; different ones do not', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);

    const base = await t.token('Driver One', '1234');
    assert.equal(await t.token('Driver One', '1234'), base);
    // Normalization: same submission, differently typed.
    assert.equal(await t.token('  driver one  ', '1234'), base);

    assert.notEqual(await t.token('Driver One', '1235'), base, 'credential must matter');
    assert.notEqual(await t.token('Driver Two', '1234'), base, 'name must matter');
  });

  it('framing makes the input encoding injective', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);

    // Without length-prefixed framing, ("ab","c") and ("a","bc") would
    // concatenate to the same material.
    const ab_c = await t.token('ab', 'c');
    const a_bc = await t.token('a', 'bc');
    assert.notEqual(ab_c, a_bc);

    // A separator character appearing inside a field must not confuse it.
    const withSep = await t.token('a:b', 'c');
    const shifted = await t.token('a', ':b:c');
    assert.notEqual(withSep, shifted);

    for (const material of fake.sha256Calls) {
      assert.match(material, /^64:[0-9a-f]{64}\d+:/, 'key must be framed and fixed length');
    }
  });

  it('the credential never appears unframed and the key never leaks into the token', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);
    const token = await t.token('Driver One', 'secret-pass');

    // The token carries the normalized name (deliberately) plus a digest.
    assert.match(token, /^driver one#[0-9a-f]{64}$/);
    assert.ok(!token.includes('secret-pass'), 'the credential must not appear in the token');
    const keyHex = fake.sha256Calls[0].slice(3, 3 + 64);
    assert.ok(!token.includes(keyHex), 'the process key must not appear in the token');
  });

  it('no digest of the credential exists without the secret key', async () => {
    const fake = new FakeCrypto();
    const t = createAttemptTokenizer(fake.ops);
    await t.token('Driver One', '1234');

    for (const material of fake.sha256Calls) {
      assert.ok(
        material.startsWith('64:'),
        'every digest must begin with the framed 256-bit process key',
      );
    }
    assert.equal(fake.sha256Calls.length, 1, 'no second, unkeyed digest is taken');
  });
});
