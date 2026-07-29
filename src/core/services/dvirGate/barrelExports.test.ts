/**
 * Regression: missing named re-exports from the dvirGate barrel become
 * `undefined` at runtime (Metro still bundles). useAppLauncher and
 * DvirReceiptListener call makeDvirSsoGetter during startup — if it is not
 * exported, every authenticated cold start throws:
 *   TypeError: makeDvirSsoGetter is not a function
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('dvirGate barrel exports', () => {
  it('re-exports makeDvirSsoGetter and createSuiteDvirGate from the public index', () => {
    const indexSrc = readFileSync(join(HERE, 'index.ts'), 'utf8');
    // Must be a named re-export line — export * from createSuiteDvirGate is not used
    // because that file also pulls react-native (and export * of type-only can drop).
    assert.match(
      indexSrc,
      /export\s*\{[^}]*\bmakeDvirSsoGetter\b[^}]*\}\s*from\s*['"]\.\/createSuiteDvirGate['"]/,
      'index.ts must named-re-export makeDvirSsoGetter (startup crash if missing)',
    );
    assert.match(
      indexSrc,
      /export\s*\{[^}]*\bcreateSuiteDvirGate\b[^}]*\}\s*from\s*['"]\.\/createSuiteDvirGate['"]/,
      'index.ts must named-re-export createSuiteDvirGate',
    );

    // Definition must exist in the implementation module
    const implSrc = readFileSync(join(HERE, 'createSuiteDvirGate.ts'), 'utf8');
    assert.match(implSrc, /export\s+function\s+makeDvirSsoGetter\b/);
    assert.match(implSrc, /export\s+function\s+createSuiteDvirGate\b/);
  });

  it('startup call sites import makeDvirSsoGetter from the barrel path', () => {
    const launcher = readFileSync(
      join(HERE, '../../hooks/useAppLauncher.ts'),
      'utf8',
    );
    assert.match(launcher, /makeDvirSsoGetter/);
    assert.match(launcher, /from\s+['"]\.\.\/services\/dvirGate['"]/);

    const layout = readFileSync(
      join(HERE, '../../../../app/_layout.tsx'),
      'utf8',
    );
    assert.match(layout, /makeDvirSsoGetter/);
    assert.match(layout, /from\s+['"]@\/core\/services\/dvirGate['"]/);
  });
});
