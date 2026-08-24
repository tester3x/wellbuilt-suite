import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  __resetAppCardLaunchForTests,
  beginAppCardLaunch,
  decideAppCardPrimaryAction,
  endAppCardLaunch,
  type AppCardTapApp,
} from './appCardTapPolicy';

const root = join(__dirname, '..', '..', '..');
const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

const CATALOG: Record<string, AppCardTapApp> = {
  'water-ticket': {
    id: 'water-ticket',
    name: 'WellBuilt Tickets',
    scheme: 'wellbuilt-tickets',
    androidPackage: 'com.testerxxx.waterticket',
  },
  'wellbuilt-mobile': {
    id: 'wellbuilt-mobile',
    name: 'WellBuilt Mobile',
    scheme: 'wellbuiltmobile',
    androidPackage: 'com.wellbuiltmobile.app',
  },
  'wellbuilt-jsa': {
    id: 'wellbuilt-jsa',
    name: 'WellBuilt JSA',
    scheme: 'jsaapp',
    androidPackage: 'com.syconik801.jsaapp',
  },
  'wellbuilt-equipment': {
    id: 'wellbuilt-equipment',
    name: 'WellBuilt eQuipment',
    scheme: 'wbequipment',
    androidPackage: 'com.wellbuilt.equipment',
  },
  'wellbuilt-dashboard': {
    id: 'wellbuilt-dashboard',
    name: 'WellBuilt Dashboard',
    webUrl: 'https://wellbuilt-sync.web.app',
  },
};

const NATIVE_IDS = [
  'water-ticket',
  'wellbuilt-mobile',
  'wellbuilt-jsa',
  'wellbuilt-equipment',
] as const;

const HOME_SCREENS = [
  'src/ui/v1-grid/screens/HomeScreen.tsx',
  'src/ui/v2-dashboard/screens/HomeScreen.tsx',
  'src/ui/v3-sidebar/screens/HomeScreen.tsx',
  'src/ui/v4-widget/screens/HomeScreen.tsx',
  'src/ui/v3-sidebar/screens/SettingsScreen.tsx',
];

const byId = (id: string) => {
  const app = CATALOG[id];
  assert.ok(app, id);
  return app;
};

test('enabled native cards launch immediately (never App Details)', () => {
  for (const id of NATIVE_IDS) {
    const d = decideAppCardPrimaryAction({
      app: byId(id),
      enabled: true,
      hasLaunched: false,
      shiftActive: false,
    });
    assert.equal(d.action, 'launch_native', id);
    if (d.action === 'launch_native') {
      assert.ok(d.target.scheme);
      assert.equal(d.target.name, byId(id).name);
    }
  }
});

test('enabled Dashboard web card opens its URL immediately', () => {
  const d = decideAppCardPrimaryAction({
    app: byId('wellbuilt-dashboard'),
    enabled: true,
    hasLaunched: false,
  });
  assert.equal(d.action, 'open_web');
  if (d.action === 'open_web') {
    assert.equal(d.target.webUrl, 'https://wellbuilt-sync.web.app');
    assert.equal(d.target.scheme, undefined);
  }
});

test('old persisted About-screen flags do not change launch behavior', () => {
  for (const id of [...NATIVE_IDS, 'wellbuilt-dashboard'] as const) {
    const app = byId(id);
    const unseen = decideAppCardPrimaryAction({ app, enabled: true, hasLaunched: false });
    const seen = decideAppCardPrimaryAction({ app, enabled: true, hasLaunched: true });
    assert.deepEqual(unseen, seen, id);
    assert.notEqual(unseen.action, 'disabled_notice', id);
  }
});

test('off-shift does not block an otherwise enabled card', () => {
  for (const id of [...NATIVE_IDS, 'wellbuilt-dashboard'] as const) {
    const d = decideAppCardPrimaryAction({
      app: byId(id),
      enabled: true,
      shiftActive: false,
    });
    assert.ok(d.action === 'launch_native' || d.action === 'open_web', id);
  }
});

test('contract-disabled cards show the company-disabled notice', () => {
  for (const id of [...NATIVE_IDS, 'wellbuilt-dashboard'] as const) {
    const d = decideAppCardPrimaryAction({
      app: byId(id),
      enabled: false,
      hasLaunched: true,
      shiftActive: true,
    });
    assert.equal(d.action, 'disabled_notice', id);
  }
});

test('unconfigured Billing and Payroll are not App Details', () => {
  for (const name of ['Billing', 'Payroll'] as const) {
    const d = decideAppCardPrimaryAction({
      app: { id: name.toLowerCase(), name },
      enabled: true,
    });
    assert.equal(d.action, 'not_configured', name);
  }
});

test('one tap does not duplicate an in-flight launch', () => {
  __resetAppCardLaunchForTests();
  assert.equal(beginAppCardLaunch('water-ticket'), true);
  assert.equal(beginAppCardLaunch('water-ticket'), false);
  assert.equal(beginAppCardLaunch('wellbuilt-mobile'), true);
  endAppCardLaunch('water-ticket');
  assert.equal(beginAppCardLaunch('water-ticket'), true);
  __resetAppCardLaunchForTests();
});

test('Home screens never route primary tap through App Details', () => {
  for (const f of HOME_SCREENS) {
    const body = src(f);
    assert.match(body, /onPrimaryTap|useAppCardActions/, f);
    assert.doesNotMatch(body, /useFirstLaunch/, f);
    assert.doesNotMatch(body, /hasLaunched\(app/, f);
    assert.doesNotMatch(
      body,
      /onPress=\{\(\) => \{[\s\S]{0,400}router\.push\(`\/app-detail/,
      f,
    );
  }
});

test('WB-T WB-M JSA eQuipment Dashboard never App-Details on normal tap', () => {
  const v1 = src('src/ui/v1-grid/screens/HomeScreen.tsx');
  assert.match(v1, /onPrimaryTap\(app\)/);
  const eq = src('src/ui/shared/ActionCardRow.tsx');
  assert.doesNotMatch(eq, /app-detail/);
  assert.match(eq, /runEquipmentCardLaunch/);
  assert.match(eq, /launchWBApp/);
});

test('primary action hook launches directly and ignores seen flags', () => {
  const hook = src('src/core/hooks/useAppCardActions.ts');
  assert.match(hook, /decideAppCardPrimaryAction/);
  assert.match(hook, /beginAppCardLaunch/);
  assert.match(hook, /launchWBApp/);
  assert.match(hook, /endAppCardLaunch/);
  assert.doesNotMatch(hook, /hasLaunched\(/);
  assert.doesNotMatch(hook, /markLaunched/);
  assert.doesNotMatch(hook, /useFirstLaunch/);
  const primary = hook.slice(
    hook.indexOf('const onPrimaryTap'),
    hook.indexOf('const onOpenDetails'),
  );
  assert.doesNotMatch(primary, /app-detail/);
  assert.match(hook, /router\.push\(`\/app-detail\?id=\$\{appId\}`\)/);
});

test('unavailable / not-installed guidance remains on the launch path', () => {
  const launcher = src('src/core/services/appLauncher.ts');
  assert.match(launcher, /appDetail\.launch\.notInstalled/);
  assert.match(launcher, /appDetail\.launch\.notConfigured/);
  const hook = src('src/core/hooks/useAppCardActions.ts');
  assert.match(hook, /home\.tier\.lockedTitle/);
  assert.match(hook, /appDetail\.launch\.notConfigured/);
});

test('App Details launch buttons reuse the same governed tap handler', () => {
  const files = [
    'src/ui/v1-grid/screens/AppDetailScreen.tsx',
    'src/ui/v2-dashboard/screens/AppDetailScreen.tsx',
    'src/ui/v3-sidebar/screens/AppDetailScreen.tsx',
    'src/ui/v4-widget/screens/AppDetailScreen.tsx',
  ];
  for (const f of files) {
    const body = src(f);
    assert.match(body, /onPrimaryTap/, f);
    assert.doesNotMatch(body, /markLaunched/, f);
    assert.doesNotMatch(body, /useFirstLaunch/, f);
  }
});
