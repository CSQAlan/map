import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { comparisonSummary, registeredRouteFacts, shortestReturnedCandidate, referenceBlockedSegments } from '../src/utils/routeComparison.js';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

// Synthetic API fixtures shaped like the competition case; not a live seed/DB run.
const route = (distance, width = 2.5, slope = 1.7, code = 'wide') => ({
  distance_m: distance, segment_codes: [code], segments: [{ segment_code: code, width_m: width, slope_percent: slope, step_count: 0 }],
});
const current = route(186);
const walking = route(166, 1.3, 1.5, 'narrow');
const places = ['合成起点', '合成终点'].map(value => ({ label: value, value }));
const response = routes => ({ ok: true, json: async () => ({ routes }) });
function setup(fetchReference, primary = [current]) {
  const urls = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    fetcher: async url => {
      urls.push(url);
      return urls.length === 1 ? response(primary) : fetchReference(url);
    },
  });
  planner.startName.value = places[0].value;
  planner.endName.value = places[1].value;
  return { planner, urls };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('reference picks actual shortest returned distance, not rank; facts honestly include higher slope', async () => {
  const { planner, urls } = setup(async () => response([route(200), walking, route(180)]));
  await planner.planRoutes();
  const chosen = planner.selectedRoute.value;
  const status = planner.actionStatus.value;
  assert.equal(await planner.compareWalkingRoute(), true);
  const params = new URL(urls[1], 'http://synthetic.test').searchParams;
  assert.deepEqual(Object.fromEntries(params), { start_name: '合成起点', end_name: '合成终点', mobility_type: 'INDEPENDENT', strategy: 'SHORTEST' });
  assert.equal(planner.walkingReference.value.distance_m, 166);
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(planner.actionStatus.value, status);
  assert.equal(planner.mobilityType.value, 'WHEELCHAIR');
  assert.equal(planner.routeStrategy.value, 'BALANCED');
  assert.deepEqual(registeredRouteFacts(chosen), { distance: '186 米', width: '2.5 米', slope: '1.7%', steps: '登记无台阶' });
  assert.deepEqual(registeredRouteFacts(planner.walkingReference.value), { distance: '166 米', width: '1.3 米', slope: '1.5%', steps: '登记无台阶' });
  assert.match(comparisonSummary(chosen, planner.walkingReference.value), /多走约 20米/);
  assert.equal(await planner.startNavigation(), true);
  assert.equal(planner.selectedRoute.value, chosen);
});

test('selected candidate comparison follows selection without replacing the route', async () => {
  const { planner } = setup(async () => response([walking]), [current, route(160)]);
  await planner.planRoutes();
  await planner.compareWalkingRoute();
  planner.selectRoute(1);
  assert.match(comparisonSummary(planner.selectedRoute.value, planner.walkingReference.value), /没有可展示的多走距离/);
  assert.equal(planner.selectedRoute.value.distance_m, 160);
});

for (const [name, fetchReference] of [
  ['offline', async () => { throw new TypeError('offline'); }],
  ['HTTP failure', async () => ({ ok: false, json: async () => ({ detail: 'unavailable' }) })],
  ['bad JSON', async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } })],
]) test(`${name} only affects comparison; navigation and inputs survive`, async () => {
  const { planner } = setup(fetchReference);
  await planner.planRoutes();
  const chosen = planner.selectedRoute.value;
  assert.equal(await planner.compareWalkingRoute(), false);
  assert.equal(planner.comparisonState.value, 'error');
  assert.match(planner.comparisonError.value, /导航不受影响/);
  assert.equal(planner.errorMessage.value, '');
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(planner.startName.value, places[0].value);
  assert.equal(planner.endName.value, places[1].value);
  assert.equal(await planner.startNavigation(), true);
});

for (const candidates of [[], [{ distance_m: null }], [{ distance_m: -1 }]]) test(`no valid reference ${JSON.stringify(candidates)} stays honest`, async () => {
  const { planner } = setup(async () => response(candidates));
  await planner.planRoutes();
  assert.equal(await planner.compareWalkingRoute(), false);
  assert.equal(planner.comparisonState.value, 'empty');
  assert.equal(planner.walkingReference.value, null);
  assert.match(comparisonSummary(current, null), /无法比较/);
  assert.equal(await planner.startNavigation(), true);
});

test('equal or longer reference never claims extra distance; invalid distances are not zero', () => {
  for (const distance of [186, 200]) assert.match(comparisonSummary(current, route(distance)), /没有可展示的多走距离/);
  assert.match(comparisonSummary({}, walking), /距离未记录/);
  assert.equal(shortestReturnedCandidate([{}, { distance_m: '2' }, { distance_m: NaN }]), null);
  for (const field of ['width_m', 'slope_percent', 'step_count']) {
    const incomplete = structuredClone(current);
    incomplete.segments.push({ width_m: 2, slope_percent: 1, step_count: 0, [field]: null });
    const result = registeredRouteFacts(incomplete);
    assert.equal(result[{width_m:'width', slope_percent:'slope', step_count:'steps'}[field]], '未记录');
  }
  assert.deepEqual(registeredRouteFacts({}), { distance:'未记录', width:'未记录', slope:'未记录', steps:'未记录' });
});

for (const [field, value] of [['startName','合成终点'], ['endName','合成起点'], ['mobilityType','CANE'], ['routeStrategy','FLATTEST']]) {
  test(`${field} clears existing and late reference`, async () => {
    const pending = deferred();
    let calls = 0;
    const { planner } = setup(() => ++calls === 1 ? response([walking]) : pending.promise);
    await planner.planRoutes();
    await planner.compareWalkingRoute();
    assert.ok(planner.walkingReference.value);
    const task = planner.compareWalkingRoute();
    planner[field].value = value;
    assert.equal(planner.walkingReference.value, null);
    assert.equal(planner.comparisonState.value, 'idle');
    pending.resolve(response([walking]));
    assert.equal(await task, false);
    assert.equal(planner.walkingReference.value, null);
    assert.equal(planner.comparisonAvailable.value, false);
  });
}

test('old success or failure cannot overwrite a newer reference', async () => {
  for (const failure of [false, true]) {
    const pending = deferred();
    let calls = 0;
    const { planner } = setup(() => ++calls === 1 ? pending.promise : response([route(170)]));
    await planner.planRoutes();
    const old = planner.compareWalkingRoute();
    await planner.compareWalkingRoute();
    if (failure) pending.reject(new Error('stale failure')); else pending.resolve(response([walking]));
    assert.equal(await old, false);
    assert.equal(planner.walkingReference.value.distance_m, 170);
    assert.equal(planner.comparisonState.value, 'ready');
  }
});

test('ordinary profile and GPS origin do not request manual reference', async () => {
  const { planner, urls } = setup(async () => response([walking]));
  planner.mobilityType.value = 'INDEPENDENT';
  await planner.planRoutes();
  assert.equal(await planner.compareWalkingRoute(), false);
  assert.equal(urls.length, 1);
  planner.mobilityType.value = 'WHEELCHAIR';
  planner.setCurrentOrigin({ timestamp:Date.now(), longitude:1, latitude:1, accuracy:10 }, {name:'合成道路',segment_code:'synthetic'});
  await planner.planRoutes();
  const count = urls.length;
  assert.equal(planner.comparisonAvailable.value, false);
  assert.equal(await planner.compareWalkingRoute(), false);
  assert.equal(urls.length, count);
});

test('only intersecting BLOCKED records are attributed, capped at eight', () => {
  const reference = { segment_codes:['a'], segments:[{segment_code:'b'}] };
  const rows = [{ segment_code:'x',avoidance_level:'BLOCKED' }, { segment_code:'a',avoidance_level:'WARNING' }, { segment_code:'b',avoidance_level:'BLOCKED',reasons:['登记理由'] }];
  assert.deepEqual(referenceBlockedSegments(rows, reference), [rows[2]]);
  assert.equal(referenceBlockedSegments(Array.from({length:12}, (_, i) => ({segment_code:`s${i}`, avoidance_level:'BLOCKED'})), {segment_codes:Array.from({length:12}, (_,i) => `s${i}`)}).length, 8);
});

test('entirely omitted or duplicated segment records cannot imply complete route facts', () => {
  for (const segments of [current.segments, [...current.segments, ...current.segments]]) {
    const incomplete = { ...current, segment_codes:['wide', 'missing'], segments };
    assert.deepEqual(registeredRouteFacts(incomplete), {distance:'186 米', width:'未记录', slope:'未记录', steps:'未记录'});
  }
});

test('page renders registered comparison, empty/error states and no inferred clearance', async () => {
  // Map loading is unrelated to the comparison. Isolate its browser-only import,
  // without editing components, providing keys, listening or making requests.
  const mapStub = { name:'comparison-map-test-stub', enforce:'pre',
    resolveId(source) { if (source.endsWith('/AmapRouteMap.vue') || source.endsWith('/EvidenceGallery.vue')) return '\0comparison-map-stub'; },
    load(id) { if (id === '\0comparison-map-stub') return 'export default { render: () => null }'; },
  };
  const server = await createServer({ configFile:false, envDir:false, plugins:[mapStub, vue()], server:{middlewareMode:true, watch:null}, optimizeDeps:{noDiscovery:true,include:[]} });
  try {
    const {default: Page} = await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render = extra => renderToString(createSSRApp(Page, { apiBaseUrl:'', selectedRoute:current, comparisonAvailable:true, comparisonState:'ready', walkingReference:walking, profileLabel:'轮椅老人', ...extra }));
    const html = await render({});
    for (const text of ['20米', '186 米', '166 米', '2.5 米', '1.3 米', '1.7%', '1.5%', '登记无台阶', '不可用于当前辅助设备导航', '不代表全局最短', '不表示没有障碍']) assert.ok(html.includes(text), text);
    assert.match(await render({walkingReference:route(186)}), /没有可展示的多走距离/);
    assert.match(await render({comparisonState:'empty',walkingReference:null}), /无法比较多走距离/);
    assert.match(await render({walkingReference:{distance_m:166}}), /未记录/);
    const failed = await render({comparisonState:'error',walkingReference:null,comparisonError:'参考不可用，导航不受影响'});
    assert.match(failed, /导航不受影响/);
    assert.doesNotMatch(failed, /多走约|<caption>/);
    assert.doesNotMatch(await render({comparisonAvailable:false}), /适老路线对比/);
  } finally { await server.close(); }
});
