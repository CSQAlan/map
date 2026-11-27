import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive, isReadonly } from 'vue';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';

const makeRoute = (code = 'a') => ({ distance_m: 50, segment_codes: [code],
  segments: [{ segment_code: code, name: `合成路段${code}`, length_m: 50,
    geometry_coordinates: [[10, 10], [10.001, 10]] }] });
function setup(echo = {}, held = false) {
  const live = reactive({ allowed: true, active: false, session: 1 });
  const context = reactive({ scope: 'guest-local' });
  const options = reactive(['合成起点', '合成终点'].map(value => ({ value, label: value })));
  const calls = [], paths = [];
  let release;
  const wait = held ? new Promise(resolve => { release = resolve; }) : Promise.resolve();
  const planner = createRoutePlanner({ getStartOptions: () => options, getEndOptions: () => options,
    fetcher: async url => {
      calls.push(url); await wait;
      return { ok: true, json: async () => ({ start_name: options[0].value, end_name: options[1].value,
        mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', routes: [makeRoute(), makeRoute('b')], ...echo }) };
    }, router: { push: async path => { paths.push(path); live.active = path === '/elder/routes'; } } });
  planner.configure({ getJourneyScope: () => context.scope, getPredepartureContext: () => live });
  planner.startName.value = options[0].value; planner.endName.value = options[1].value;
  return { planner, live, context, options, calls, paths, release };
}
test('predeparture source is read-only, requires a completed query and results page, and never starts navigation', async () => {
  const app = setup(), { planner, live } = app;
  assert.ok(isReadonly(planner.predepartureRouteSource));
  assert.equal(planner.predepartureRouteSource.value, null);
  await planner.planRoutes(); assert.equal(planner.predepartureRouteSource.value, null);
  live.active = true;
  assert.equal(planner.predepartureRouteSource.value, planner.selectedRoute.value);
  planner.selectSegment('unrelated');
  assert.equal(planner.predepartureRouteSource.value, planner.selectedRoute.value);
  planner.selectRoute(1);
  assert.equal(planner.predepartureRouteSource.value.segment_codes[0], 'b');
  assert.equal(app.calls.length, 1); assert.deepEqual(app.paths, []);
  assert.equal(planner.textMemoRouteVerified.value, false);
});
for (const echo of [{ start_name: '另一地点' }, { end_name: '另一地点' }, { mobility_type: 'CANE' },
  { strategy: 'SAFEST' }, { start_name: undefined }, { start_context: { segment_code: 'a' } }]) {
  test(`predeparture rejects mismatched response ${JSON.stringify(echo)}`, async () => {
    const app = setup(echo); await app.planner.planRoutes(); app.live.active = true;
    assert.equal(app.planner.predepartureRouteSource.value, null);
  });
}
for (const [label, mutate] of [
  ['route content', a => { a.planner.selectedRoute.value.segments[0].name = '改名'; }],
  ['route identity', a => { a.planner.routes.value = [makeRoute()]; }],
  ['bad identity', a => { a.planner.selectedRoute.value.distance_m = 1n; }],
  ['start', a => { a.planner.startName.value = '另一地点'; }],
  ['end', a => { a.planner.endName.value = '另一地点'; }],
  ['profile', a => { a.planner.mobilityType.value = 'CANE'; }],
  ['strategy', a => { a.planner.routeStrategy.value = 'SAFEST'; }],
  ['scope', a => { a.context.scope = 'other'; }],
  ['session', a => { a.live.session++; }],
  ['role', a => { a.live.allowed = false; }],
  ['page', a => { a.live.active = false; }],
  ['loading', a => { a.planner.loading.value = true; }],
  ['endpoint missing', a => { a.options.pop(); }],
  ['endpoint duplicate', a => { a.options.push({ ...a.options[0] }); }],
  ['start context', a => { a.planner.startContext.value = {}; }],
  ['route start context', a => { a.planner.selectedRoute.value.start_context = {}; }],
]) test(`predeparture rejects changed ${label}`, async () => {
  const app = setup(); await app.planner.planRoutes(); app.live.active = true;
  assert.equal(app.planner.predepartureRouteSource.value, app.planner.selectedRoute.value);
  mutate(app); assert.equal(app.planner.predepartureRouteSource.value, null);
});
test('scope/role round trips and late responses never revive stale preview authority', async () => {
  for (const kind of ['scope', 'role', 'session']) for (const held of [false, true]) {
    const app = setup({}, held); app.live.active = true;
    const query = app.planner.planRoutes(); if (!held) await query;
    if (kind === 'scope') { app.context.scope = 'other'; app.context.scope = 'guest-local'; }
    if (kind === 'role') { app.live.allowed = false; app.live.allowed = true; }
    if (kind === 'session') app.live.session++;
    app.release?.(); await query;
    assert.equal(app.planner.predepartureRouteSource.value, null, `${kind}/${held}`);
  }
});
test('GPS origins and paused/guiding detours cannot acquire preview authority', async () => {
  const app = setup();
  app.planner.setCurrentOrigin({ longitude: 10, latitude: 10, accuracy: 8, timestamp: Date.now() },
    { segment_code: 'a', name: '合成路段' });
  await app.planner.planRoutes(); app.live.active = true;
  assert.equal(app.planner.predepartureRouteSource.value, null);
  for (const paused of [false, true]) {
    const a = setup(); await a.planner.planRoutes(); a.live.active = true;
    assert.equal(a.planner.detour.activate({ code: 'blocked', name: '合成排除段', createdAt: Date.now(),
      route: makeRoute('detour'), navigationContext: { startName: '合成起点', endName: '合成终点',
        mobilityType: 'WHEELCHAIR', strategy: 'BALANCED', scope: 'guest-local' } }), true);
    if (paused) a.planner.detour.pause();
    assert.equal(a.planner.predepartureRouteSource.value, null);
  }
});
