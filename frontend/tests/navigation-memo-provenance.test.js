import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive } from 'vue';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';

// Synthetic registrations and fetch stubs only; no hardware or live services.
const names = ['合成起点', '合成终点'];
const makeRoute = (code = 'ordinary') => ({ distance_m: 50, segment_codes: [code],
  segments: [{ segment_code: code, name: `合成路段${code}`, length_m: 50,
    geometry_coordinates: [[10, 10], [10.001, 10]] }] });

function setup({ echo = {}, source = makeRoute() } = {}) {
  const live = reactive({ allowed: true, active: false, index: 0, paused: false });
  const context = reactive({ scope: 'guest-local' });
  const options = reactive(names.map(value => ({ value, label: value })));
  const calls = [], paths = [];
  const planner = createRoutePlanner({ getStartOptions: () => options, getEndOptions: () => options,
    fetcher: async url => {
      calls.push(url);
      return { ok: true, json: async () => ({ start_name: names[0], end_name: names[1],
        mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', routes: [source], ...echo }) };
    },
    router: {
      push: async path => { paths.push(path); live.active = path === '/elder/navigation'; },
      replace: async path => { paths.push(path); live.active = path === '/elder/navigation'; },
    } });
  planner.configure({ getJourneyScope: () => context.scope, getNavigationContext: () => live });
  planner.startName.value = names[0]; planner.endName.value = names[1];
  return { planner, live, context, options, calls, paths };
}
async function start(app) {
  assert.equal(await app.planner.planRoutes(), true);
  assert.equal(await app.planner.startNavigation(), true);
}

test('memo provenance requires an explicit named start and stays read-only during a manual rest pause', async () => {
  const app = setup(), { planner, live, calls, paths } = app;
  assert.equal(planner.textMemoRouteVerified.value, false);
  await planner.planRoutes();
  live.active = true;
  assert.equal(planner.textMemoRouteVerified.value, false, 'page history alone cannot start a trip');
  await planner.startNavigation();
  const selected = planner.selectedRoute.value, beforeCalls = calls.length, beforePaths = [...paths];
  assert.equal(planner.textMemoRouteVerified.value, true);
  live.paused = true;
  live.index = 0;
  planner.selectSegment('unrelated-map-inspection');
  assert.equal(planner.textMemoRouteVerified.value, true);
  assert.equal(planner.selectedRoute.value, selected);
  assert.equal(calls.length, beforeCalls); assert.deepEqual(paths, beforePaths);
});

for (const echo of [{ start_name: '另一合成起点' }, { end_name: '另一合成终点' },
  { mobility_type: 'CANE' }, { strategy: 'SAFEST' }, { start_name: undefined },
  { start_context: { segment_code: 'ordinary' } }]) {
  test(`mismatched route response cannot prove memo provenance: ${JSON.stringify(echo)}`, async () => {
    const app = setup({ echo }); await start(app);
    assert.equal(app.planner.textMemoRouteVerified.value, false);
  });
}

for (const [kind, mutate] of [
  ['route name', app => { app.planner.selectedRoute.value.segments[0].name = '改名'; }],
  ['route length', app => { app.planner.selectedRoute.value.segments[0].length_m++; }],
  ['route total', app => { app.planner.selectedRoute.value.distance_m++; }],
  ['route order', app => { app.planner.selectedRoute.value.segment_codes[0] = 'other'; }],
  ['route replacement', app => { app.planner.routes.value = [makeRoute()]; }],
  ['start', app => { app.planner.startName.value = names[1]; }],
  ['end', app => { app.planner.endName.value = names[0]; }],
  ['mobility', app => { app.planner.mobilityType.value = 'CANE'; }],
  ['strategy', app => { app.planner.routeStrategy.value = 'SAFEST'; }],
  ['scope', app => { app.context.scope = 'another-session'; }],
  ['allowed role', app => { app.live.allowed = false; }],
  ['active page', app => { app.live.active = false; }],
  ['missing registered endpoint', app => { app.options.pop(); }],
  ['duplicate registered endpoint', app => { app.options.push({ ...app.options[0] }); }],
  ['loading', app => { app.planner.loading.value = true; }],
  ['coordinate context', app => { app.planner.startContext.value = { segment_code: 'ordinary' }; }],
  ['route coordinate context', app => { app.planner.selectedRoute.value.start_context = { segment_code: 'ordinary' }; }],
  ['invalid identity data', app => { app.planner.selectedRoute.value.segments[0].length_m = 1n; }],
]) test(`memo provenance rejects changed ${kind}`, async () => {
  const app = setup(); await start(app);
  assert.equal(app.planner.textMemoRouteVerified.value, true);
  mutate(app);
  assert.equal(app.planner.textMemoRouteVerified.value, false);
});

test('new instances and cloned persisted routes cannot restore a started journey', async () => {
  const original = setup(); await start(original);
  const restored = setup();
  restored.planner.routes.value = [JSON.parse(JSON.stringify(original.planner.selectedRoute.value))];
  restored.live.active = true;
  assert.equal(restored.planner.textMemoRouteVerified.value, false);
  await restored.planner.startNavigation();
  assert.equal(restored.planner.textMemoRouteVerified.value, false);
});

test('ending and scope or page round trips cannot revive old memo authority', async () => {
  for (const kind of ['end', 'scope', 'page', 'role']) {
    const app = setup(); await start(app);
    if (kind === 'end') {
      await app.planner.returnToOptions({ ended: true });
      app.live.active = true;
    } else if (kind === 'scope') {
      app.context.scope = 'changed'; app.context.scope = 'guest-local';
    } else {
      const key = kind === 'page' ? 'active' : 'allowed';
      app.live[key] = false; app.live[key] = true;
    }
    assert.equal(app.planner.textMemoRouteVerified.value, false, kind);
  }
});

test('coordinate-origin routes never gain named memo authority', async () => {
  const app = setup();
  app.planner.setCurrentOrigin({ longitude: 10, latitude: 10, accuracy: 8, timestamp: Date.now() },
    { segment_code: 'ordinary', name: '合成接入路' });
  await start(app);
  assert.equal(app.planner.textMemoRouteVerified.value, false);
  assert.ok(app.calls[0].includes('start_longitude='));
});

test('a paused or guiding detour session cannot use ordinary memo provenance', async () => {
  for (const guiding of [false, true]) {
    const app = setup(); await start(app);
    assert.equal(app.planner.detour.activate({ code: 'blocked', name: '合成排除路段',
      createdAt: Date.now(), route: makeRoute('alternate'), navigationContext: {
        startName: names[0], endName: names[1], mobilityType: 'WHEELCHAIR',
        strategy: 'BALANCED', scope: 'guest-local' } }), true);
    if (!guiding) app.planner.detour.pause();
    assert.equal(app.planner.detour.guiding.value, guiding);
    assert.equal(app.planner.textMemoRouteVerified.value, false);
  }
});
