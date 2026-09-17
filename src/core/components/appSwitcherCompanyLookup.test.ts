import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  filterAppsForTier,
  isAppAvailableForTier,
  loadAppSwitcherCompanyFields,
  pickAppSwitcherTier,
  resolveAppSwitcherTier,
  type AppSwitcherCompanyReader,
  type AppSwitcherCompanySnap,
} from './appSwitcherCompanyLookup';

function reader(
  docs: Record<string, AppSwitcherCompanySnap>,
  calls: string[] = [],
): AppSwitcherCompanyReader {
  return async (collection, companyId) => {
    calls.push(`${collection}/${companyId}`);
    const hit = docs[`${collection}/${companyId}`];
    if (!hit) return { exists: false };
    return hit;
  };
}

const APPS = [
  { id: 'wbs', requiredTier: 'free', deepLinkScheme: 'wellbuilt-suite', enabled: true },
  { id: 'wbm', requiredTier: 'free', deepLinkScheme: 'wellbuilt-mobile', enabled: true },
  { id: 'wbt', requiredTier: 'field', deepLinkScheme: 'wellbuilt-tickets', enabled: true },
  { id: 'wbe', requiredTier: 'field', deepLinkScheme: 'wbequipment', enabled: true },
];

describe('pickAppSwitcherTier', () => {
  it('reads only tier from a fat document', () => {
    assert.equal(
      pickAppSwitcherTier({
        tier: 'field',
        name: 'Liquid Gold',
        rateSheets: { x: 1 },
        payConfig: { defaultSplit: 0.25 },
        address: 'secret',
      }),
      'field',
    );
  });

  it('malformed or missing tier is null', () => {
    assert.equal(pickAppSwitcherTier(null), null);
    assert.equal(pickAppSwitcherTier({ tier: 3 }), null);
    assert.equal(pickAppSwitcherTier({ tier: '' }), null);
    assert.equal(pickAppSwitcherTier({ name: 'Acme' }), null);
  });
});

describe('loadAppSwitcherCompanyFields', () => {
  it('public document success — does not read companies', async () => {
    const calls: string[] = [];
    const result = await loadAppSwitcherCompanyFields(
      'liquid-gold',
      reader(
        {
          'public_companies/liquid-gold': {
            exists: true,
            data: { tier: 'god', rateSheets: { leak: true }, address: 'nope' },
          },
          'companies/liquid-gold': { exists: true, data: { tier: 'free' } },
        },
        calls,
      ),
    );
    assert.deepEqual(result, { source: 'public_companies', tier: 'god' });
    assert.deepEqual(calls, ['public_companies/liquid-gold']);
    assert.equal(resolveAppSwitcherTier(result), 'god');
  });

  it('missing public document falls back to companies', async () => {
    const calls: string[] = [];
    const result = await loadAppSwitcherCompanyFields(
      'acme',
      reader(
        {
          'public_companies/acme': { exists: false },
          'companies/acme': { exists: true, data: { tier: 'field', payConfig: { defaultSplit: 0.4 } } },
        },
        calls,
      ),
    );
    assert.deepEqual(result, { source: 'companies', tier: 'field' });
    assert.deepEqual(calls, ['public_companies/acme', 'companies/acme']);
    assert.equal(resolveAppSwitcherTier(result), 'field');
  });

  it('malformed public document does not fall back to companies', async () => {
    const calls: string[] = [];
    const result = await loadAppSwitcherCompanyFields(
      'odd',
      reader(
        {
          'public_companies/odd': { exists: true, data: { tier: { nested: true }, address: 'x' } },
          'companies/odd': { exists: true, data: { tier: 'god' } },
        },
        calls,
      ),
    );
    assert.equal(result.source, 'public_companies');
    assert.equal(result.tier, null);
    assert.deepEqual(calls, ['public_companies/odd']);
    assert.equal(resolveAppSwitcherTier(result), 'free');
  });

  it('arbitrary public-read error does not fall back to companies', async () => {
    const calls: string[] = [];
    const throwing: AppSwitcherCompanyReader = async (collection, id) => {
      calls.push(`${collection}/${id}`);
      if (collection === 'public_companies') throw new Error('permission-denied');
      return { exists: true, data: { tier: 'field' } };
    };
    await assert.rejects(() => loadAppSwitcherCompanyFields('x', throwing), /permission-denied/);
    assert.deepEqual(calls, ['public_companies/x']);
  });

  it('neither document → none, keep default tier', async () => {
    const result = await loadAppSwitcherCompanyFields('missing', reader({}));
    assert.deepEqual(result, { source: 'none', tier: null });
    assert.equal(resolveAppSwitcherTier(result), null);
  });
});

describe('app availability by tier', () => {
  it('god can launch field apps; free cannot', () => {
    assert.equal(isAppAvailableForTier('field', 'god'), true);
    assert.equal(isAppAvailableForTier('field', 'free'), false);
    assert.equal(isAppAvailableForTier('free', 'free'), true);
  });

  it('filterAppsForTier hides self scheme and field apps on free', () => {
    const free = filterAppsForTier(APPS, 'free', 'wellbuilt-mobile');
    assert.deepEqual(free.map((a) => a.id), ['wbs']);
    const god = filterAppsForTier(APPS, 'god', 'wellbuilt-mobile');
    assert.deepEqual(god.map((a) => a.id), ['wbs', 'wbt', 'wbe']);
  });
});

describe('AppSwitcher wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/core/components/AppSwitcher.tsx'), 'utf8');
  it('loads public_companies via the helper and does not getDoc companies first', () => {
    assert.match(src, /loadAppSwitcherCompanyFields/);
    assert.match(src, /resolveAppSwitcherTier/);
    assert.doesNotMatch(src, /firestoreGetDoc\(firestoreDoc\(effectiveDb,\s*'companies'/);
  });
  it('does not cache a full company document', () => {
    assert.doesNotMatch(src, /AsyncStorage\.setItem\([^)]*company/i);
  });
});
