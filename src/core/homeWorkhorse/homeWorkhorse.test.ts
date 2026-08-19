/**
 * Shared home-screen workhorse: model, availability, invoke, skin-invariance.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HOME_ACTION_GROUPS,
  HOME_ACTION_IDS,
  HOME_ACTION_REGISTRY,
  HOME_APP_CATALOG_IDS,
  actionIdForAppCatalog,
  assertHomeActionGroupsComplete,
  buildHomeWorkhorseModel,
  createHomeActionInvoker,
  isHomeActionId,
  isWellbuiltMobileVisible,
  shiftActionUiState,
  shiftPresentationState,
  type HomeAppRef,
  type HomeInvokeResult,
  type HomeWorkhorseInput,
} from './index.js';

const APPS: HomeAppRef[] = HOME_APP_CATALOG_IDS.map((id) => ({
  id,
  name: id,
  shortName: id,
  subtitle: id,
  description: id,
  icon: 'apps',
  color: '#000',
  status: 'active',
  scheme: id === 'water-ticket' ? 'wellbuilt-tickets' : id,
}));

function baseInput(overrides: Partial<HomeWorkhorseInput> = {}): HomeWorkhorseInput {
  return {
    session: {
      displayName: 'Pat',
      role: 'driver',
      companyId: 'co1',
      companyName: 'WellBuilt',
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
    tier: {
      tier: 'suite',
      tierLabel: 'Suite',
      tierDescription: 'all',
      isAppEnabled: () => true,
    },
    live: {
      pendingDispatches: [],
      jsaPending: false,
      jsaMode: 'off',
    },
    apps: APPS,
    ...overrides,
  };
}

describe('home action registry', () => {
  it('has a descriptor for every stable action id', () => {
    for (const id of HOME_ACTION_IDS) {
      assert.equal(HOME_ACTION_REGISTRY[id].id, id);
      assert.ok(HOME_ACTION_GROUPS.includes(HOME_ACTION_REGISTRY[id].group));
    }
  });

  it('covers every catalog app id exactly once', () => {
    const fromApps = HOME_APP_CATALOG_IDS.map(actionIdForAppCatalog).sort();
    const fromRegistry = HOME_ACTION_IDS.filter((id) => id.startsWith('app:')).sort();
    assert.deepEqual(fromRegistry, fromApps);
  });

  it('rejects unknown action ids', () => {
    assert.equal(isHomeActionId('shift'), true);
    assert.equal(isHomeActionId('app:secret-private'), false);
    assert.equal(isHomeActionId('jsa-pending-private'), false);
  });
});

describe('availability', () => {
  it('hides WB-M for unrouted-only and empty-route company drivers', () => {
    assert.equal(isWellbuiltMobileVisible({ companyId: 'co1', assignedRoutes: [] }), false);
    assert.equal(
      isWellbuiltMobileVisible({ companyId: 'co1', assignedRoutes: ['Unrouted-1'] }),
      false,
    );
    assert.equal(
      isWellbuiltMobileVisible({ companyId: 'co1', assignedRoutes: ['Route A'] }),
      true,
    );
    assert.equal(isWellbuiltMobileVisible({ companyId: 'co1' }), true);
    assert.equal(isWellbuiltMobileVisible({}), true);
  });
});

describe('buildHomeWorkhorseModel', () => {
  it('does not accept or emit a skin id', () => {
    const model = buildHomeWorkhorseModel(baseInput());
    assert.equal('skinId' in model, false);
    assert.equal('skin' in model, false);
  });

  it('is skin-invariant: identical inputs produce identical visible ids and states', () => {
    const a = buildHomeWorkhorseModel(baseInput());
    const b = buildHomeWorkhorseModel(baseInput());
    assert.deepEqual(a.visibleActionIds, b.visibleActionIds);
    assert.deepEqual(
      a.actions.map((action) => ({ id: action.id, state: action.state, locked: action.locked })),
      b.actions.map((action) => ({ id: action.id, state: action.state, locked: action.locked })),
    );
  });

  it('grouped visible ids equal the visible set (no silent drops, no extras)', () => {
    const model = buildHomeWorkhorseModel(baseInput());
    const grouped = assertHomeActionGroupsComplete(model.groups).sort();
    assert.deepEqual(grouped, [...model.visibleActionIds].sort());
    assert.ok(model.visibleActionIds.includes('shift'));
    assert.ok(model.visibleActionIds.includes('timesheet'));
    assert.ok(model.visibleActionIds.includes('equipment'));
    assert.ok(model.visibleActionIds.includes('app:water-ticket'));
    assert.ok(model.visibleActionIds.includes('app:wellbuilt-jsa'));
    assert.ok(model.visibleActionIds.includes('settings'));
    assert.ok(model.visibleActionIds.includes('logout'));
  });

  it('applies the unrouted WB-M visibility rule from the registry, not a theme', () => {
    const hidden = buildHomeWorkhorseModel(
      baseInput({
        session: {
          displayName: 'Pat',
          role: 'driver',
          companyId: 'co1',
          assignedRoutes: [],
          isAdmin: false,
        },
      }),
    );
    const mobile = hidden.actions.find((action) => action.id === 'app:wellbuilt-mobile');
    assert.equal(mobile?.visible, false);
    assert.equal(hidden.visibleActionIds.includes('app:wellbuilt-mobile'), false);
    assert.equal(hidden.groups.applications.some((action) => action.id === 'app:wellbuilt-mobile'), false);
    assert.ok(hidden.visibleActionIds.includes('app:water-ticket'));
  });

  it('locks apps from the shared tier rule and still lists them', () => {
    const model = buildHomeWorkhorseModel(
      baseInput({
        tier: {
          tier: 'field-basics',
          tierLabel: 'Field Basics',
          tierDescription: 'one app',
          isAppEnabled: (id) => id === 'water-ticket',
        },
      }),
    );
    const tickets = model.actions.find((action) => action.id === 'app:water-ticket');
    const dashboard = model.actions.find((action) => action.id === 'app:wellbuilt-dashboard');
    assert.equal(tickets?.locked, false);
    assert.equal(tickets?.visible, true);
    assert.equal(dashboard?.locked, true);
    assert.equal(dashboard?.state, 'locked');
    assert.equal(dashboard?.visible, true);
    assert.equal(model.live.showTierBanner, true);
    assert.equal(model.live.enabledApplicationCount < model.live.applicationCount, true);
  });

  it('originates tickets badge and dispatch counts from the same live model', () => {
    const model = buildHomeWorkhorseModel(
      baseInput({
        live: {
          pendingDispatches: [
            { wellName: 'Gab 1', jobType: 'pw', status: 'pending' },
            { wellName: 'Gab 2', jobType: 'pw', status: 'accepted' },
          ],
          jsaPending: true,
          jsaMode: 'per_job',
        },
      }),
    );
    const tickets = model.actions.find((action) => action.id === 'app:water-ticket');
    assert.equal(model.live.pendingDispatchCount, 2);
    assert.equal(tickets?.badge?.count, 2);
    assert.equal(tickets?.badge?.text, '2 pending');
    assert.equal(tickets?.badge?.detail, 'Gab 1, Gab 2');
    assert.equal(model.live.jsaPending, true);
    const jsa = model.actions.find((action) => action.id === 'app:wellbuilt-jsa');
    assert.equal(jsa?.badge, undefined);
  });

  it('keeps shift presentation state identical regardless of caller', () => {
    const checking = {
      active: false,
      returning: false,
      returnStartTime: null,
      shiftStartTime: null,
      authorityKind: 'checking' as const,
      startShiftBusy: false,
    };
    assert.equal(shiftPresentationState(checking), 'checking');
    assert.equal(shiftActionUiState(checking), 'checking');
    const unavailable = { ...checking, authorityKind: 'unavailable' as const };
    assert.equal(shiftPresentationState(unavailable), 'unavailable');
    assert.equal(shiftActionUiState(unavailable), 'retry');
    const active = { ...checking, active: true, authorityKind: 'open' as const };
    assert.equal(shiftPresentationState(active), 'active');
    assert.equal(shiftActionUiState(active), 'active');
    const model = buildHomeWorkhorseModel(baseInput({ shift: checking }));
    assert.equal(model.shift.presentationState, 'checking');
    assert.equal(model.actions.find((action) => action.id === 'shift')?.state, 'checking');
  });
});

describe('shared invoke', () => {
  it('calls the same callback exactly once while in flight', async () => {
    const model = buildHomeWorkhorseModel(baseInput());
    let launches = 0;
    let releases!: () => void;
    const gate = new Promise<void>((resolve) => {
      releases = resolve;
    });
    const invoker = createHomeActionInvoker({
      getModel: () => model,
      launchApp: async () => {
        launches += 1;
        await gate;
      },
      openAppDetail: () => {
        throw new Error('detail should not run');
      },
      openTimesheet: () => {
        throw new Error('timesheet should not run');
      },
      openSettings: () => {
        throw new Error('settings should not run');
      },
      logout: () => {
        throw new Error('logout should not run');
      },
      hasLaunched: () => true,
      onLocked: () => {
        throw new Error('locked should not run');
      },
    });

    const first = invoker.invoke('equipment');
    const second = await invoker.invoke('equipment');
    assert.deepEqual(second, { status: 'ignored' });
    assert.equal(invoker.isInFlight('equipment'), true);
    releases();
    const firstResult = await first;
    assert.deepEqual(firstResult, { status: 'ok' });
    assert.equal(launches, 1);
  });

  it('does not start shift through invoke — dedicated controller only', async () => {
    const model = buildHomeWorkhorseModel(baseInput());
    const invoker = createHomeActionInvoker({
      getModel: () => model,
      launchApp: async () => {
        throw new Error('launch');
      },
      openAppDetail: () => {
        throw new Error('detail');
      },
      openTimesheet: () => {
        throw new Error('timesheet');
      },
      openSettings: () => {
        throw new Error('settings');
      },
      logout: () => {
        throw new Error('logout');
      },
      hasLaunched: () => false,
      onLocked: () => {
        throw new Error('locked');
      },
    });
    const result = await invoker.invoke('shift');
    assert.deepEqual(result, { status: 'unavailable', reason: 'shift_uses_dedicated_controller' });
  });

  it('fail-closes locked apps and hidden actions', async () => {
    const model = buildHomeWorkhorseModel(
      baseInput({
        session: {
          displayName: 'Pat',
          role: 'driver',
          companyId: 'co1',
          assignedRoutes: [],
          isAdmin: false,
        },
        tier: {
          tier: 'field-basics',
          tierLabel: 'Field Basics',
          tierDescription: 'one',
          isAppEnabled: (id) => id === 'water-ticket',
        },
      }),
    );
    const locked: string[] = [];
    const launches: string[] = [];
    const invoker = createHomeActionInvoker({
      getModel: () => model,
      launchApp: async (opts) => {
        launches.push(opts.name);
      },
      openAppDetail: () => {
        launches.push('detail');
      },
      openTimesheet: () => {},
      openSettings: () => {},
      logout: () => {},
      hasLaunched: () => true,
      onLocked: (action) => {
        locked.push(action.id);
      },
    });
    const dash: HomeInvokeResult = await invoker.invoke('app:wellbuilt-dashboard');
    assert.equal(dash.status, 'locked');
    assert.deepEqual(locked, ['app:wellbuilt-dashboard']);
    const mobile = await invoker.invoke('app:wellbuilt-mobile');
    assert.equal(mobile.status, 'hidden');
    assert.deepEqual(launches, []);
  });

  it('inspect opens detail; press launches when previously launched', async () => {
    const model = buildHomeWorkhorseModel(baseInput());
    const calls: string[] = [];
    const invoker = createHomeActionInvoker({
      getModel: () => model,
      launchApp: async (opts) => {
        calls.push(`launch:${opts.scheme}`);
      },
      openAppDetail: (appId) => {
        calls.push(`detail:${appId}`);
      },
      openTimesheet: () => {
        calls.push('timesheet');
      },
      openSettings: () => {
        calls.push('settings');
      },
      logout: () => {
        calls.push('logout');
      },
      hasLaunched: (appId) => appId === 'water-ticket',
      onLocked: () => {
        throw new Error('locked');
      },
    });
    await invoker.invoke('app:water-ticket');
    await invoker.invoke('app:wellbuilt-jsa');
    await invoker.invoke('app:water-ticket', 'inspect');
    await invoker.invoke('timesheet');
    await invoker.invoke('settings');
    await invoker.invoke('logout');
    assert.deepEqual(calls, [
      'launch:wellbuilt-tickets',
      'detail:wellbuilt-jsa',
      'detail:water-ticket',
      'timesheet',
      'settings',
      'logout',
    ]);
  });
});
