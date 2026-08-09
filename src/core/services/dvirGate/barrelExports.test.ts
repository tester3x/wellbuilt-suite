/**
 * Barrel re-exports for dvirGate. makeDvirSsoGetter remains exported for
 * non-governed legacy inventory but must NOT appear on governed DVIR launch
 * callsites (Start Shift / Post-Trip / Tickets gate).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('dvirGate barrel exports', () => {
  it('re-exports createSuiteDvirGate from the public index', () => {
    const indexSrc = readFileSync(join(HERE, 'index.ts'), 'utf8');
    assert.match(
      indexSrc,
      /export\s*\{[^}]*\bcreateSuiteDvirGate\b[^}]*\}\s*from\s*['"]\.\/createSuiteDvirGate['"]/,
    );
    const implSrc = readFileSync(join(HERE, 'createSuiteDvirGate.ts'), 'utf8');
    assert.match(implSrc, /export\s+function\s+createSuiteDvirGate\b/);
  });

  it('governed production launch paths never wire getSso/makeDvirSsoGetter', () => {
    const launcher = readFileSync(join(HERE, '../../hooks/useAppLauncher.ts'), 'utf8');
    assert.doesNotMatch(launcher, /getSso\s*:/);
    assert.doesNotMatch(launcher, /makeDvirSsoGetter\s*\(/);
    const action = readFileSync(join(HERE, '../../../ui/shared/ActionCardRow.tsx'), 'utf8');
    assert.doesNotMatch(action, /getSso\s*:/);
    assert.doesNotMatch(action, /makeDvirSsoGetter/);
    const auth = readFileSync(join(HERE, '../../context/AuthContext.tsx'), 'utf8');
    assert.doesNotMatch(auth, /makeDvirSsoGetter/);
    assert.doesNotMatch(auth, /getSso\s*:/);
    // launchEquipmentPhase must not put hash in URL
    const svc = readFileSync(join(HERE, 'dvirGateService.ts'), 'utf8');
    assert.match(svc, /Explicitly omit hash/);
    assert.match(svc, /rememberGovernedEquipmentHandoff/);
  });
});
