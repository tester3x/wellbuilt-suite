import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();

function readIfExists(rel: string): string | null {
  const fp = join(root, rel);
  return existsSync(fp) ? readFileSync(fp, 'utf8') : null;
}

describe('AppSwitcher render path (WB-S)', () => {
  it('does not render a floating switcher', () => {
    assert.equal(existsSync(join(root, 'src/core/components/AppSwitcher.tsx')), false);
    assert.equal(existsSync(join(root, 'src/core/components/appSwitcherCompanyLookup.ts')), false);
    const layout = readIfExists('app/_layout.tsx') || '';
    const srcLayout = readIfExists('src/app/_layout.tsx') || '';
    assert.doesNotMatch(layout + srcLayout, /from ['"].*AppSwitcher['"]/);
    assert.doesNotMatch(layout + srcLayout, /<AppSwitcher/);
  });

  it('hub home still opens the supported app links', () => {
    const apps = readFileSync(join(root, 'src/core/data/apps.ts'), 'utf8');
    const home = readFileSync(join(root, 'src/ui/v4-widget/screens/HomeScreen.tsx'), 'utf8');
    const actions = readFileSync(join(root, 'src/ui/shared/ActionCardRow.tsx'), 'utf8');
    assert.match(apps, /wellbuilt-mobile/);
    assert.match(apps, /wellbuilt-tickets/);
    assert.match(apps, /jsaapp/);
    assert.match(home, /wellbuiltApps/);
    assert.match(actions, /wbequipment/);
  });
});
