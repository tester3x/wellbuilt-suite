/**
 * Structural proof: HomeScreen hooks run before any `if (!user) return null`.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const SKINS = [
  'src/ui/v1-grid/screens/HomeScreen.tsx',
  'src/ui/v2-dashboard/screens/HomeScreen.tsx',
  'src/ui/v3-sidebar/screens/HomeScreen.tsx',
  'src/ui/v4-widget/screens/HomeScreen.tsx',
];

for (const rel of SKINS) {
  test(`${rel}: no hooks after if (!user) return null`, () => {
    const src = readFileSync(join(root, rel), 'utf8');
    const guard = src.indexOf('if (!user) return null');
    assert.ok(guard > 0, 'early return present');
    const after = src.slice(guard);
    // Hooks that must not appear after the guard
    assert.ok(!/\buseCallback\s*\(/.test(after), 'useCallback after guard');
    assert.ok(!/\buseState\s*\(/.test(after), 'useState after guard');
    assert.ok(!/\buseEffect\s*\(/.test(after), 'useEffect after guard');
    assert.ok(!/\buseRef\s*\(/.test(after), 'useRef after guard');
    // handleArrived must be defined before guard
    const arrived = src.indexOf('const handleArrived = useCallback');
    assert.ok(arrived > 0 && arrived < guard, 'handleArrived before guard');
  });
}
