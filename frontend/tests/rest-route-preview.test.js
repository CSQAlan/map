import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { readFile } from 'node:fs/promises';

// Synthetic fixtures only, not a live API or seed integration.
const places = ['测试起点', '测试终点', '另一个点'].map(value => ({ value, label: value }));
const primary = { distance_m: 100, segment_codes: ['base'], segments: [] };
const preview = { stop_name: '合成休息点', stop_after_segment_index: 0,
  baseline_distance_m: 100, distance_m: 130, baseline_steps: 0, steps: 2,
  segment_codes: ['one', 'two'], segment_names: ['合成第一段', '合成第二段'], matches_baseline: false };
const response = rest => ({ ok: true, json: async () => ({ routes: [primary], rest_preview: rest }) });
function setup(fetchPreview = async () => response(preview)) {
  const urls = [], pushes = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    router: { push: async path => pushes.push(path) },
    fetcher: async url => { urls.push(url); return url.includes('prefer_rest=true') ? fetchPreview(url) : response(null); } });
  planner.startName.value = places[0].value;
  planner.endName.value = places[1].value;
  planner.mobilityType.value = 'SLOW_WALKER';
  return { planner, urls, pushes };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('explicit same-context request does not replace routes, inputs, selection or navigation', async () => {
  const { planner, urls, pushes } = setup();
  assert.equal(await planner.previewRestRoute(), false);
  assert.equal(urls.length, 0);
  planner.routeStrategy.value = 'COMFORT';
  await planner.planRoutes();
  assert.equal(urls.length, 1);
  assert.equal(planner.restPreviewState.value, 'idle');
  const chosen = planner.selectedRoute.value;
  const status = planner.actionStatus.value;
  assert.equal(await planner.previewRestRoute(), true);
  assert.deepEqual(Object.fromEntries(new URL(urls[1], 'http://synthetic.test').searchParams), {
    start_name: places[0].value, end_name: places[1].value, mobility_type: 'SLOW_WALKER', strategy: 'COMFORT', prefer_rest: 'true',
  });
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(planner.actionStatus.value, status);
  assert.equal(planner.startName.value, places[0].value);
  assert.equal(planner.endName.value, places[1].value);
  assert.equal(planner.selectedRouteIndex.value, 0);
  assert.equal(await planner.startNavigation(), true);
  assert.deepEqual(pushes, ['/elder/navigation']);
  assert.equal(planner.selectedRoute.value, chosen);
});

test('only planned named slow-walker trips may query; no wheelchair or GPS relaxation', async () => {
  const { planner, urls } = setup();
  for (const profile of ['WHEELCHAIR', 'CANE', 'INDEPENDENT']) {
    planner.mobilityType.value = profile;
    await planner.planRoutes();
    const count = urls.length;
    assert.equal(await planner.previewRestRoute(), false);
    assert.equal(urls.length, count);
  }
  planner.mobilityType.value = 'SLOW_WALKER';
  planner.setCurrentOrigin({ timestamp: Date.now(), longitude: 1, latitude: 1, accuracy: 10 }, { name: '测试路段', segment_code: 'gps' });
  await planner.planRoutes();
  assert.equal(planner.restPreviewAvailable.value, false);
  assert.equal(await planner.previewRestRoute(), false);
});

for (const [name, fetchPreview, state] of [
  ['explicit null', async () => response(null), 'empty'],
  ['network failure', async () => { throw new TypeError('offline'); }, 'error'],
  ['HTTP failure', async () => ({ ...response(null), ok: false }), 'error'],
  ['bad JSON', async () => ({ ok: true, json: async () => { throw new Error('bad JSON'); } }), 'error'],
  ['missing preview', async () => response(undefined), 'error'],
  ['missing routes', async () => ({ ok: true, json: async () => ({ rest_preview: null }) }), 'error'],
  ['missing distance', async () => response({ ...preview, distance_m: null }), 'error'],
  ['missing steps field', async () => response({ ...preview, steps: undefined }), 'error'],
  ['invalid order', async () => response({ ...preview, stop_after_segment_index: 1 }), 'error'],
]) test(`${name}: precise empty vs unconfirmed without affecting navigation`, async () => {
  const { planner } = setup(fetchPreview);
  await planner.planRoutes();
  const chosen = planner.selectedRoute.value;
  assert.equal(await planner.previewRestRoute(), false);
  assert.equal(planner.restPreviewState.value, state);
  assert.equal(planner.restPreview.value, null);
  assert.equal(planner.selectedRoute.value, chosen);
  assert.equal(planner.errorMessage.value, '');
  assert.equal(await planner.startNavigation(), true);
});

test('explicit unknown stairs stay null rather than becoming zero', async () => {
  const { planner } = setup(async () => response({ ...preview, steps: null, baseline_steps: null }));
  await planner.planRoutes();
  assert.equal(await planner.previewRestRoute(), true);
  assert.equal(planner.restPreview.value.steps, null);
});

for (const field of ['startName', 'endName', 'mobilityType', 'routeStrategy', 'replan', 'unmount', 'origin']) {
  test(`${field} clears ready and late preview, including delayed body`, async () => {
    const pending = deferred();
    let calls = 0;
    const { planner } = setup(async () => ++calls === 1 ? response(preview) : { ok: true, json: () => pending.promise });
    await planner.planRoutes();
    await planner.previewRestRoute();
    assert.ok(planner.restPreview.value);
    const task = planner.previewRestRoute();
    await Promise.resolve();
    if (field === 'replan') await planner.planRoutes();
    else if (field === 'unmount') planner.clearRestPreview();
    else if (field === 'origin') planner.beginCurrentOrigin();
    else planner[field].value = { startName: places[2].value, endName: places[2].value, mobilityType: 'CANE', routeStrategy: 'FLATTEST' }[field];
    assert.equal(planner.restPreview.value, null);
    assert.equal(planner.restPreviewState.value, 'idle');
    pending.resolve({ routes: [primary], rest_preview: preview });
    assert.equal(await task, false);
    assert.equal(planner.restPreview.value, null);
    assert.equal(planner.restPreviewState.value, 'idle');
  });
}

test('old success or failure cannot overwrite latest preview', async () => {
  for (const fails of [false, true]) {
    const pending = deferred();
    let calls = 0;
    const { planner } = setup(() => ++calls === 1 ? pending.promise : response({ ...preview, stop_name: '新结果' }));
    await planner.planRoutes();
    const old = planner.previewRestRoute();
    await planner.previewRestRoute();
    if (fails) pending.reject(new Error('stale')); else pending.resolve(response(preview));
    assert.equal(await old, false);
    assert.equal(planner.restPreview.value.stop_name, '新结果');
    assert.equal(planner.restPreviewState.value, 'ready');
  }
});

test('page renders signed differences, ordered stop and unknown stairs; lifecycle is wired', async () => {
  const stub = { name: 'rest-preview-map-stub', enforce: 'pre',
    resolveId(source) { if (source.endsWith('/AmapRouteMap.vue') || source.endsWith('/EvidenceGallery.vue')) return '\0rest-map-stub'; },
    load(id) { if (id === '\0rest-map-stub') return 'export default { render: () => null }'; } };
  const server = await createServer({ configFile: false, envDir: false, plugins: [stub, vue()],
    server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render = extra => renderToString(createSSRApp(Page, { apiBaseUrl: '', restPreviewAvailable: true,
      restPreviewState: 'ready', restPreview: preview, ...extra }));
    const html = await render({});
    for (const text of ['合成休息点', '130 米', '+30 米', '长 30 米', '此方案 2 级', '默认首选 0 级', '第 1 段', '此段之后经过', '不提供此方案导航', '不保证有座位']) assert.ok(html.includes(text), text);
    assert.match(await render({ restPreview: { ...preview, distance_m: 80 } }), /短 20 米（差值 −20 米）/);
    assert.match(await render({ restPreview: { ...preview, distance_m: 100, matches_baseline: true } }), /相同（差值 0 米）/);
    assert.match(await render({ restPreview: { ...preview, steps: null, baseline_steps: null } }), /此方案 未记录；默认首选 未记录/);
    assert.match(await render({ restPreviewState: 'empty', restPreview: null }), /本次搜索候选中未找到/);
    assert.match(await render({ restPreviewState: 'error', restPreview: null }), /暂未确认/);
    assert.doesNotMatch(await render({ restPreviewAvailable: false }), /data-testid="rest-preview"/);
    assert.doesNotMatch(html, /设为目的地|导航此方案/);
    const page = await readFile(new URL('../src/pages/RouteOptionsPage.vue', import.meta.url), 'utf8');
    const app = await readFile(new URL('../src/App.vue', import.meta.url), 'utf8');
    assert.match(page, /onBeforeUnmount\(\(\) => emit\('clear-rest-preview'\)\)/);
    assert.match(app, /@clear-rest-preview="clearRestPreview"/);
    assert.match(app, /watch\(\(\) => route.path, clearRestPreview, \{ flush: 'sync' \}\)/);
  } finally { await server.close(); }
});
