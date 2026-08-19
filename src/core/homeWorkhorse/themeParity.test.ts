/**
 * Four-theme home-screen parity.
 *
 * Source and model checks prove every theme consumes the shared workhorse
 * and cannot silently drop a required action or grow a private functional
 * button.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  HOME_ACTION_GROUPS,
  HOME_ACTION_IDS,
  HOME_APP_CATALOG_IDS,
  actionIdForAppCatalog,
  assertHomeActionGroupsComplete,
  buildHomeWorkhorseModel,
  type HomeAppRef,
} from './index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const THEME_HOME_SCREENS = [
  'src/ui/v1-grid/screens/HomeScreen.tsx',
  'src/ui/v2-dashboard/screens/HomeScreen.tsx',
  'src/ui/v3-sidebar/screens/HomeScreen.tsx',
  'src/ui/v4-widget/screens/HomeScreen.tsx',
] as const;

const THEME_VIEW_GLOBS = THEME_HOME_SCREENS;

function src(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

const APPS: HomeAppRef[] = HOME_APP_CATALOG_IDS.map((id) => ({
  id,
  name: id,
  shortName: id,
  subtitle: id,
  description: id,
  icon: 'apps',
  color: '#000',
  status: 'active',
}));

describe('four-theme action-id parity', () => {
  it('all four themes consume the same grouped action ids from the workhorse', () => {
    const model = buildHomeWorkhorseModel({
      session: {
        displayName: 'Pat',
        role: 'driver',
        companyId: 'co1',
        assignedRoutes: ['Route A'],
        isAdmin: false,
      },
      shift: {
        active: false,
        returning: false,
        returnStartTime: null,
        shiftStartTime: null,
        authorityKind: 'none',
        startShiftBusy: false,
      },
      tier: { tier: 'suite', tierLabel: 'Suite', tierDescription: 'all', isAppEnabled: () => true },
      live: { pendingDispatches: [], jsaPending: false, jsaMode: 'off' },
      apps: APPS,
    });
    const grouped = assertHomeActionGroupsComplete(model.groups).sort();
    const visible = [...model.visibleActionIds].sort();
    assert.deepEqual(grouped, visible);

    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      assert.match(text, /useHomeWorkhorse/);
      assert.match(text, /ActionCardRow/);
      for (const group of HOME_ACTION_GROUPS) {
        if (group === 'primary') {
          assert.match(text, /ActionCardRow/, `${rel} must render primary via ActionCardRow`);
          continue;
        }
        assert.ok(
          text.includes(`groups.${group}`),
          `${rel} must consume groups.${group} so a new ${group} action cannot disappear`,
        );
      }
    }
  });

  it('every shared action is rendered by every theme unless the registry visibility rule hides it', () => {
    const routed = buildHomeWorkhorseModel({
      session: {
        displayName: 'Pat',
        role: 'driver',
        companyId: 'co1',
        assignedRoutes: ['Route A'],
        isAdmin: false,
      },
      shift: {
        active: false,
        returning: false,
        returnStartTime: null,
        shiftStartTime: null,
        authorityKind: 'none',
        startShiftBusy: false,
      },
      tier: { tier: 'suite', tierLabel: 'Suite', tierDescription: 'all', isAppEnabled: () => true },
      live: { pendingDispatches: [], jsaPending: false, jsaMode: 'off' },
      apps: APPS,
    });
    const unrouted = buildHomeWorkhorseModel({
      session: {
        displayName: 'Pat',
        role: 'driver',
        companyId: 'co1',
        assignedRoutes: [],
        isAdmin: false,
      },
      shift: {
        active: false,
        returning: false,
        returnStartTime: null,
        shiftStartTime: null,
        authorityKind: 'none',
        startShiftBusy: false,
      },
      tier: { tier: 'suite', tierLabel: 'Suite', tierDescription: 'all', isAppEnabled: () => true },
      live: { pendingDispatches: [], jsaPending: false, jsaMode: 'off' },
      apps: APPS,
    });

    for (const id of HOME_ACTION_IDS) {
      const descriptorVisible = routed.actions.find((action) => action.id === id);
      assert.ok(descriptorVisible, id);
      if (id === 'app:wellbuilt-mobile') {
        assert.equal(descriptorVisible.visible, true);
        assert.equal(unrouted.actions.find((action) => action.id === id)?.visible, false);
        continue;
      }
      assert.equal(descriptorVisible.visible, true, `${id} must be visible when its rule allows`);
      assert.ok(routed.visibleActionIds.includes(id));
      assert.ok(unrouted.visibleActionIds.includes(id), `${id} must remain visible on unrouted`);
    }

    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      assert.match(text, /groups\.applications\.map/);
      assert.doesNotMatch(text, /wellbuiltApps/);
      assert.doesNotMatch(text, /applicationActions\.filter|groups\.applications\.filter/);
    }
  });

  it('no theme HomeScreen defines a private functional action absent from the registry', () => {
    const known = new Set<string>(HOME_ACTION_IDS);
    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      const invokeIds = [...text.matchAll(/invoke\(\s*['"]([a-z0-9:-]+)['"]/g)].map((m) => m[1]);
      for (const id of invokeIds) {
        assert.ok(known.has(id), `${rel} invokes unknown action ${id}`);
      }
      assert.doesNotMatch(text, /handleArrived/);
      assert.doesNotMatch(text, /startShift\b/);
      assert.doesNotMatch(text, /launchWBApp/);
      assert.doesNotMatch(text, /const handleJsaLaunch/);
    }
  });

  it('adding a required shared action fails if a theme does not iterate its group', () => {
    const registry = src('src/core/homeWorkhorse/actionRegistry.ts');
    const ids = src('src/core/homeWorkhorse/actionIds.ts');
    for (const group of HOME_ACTION_GROUPS) {
      assert.ok(ids.includes(`'${group}'`), `HOME_ACTION_GROUPS must list ${group}`);
    }
    for (const id of HOME_ACTION_IDS) {
      assert.ok(registry.includes(`id: '${id}'`) || registry.includes(`id: "${id}"`), id);
    }
    for (const appId of HOME_APP_CATALOG_IDS) {
      assert.ok(ids.includes(`'${appId}'`));
      assert.equal(actionIdForAppCatalog(appId), `app:${appId}`);
    }
    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      assert.ok(
        text.includes('groups.applications.map'),
        `${rel}: new application actions are rendered only if the theme maps groups.applications`,
      );
      assert.ok(text.includes('groups.chrome'), `${rel} must consume groups.chrome`);
      assert.match(
        text,
        /invoke\(action\.id\)|invoke\(settingsAction\.id\)|invoke\(['"]settings['"]\)/,
        `${rel} must invoke shared settings via the workhorse`,
      );
      assert.match(
        text,
        /invoke\(action\.id\)|invoke\(logoutAction\.id\)|invoke\(['"]logout['"]\)/,
        `${rel} must invoke shared logout via the workhorse`,
      );
    }
  });
});

describe('identical callbacks, states, shift, and live data', () => {
  it('disabled / loading / unavailable / retry / active states are model-level, not per-theme', () => {
    const states = ['checking', 'unavailable', 'none'] as const;
    for (const kind of states) {
      const model = buildHomeWorkhorseModel({
        session: {
          displayName: 'Pat',
          role: 'driver',
          isAdmin: false,
        },
        shift: {
          active: kind === 'none' ? false : false,
          returning: false,
          returnStartTime: null,
          shiftStartTime: null,
          authorityKind: kind,
          startShiftBusy: kind === 'none',
        },
        tier: { tier: null, tierLabel: 'Suite', tierDescription: '' },
        live: { pendingDispatches: [], jsaPending: false, jsaMode: 'off' },
        apps: APPS,
      });
      const shift = model.actions.find((action) => action.id === 'shift');
      if (kind === 'checking') assert.equal(shift?.state, 'checking');
      if (kind === 'unavailable') assert.equal(shift?.state, 'retry');
      if (kind === 'none') assert.equal(shift?.state, 'loading');
      assert.equal(model.shift.authorityKind, kind);
    }
  });

  it('ActionCardRow is the sole shift-button implementation and reads the workhorse', () => {
    const row = src('src/ui/shared/ActionCardRow.tsx');
    assert.match(row, /useHomeWorkhorse/);
    assert.match(row, /shiftActions/);
    assert.match(row, /invoke\('timesheet'\)/);
    assert.match(row, /invoke\('equipment'\)/);
    assert.match(row, /isExplicitStartShiftSuccess/);
    assert.match(row, /ensurePreTripGate/);
    assert.doesNotMatch(row, /useAuth/);
    assert.doesNotMatch(row, /useAppLauncher/);
    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      assert.match(text, /<ActionCardRow/);
      assert.doesNotMatch(text, /onStartShift=/);
      assert.doesNotMatch(text, /onArrived=/);
    }
  });

  it('badges, application counts, and live state originate from the shared model', () => {
    for (const rel of THEME_HOME_SCREENS) {
      const text = src(rel);
      assert.doesNotMatch(text, /fetchPendingDispatches/);
      assert.doesNotMatch(text, /setDispatches/);
      assert.doesNotMatch(text, /queryTodaysJsaCompletion/);
      assert.doesNotMatch(text, /jsaPending/);
      assert.doesNotMatch(text, /firestore\.googleapis\.com/);
    }
    const v2 = src('src/ui/v2-dashboard/screens/HomeScreen.tsx');
    assert.match(v2, /action\.badge/);
    const v4 = src('src/ui/v4-widget/screens/HomeScreen.tsx');
    assert.match(v4, /live\.applicationCount|home\.live/);
  });
});

describe('theme switch is presentation-only', () => {
  it('HomeWorkhorseProvider sits above the skin HomeScreen and ignores skin', () => {
    const homeRoute = src('app/home.tsx');
    assert.match(homeRoute, /HomeWorkhorseProvider/);
    assert.match(homeRoute, /skin\.screens\.HomeScreen/);
    const provider = src('src/core/context/HomeWorkhorseContext.tsx');
    assert.doesNotMatch(provider, /from ['"]@\/core\/context\/SkinContext['"]/);
    assert.doesNotMatch(provider, /useSkin/);
    assert.doesNotMatch(provider, /skinId/);
    assert.doesNotMatch(provider, /resolveActiveDriverShift/);
    assert.doesNotMatch(provider, /ssoAuthorize/);
    assert.doesNotMatch(provider, /revalidateDriverSession/);
    assert.doesNotMatch(provider, /login\(/);
    const skin = src('src/core/context/SkinContext.tsx');
    assert.doesNotMatch(skin, /login/);
    assert.doesNotMatch(skin, /resolveActive/);
    assert.doesNotMatch(skin, /sso/i);
    assert.doesNotMatch(skin, /revalidat/i);
    assert.doesNotMatch(skin, /startShift/);
    for (const rel of THEME_HOME_SCREENS) {
      assert.doesNotMatch(src(rel), /HomeWorkhorseProvider/);
    }
  });
});

describe('catalog and registry stay a single definition', () => {
  it('apps.ts catalog ids match HOME_APP_CATALOG_IDS', () => {
    const appsSrc = src('src/core/data/apps.ts');
    for (const id of HOME_APP_CATALOG_IDS) {
      assert.ok(appsSrc.includes(`id: '${id}'`) || appsSrc.includes(`id: "${id}"`), id);
    }
  });
});

describe('static ban: theme-only views must not import services or firebase', () => {
  const banned = [
    /from ['"]firebase/,
    /from ['"]@\/core\/services\//,
    /from ['"]@\/core\/context\/AuthContext['"]/,
    /from ['"]@\/core\/hooks['"]/,
    /useAppLauncher/,
    /useAuth\s*\(/,
    /useCompanyConfig/,
    /wellbuiltApps/,
    /fetchPendingDispatches/,
    /firestore\.googleapis\.com/,
    /ssoLaunchPolicy/,
    /ssoProtocol/,
    /ssoAuthorize/,
    /shiftAuthorityClient/,
    /shiftAuthoritySessionSequencer/,
    /secureSessionRevalidation/,
    /firebaseApp/,
  ];

  for (const rel of THEME_VIEW_GLOBS) {
    it(`${rel} has no prohibited service / firebase / auth / launcher imports`, () => {
      const text = src(rel);
      for (const re of banned) {
        assert.equal(re.test(text), false, `${rel} matched ${re}`);
      }
    });
  }
});
