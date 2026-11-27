import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { readFile } from 'node:fs/promises';

// Synthetic fixtures; not API/DB integration.
const route = (code, distance = 100) => ({ distance_m: distance, segment_codes: [code], segments: [{ segment_code: code, name: `测试路段${code}` }] });
const original = route('original');
const places = ['测试起点', '测试终点', '其他点'].map(value => ({ value, label: value }));
const response = (routes = [route('alternate', 140)], extra = {}) => ({ ok: true, json: async () => ({ routes, excluded_segment_code: 'original', ...extra }) });
function setup(query = async () => response()) {
  const urls = [], navigations = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    router: { push: async path => navigations.push(path) },
    fetcher: async url => { urls.push(url); return url.includes('exclude_segment_code=') ? query(url) : response([original, route('other')]); } });
  planner.startName.value = places[0].value;
  planner.endName.value = places[1].value;
  return { planner, urls, navigations };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test('explicit preview keeps original route, ordinary request and navigation unchanged', async () => {
  const { planner, urls, navigations } = setup();
  await planner.planRoutes();
  assert.equal(urls.length, 1);
  assert.ok(!urls[0].includes('exclude_segment_code'));
  const chosen = planner.selectedRoute.value;
  assert.equal(await planner.previewExclusion('unknown'), false);
  assert.equal(urls.length, 1);
  assert.equal(await planner.previewExclusion('original'), true);
  assert.deepEqual(Object.fromEntries(new URL(urls[1], 'http://synthetic.test').searchParams), {
    start_name: places[0].value, end_name: places[1].value, mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', exclude_segment_code: 'original',
  });
  assert.equal(planner.exclusionPreview.value.route.distance_m, 140);
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(planner.endName.value, places[1].value);
  assert.equal(planner.restPreview.value, null);
  assert.equal(await planner.startNavigation(), true);
  assert.deepEqual(navigations, ['/elder/navigation']);
  assert.equal(planner.selectedRoute.value, chosen);
});

for (const [name, query, state] of [
  ['actual no path', async () => ({ ok: false, status: 404, json: async () => ({ detail: { code: 'NO_ROUTE_WITH_EXCLUSION' } }) }), 'empty'],
  ['generic 404', async () => ({ ok: false, status: 404, json: async () => ({ detail: 'POI missing' }) }), 'error'],
  ['unknown code', async () => ({ ok: false, status: 422, json: async () => ({ detail: 'unknown' }) }), 'error'],
  ['network', async () => { throw new TypeError('offline'); }, 'error'],
  ['bad json', async () => ({ ok: true, json: async () => { throw new Error('json'); } }), 'error'],
  ['omitted echo', async () => response(undefined, { excluded_segment_code: undefined }), 'error'],
  ['excluded code returned', async () => response([original]), 'error'],
  ['missing details', async () => response([{ ...route('alt'), segments: [] }]), 'error'],
  ['empty success is unconfirmed', async () => response([]), 'error'],
]) test(`${name}: ${state}, never fall back or replace original`, async () => {
  const { planner } = setup(query);
  await planner.planRoutes();
  const chosen = planner.selectedRoute.value;
  assert.equal(await planner.previewExclusion('original'), false);
  assert.equal(planner.exclusionState.value, state);
  assert.equal(planner.exclusionPreview.value, null);
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(await planner.startNavigation(), true);
});

for (const field of ['startName', 'endName', 'mobilityType', 'routeStrategy', 'selection', 'replan', 'leave', 'origin']) {
  test(`${field} clears result and delayed response`, async () => {
    const pending = deferred();
    const { planner } = setup(() => pending.promise);
    await planner.planRoutes();
    const task = planner.previewExclusion('original');
    if (field === 'selection') planner.selectRoute(1);
    else if (field === 'replan') await planner.planRoutes();
    else if (field === 'leave') planner.clearExclusionPreview();
    else if (field === 'origin') planner.beginCurrentOrigin();
    else planner[field].value = { startName: places[2].value, endName: places[2].value, mobilityType: 'CANE', routeStrategy: 'COMFORT' }[field];
    pending.resolve(response());
    assert.equal(await task, false);
    assert.equal(planner.exclusionPreview.value, null);
    assert.equal(planner.exclusionState.value, 'idle');
  });
}

test('older success/failure cannot overwrite newer preview; GPS hides options', async () => {
  for (const fail of [false, true]) {
    const pending = deferred(); let calls = 0;
    const { planner } = setup(() => ++calls === 1 ? pending.promise : response());
    await planner.planRoutes();
    const old = planner.previewExclusion('original');
    await planner.previewExclusion('original');
    if (fail) pending.reject(new Error('stale')); else pending.resolve(response([route('old')]));
    assert.equal(await old, false);
    assert.equal(planner.exclusionPreview.value.route.segment_codes[0], 'alternate');
    planner.setCurrentOrigin({ timestamp: Date.now(), longitude: 1, latitude: 1, accuracy: 10 }, { name: '定位路段', segment_code: 'gps' });
    await planner.planRoutes();
    assert.deepEqual(planner.exclusionOptions.value, []);
  }
});

test('only named on-route unambiguous records are selectable; ready preview clears on selection', async () => {
  const { planner } = setup();
  await planner.planRoutes();
  planner.routes.value[0].segments.push({ segment_code: 'elsewhere', name: 'not on route' });
  assert.deepEqual(planner.exclusionOptions.value.map(s => s.segment_code), ['original']);
  await planner.previewExclusion('original');
  planner.selectRoute(1);
  assert.equal(planner.exclusionPreview.value, null);
  assert.equal(await planner.previewExclusion('original'), false);
});

test('page renders signed preview, honest no-path/error and lifecycle wiring', async () => {
  const stub = { name: 'exclusion-test-stub', enforce: 'pre',
    resolveId(source) { if (source.endsWith('/AmapRouteMap.vue') || source.endsWith('/EvidenceGallery.vue')) return '\0exclusion-stub'; },
    load(id) { if (id === '\0exclusion-stub') return 'export default { render: () => null }'; } };
  const server = await createServer({ configFile: false, envDir: false, plugins: [stub, vue()], server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render = extra => renderToString(createSSRApp(Page, { apiBaseUrl: '', exclusionOptions: original.segments,
      exclusionState: 'ready', exclusionPreview: { name: '测试排除段', baselineDistance: 100, route: route('alt', 140) }, ...extra }));
    const html = await render({});
    for (const text of ['本次避开此路段', '测试排除段', '140 米', '增加 40 米', '+40 米', '不提供此候选导航', '可能包含该路段']) assert.ok(html.includes(text), text);
    assert.match(await render({ exclusionPreview: { baselineDistance: 100, route: route('alt', 80) } }), /减少 20 米/);
    assert.match(await render({ exclusionPreview: { baselineDistance: 100, route: route('alt', 100) } }), /距离不变/);
    assert.match(await render({ exclusionState: 'empty' }), /暂无符合相同出行条件/);
    assert.match(await render({ exclusionState: 'error' }), /暂未确认/);
    assert.doesNotMatch(await render({ exclusionOptions: [] }), /本次避开此路段/);
    const page = await readFile(new URL('../src/pages/RouteOptionsPage.vue', import.meta.url), 'utf8');
    const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
    assert.match(page, /onBeforeUnmount\(\(\) => emit\('clear-exclusion'\)\)/);
    assert.match(app, /watch\(\(\) => route.path, clearExclusionPreview, \{ flush: 'sync' \}\)/);
  } finally { await server.close(); }
});
