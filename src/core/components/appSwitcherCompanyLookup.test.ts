import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  FAIL_CLOSED_TIER,
  applyAppSwitcherTierLookup,
  createAppSwitcherTierSession,
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

  it('neither document → none, fail closed to free', async () => {
    const result = await loadAppSwitcherCompanyFields('missing', reader({}));
    assert.deepEqual(result, { source: 'none', tier: null });
    assert.equal(resolveAppSwitcherTier(result), FAIL_CLOSED_TIER);
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

describe('fail-closed tier apply', () => {
  it('initial/loading reset is free', async () => {
    const applied: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: null,
      generation: 1,
      isCurrent: () => true,
      read: reader({}),
      setTier: (t) => applied.push(t),
    });
    assert.deepEqual(applied, [FAIL_CLOSED_TIER]);
  });

  it('missing company ID remains free and does not read', async () => {
    const calls: string[] = [];
    const applied: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: '',
      generation: 1,
      isCurrent: () => true,
      read: reader({}, calls),
      setTier: (t) => applied.push(t),
    });
    assert.deepEqual(applied, [FAIL_CLOSED_TIER]);
    assert.deepEqual(calls, []);
  });

  it('neither document remains free', async () => {
    const applied: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: 'missing',
      generation: 1,
      isCurrent: () => true,
      read: reader({}),
      setTier: (t) => applied.push(t),
    });
    assert.equal(applied[0], FAIL_CLOSED_TIER);
    assert.equal(applied[applied.length - 1], FAIL_CLOSED_TIER);
  });

  it('public read failure remains free', async () => {
    const applied: string[] = [];
    const throwing: AppSwitcherCompanyReader = async () => {
      throw new Error('unavailable');
    };
    await applyAppSwitcherTierLookup({
      companyId: 'x',
      generation: 1,
      isCurrent: () => true,
      read: throwing,
      setTier: (t) => applied.push(t),
    });
    assert.equal(applied[0], FAIL_CLOSED_TIER);
    assert.equal(applied[applied.length - 1], FAIL_CLOSED_TIER);
  });

  it('malformed/unknown tier remains free', async () => {
    const applied: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: 'odd',
      generation: 1,
      isCurrent: () => true,
      read: reader({
        'public_companies/odd': { exists: true, data: { tier: 'enterprise' } },
      }),
      setTier: (t) => applied.push(t),
    });
    assert.equal(applied[applied.length - 1], FAIL_CLOSED_TIER);
    assert.equal(pickAppSwitcherTier({ tier: 'enterprise' }), null);
  });

  it('valid field and god tiers still update', async () => {
    const applied: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: 'lg',
      generation: 1,
      isCurrent: () => true,
      read: reader({ 'public_companies/lg': { exists: true, data: { tier: 'field' } } }),
      setTier: (t) => applied.push(t),
    });
    assert.equal(applied[0], FAIL_CLOSED_TIER);
    assert.equal(applied[applied.length - 1], 'field');

    const appliedGod: string[] = [];
    await applyAppSwitcherTierLookup({
      companyId: 'lg',
      generation: 1,
      isCurrent: () => true,
      read: reader({ 'public_companies/lg': { exists: true, data: { tier: 'god' } } }),
      setTier: (t) => appliedGod.push(t),
    });
    assert.equal(appliedGod[appliedGod.length - 1], 'god');
  });

  it('stale result after scope change is suppressed', async () => {
    const session = createAppSwitcherTierSession();
    const gen1 = session.startLookup();
    const applied: string[] = [];
    let finish!: (snap: AppSwitcherCompanySnap) => void;
    const pending = new Promise<AppSwitcherCompanySnap>((resolve) => {
      finish = resolve;
    });
    const slow: AppSwitcherCompanyReader = async (collection) => {
      if (collection === 'public_companies') return pending;
      return { exists: false };
    };
    const running = applyAppSwitcherTierLookup({
      companyId: 'old-co',
      generation: gen1,
      isCurrent: (g) => session.isCurrent(g),
      read: slow,
      setTier: (t) => applied.push(t),
    });
    assert.equal(applied[0], FAIL_CLOSED_TIER);
    session.invalidate();
    finish({ exists: true, data: { tier: 'god' } });
    await running;
    assert.deepEqual(applied, [FAIL_CLOSED_TIER]);
  });
});

describe('AppSwitcher wiring', () => {
  const src = readFileSync(join(process.cwd(), 'src/core/components/AppSwitcher.tsx'), 'utf8');
  it('loads public_companies via the helper and does not getDoc companies first', () => {
    assert.match(src, /loadAppSwitcherCompanyFields|applyAppSwitcherTierLookup/);
    assert.match(src, /resolveAppSwitcherTier|applyAppSwitcherTierLookup/);
    assert.doesNotMatch(src, /firestoreGetDoc\(firestoreDoc\(effectiveDb,\s*'companies'/);
  });
  it('does not cache a full company document', () => {
    assert.doesNotMatch(src, /AsyncStorage\.setItem\([^)]*company/i);
  });
  it('fail-closes initial tier and resets before lookup', () => {
    assert.match(src, /useState<string>\(FAIL_CLOSED_TIER\)|useState<string>\('free'\)/);
    assert.match(src, /createAppSwitcherTierSession|startLookup/);
    assert.match(src, /applyAppSwitcherTierLookup/);
    assert.match(src, /invalidate\(\)/);
  });
});
