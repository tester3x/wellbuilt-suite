/**
 * Structural proof: HomeScreen hooks run before any session early return.
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
  test(`${rel}: no hooks after session guard; workhorse is the only functional source`, () => {
    const src = readFileSync(join(root, rel), 'utf8');
    const guardCandidates = [
      'if (!home.session) return null',
      'if (!user) return null',
      'if (!session) return null',
    ];
    const guard = Math.max(...guardCandidates.map((needle) => src.indexOf(needle)));
    assert.ok(guard > 0, 'early return present');
    const after = src.slice(guard);
    assert.ok(!/\buseCallback\s*\(/.test(after), 'useCallback after guard');
    assert.ok(!/\buseState\s*\(/.test(after), 'useState after guard');
    assert.ok(!/\buseEffect\s*\(/.test(after), 'useEffect after guard');
    assert.ok(!/\buseRef\s*\(/.test(after), 'useRef after guard');
    const workhorse = src.indexOf('useHomeWorkhorse');
    assert.ok(workhorse > 0 && workhorse < guard, 'useHomeWorkhorse before guard');
  });
}
