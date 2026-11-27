import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSSRApp, createRenderer, h, reactive, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { detourRestBudgetFacts } from '../src/utils/detourRestBudget.js';
import { navigationRest } from '../src/utils/navigationRest.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';

// Synthetic registered route DTOs only; no backend, GPS or external requests.
function route(prefix, lengths, stopIndices = []) {
  const codes = lengths.map((_, i) => `${prefix}-${i}`);
  const nodes = ['A', ...lengths.slice(1).map((_, i) => `${prefix}-node-${i + 1}`), 'T'];
  return { distance_m: Math.round(lengths.reduce((sum, n) => sum + n, 0) * 100) / 100,
    segment_codes: codes, segments: codes.map((segment_code, i) => ({ segment_code, name: `合成路段${segment_code}`, length_m: lengths[i] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: [...codes],
      node_codes: nodes, segment_lengths_m: [...lengths],
      stops: stopIndices.map(i => ({ node_index: i, node_code: nodes[i], name: `合成休息点${i}` })) } };
}
const clone = value => structuredClone(value);
const pair = (baseline = route('direct', [260]), candidate = route('detour', [170, 170], [1])) => ({
  route: candidate, restBudgetEvidence: { baselineRoute: baseline, contextVerified: true, startName: '合成起点', endName: '合成终点' },
});

test('260 direct vs 340 via rest: longest 260 vs 170, budget 200 met only by candidate', () => {
  const facts = detourRestBudgetFacts(pair(), 200);
  assert.equal(facts.original.longest, 260); assert.equal(facts.candidate.longest, 170);
  assert.equal(facts.original.meetsBudget, false); assert.equal(facts.candidate.meetsBudget, true);
  assert.equal(facts.continuousDifference, -90); assert.equal(facts.totalDifference, 80);
  assert.equal(facts.candidate.firstOverLimit, null);
  assert.equal(detourRestBudgetFacts(pair(), '').candidate.meetsBudget, null);
  assert.equal(detourRestBudgetFacts(pair(), '200').candidate.meetsBudget, null);
  assert.equal(detourRestBudgetFacts(pair(), 100).candidate.meetsBudget, false);
});

test('246 vs 444 split 270+174: both exceed 200 and candidate gets worse', () => {
  const facts = detourRestBudgetFacts(pair(route('direct', [246]), route('detour', [270, 174], [1])), 200);
  assert.equal(facts.original.meetsBudget, false); assert.equal(facts.candidate.meetsBudget, false);
  assert.equal(facts.continuousDifference, 24); assert.equal(facts.totalDifference, 198);
  assert.deepEqual(facts.candidate.firstOverLimit, { from: '合成起点', to: '合成休息点1', distance: 270 });
});

test('multiple middle stops, endpoint stops, first over-limit interval and exact hundredths', () => {
  const p = pair(route('direct', [400]), route('detour', [50, 200.01, 20, 210], [0, 1, 2, 4]));
  const f = detourRestBudgetFacts(p, 200);
  assert.equal(f.candidate.longest, 230);
  assert.deepEqual(f.candidate.firstOverLimit, { from: '合成休息点1', to: '合成休息点2', distance: 200.01 });
  assert.equal(f.candidate.intervals.length, 3);
  const end = detourRestBudgetFacts(pair(undefined, route('detour', [170, 170], [0, 2])), 200);
  assert.equal(end.candidate.longest, 340);
  assert.deepEqual(end.candidate.firstOverLimit, { from: '合成起点', to: '合成终点', distance: 340 });
  const empty = detourRestBudgetFacts(pair(undefined, route('detour', [100, 100], [])), 200);
  assert.equal(empty.candidate.longest, 200); assert.equal(empty.candidate.meetsBudget, true);
  const decimal = detourRestBudgetFacts(pair(route('direct', [200.01]), route('detour', [73.63, 126.37, 1], [2])), 200);
  assert.equal(decimal.candidate.longest, 200); assert.equal(decimal.continuousDifference, -0.01);
});

const invalid = [
  r => r.start_context = { segment_code: 'gps' },
  r => delete r.navigation_rest, r => r.navigation_rest.source = 'unproven', r => r.navigation_rest.version = 2,
  r => delete r.navigation_rest.stops, r => r.navigation_rest.stops = null,
  r => r.navigation_rest.node_codes[0] = 'elsewhere', r => r.navigation_rest.node_codes[r.segment_codes.length] = 'elsewhere',
  r => r.navigation_rest.segment_codes.reverse(), r => r.segments.reverse(), r => r.distance_m++,
  r => r.navigation_rest.segment_lengths_m[0]++, r => r.navigation_rest.stops[0].node_code = 'wrong',
  r => r.navigation_rest.stops.push(clone(r.navigation_rest.stops[0])),
  r => r.navigation_rest.stops[0].name = ' ', r => r.navigation_rest.node_codes[1] = 'A',
  r => { r.distance_m = Number.MAX_VALUE; r.segments[0].length_m = Number.MAX_VALUE; r.navigation_rest.segment_lengths_m[0] = Number.MAX_VALUE; },
  r => { r.distance_m = 0.001; r.segments = [r.segments[0]]; r.segment_codes = [r.segment_codes[0]];
    Object.assign(r.navigation_rest, { segment_codes: [...r.segment_codes], node_codes: ['A', 'T'], segment_lengths_m: [0.001], stops: [] }); r.segments[0].length_m = 0.001; },
];
test('each independent route needs strict common evidence; missing/malformed never substitutes total distance', () => {
  for (const side of ['original', 'candidate']) for (const mutate of invalid) {
    const p = pair(route('direct', [130, 130], [1]));
    mutate(side === 'original' ? p.restBudgetEvidence.baselineRoute : p.route);
    assert.equal(detourRestBudgetFacts(p, 200), null, `${side}: ${mutate}`);
  }
  for (const patch of [{ contextVerified: false }, { contextVerified: undefined }, { startName: '' }, { endName: null }]) {
    const p = pair(); Object.assign(p.restBudgetEvidence, patch); assert.equal(detourRestBudgetFacts(p, 200), null);
  }
  assert.equal(detourRestBudgetFacts({ route: route('candidate', [340]) }, 200), null);
  // Preserve ordinary navigation's existing semantics, including sub-hundredth lengths.
  const ordinary = route('tiny', [0.001]);
  ordinary.distance_m = 0.001;
  assert.equal(navigationRest(ordinary, 0).state, 'none');
  assert.equal(navigationRest(route('normal', [170, 170], [1]), 0).distance, 170);
});

const context = { start_name: '合成起点', end_name: '合成终点', mobility_type: 'WHEELCHAIR', strategy: 'BALANCED' };
const response = payload => ({ ok: true, json: async () => payload });
function setup({ baseline = route('direct', [260]), candidate = route('detour', [170, 170], [1]), baselinePatch = {}, candidatePatch = {}, query } = {}) {
  const urls = [], navigations = [], places = ['合成起点', '合成终点', '其他地点'].map(value => ({ value, label: value }));
  const payload = { ...context, routes: [candidate], excluded_segment_code: baseline.segment_codes[0], ...candidatePatch };
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    router: { push: async path => navigations.push(path) }, fetcher: async url => {
      urls.push(url); return url.includes('exclude_segment_code=') ? (query ? query(payload) : response(payload))
        : response({ ...context, routes: [baseline, route('other', [280])], ...baselinePatch });
    } });
  planner.startName.value = context.start_name; planner.endName.value = context.end_name;
  return { planner, urls, navigations };
}
const facts = planner => detourRestBudgetFacts(planner.exclusionPreview.value, 200);
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('preview snapshots baseline evidence; no extra requests, route changes or automatic navigation', async () => {
  const pending = deferred(); const { planner, urls, navigations } = setup({ query: () => pending.promise });
  await planner.planRoutes(); const original = planner.selectedRoute.value;
  const task = planner.previewExclusion('direct-0');
  original.navigation_rest.stops = [{ node_index: 0, node_code: 'A', name: 'after snapshot' }];
  original.navigation_rest.segment_lengths_m[0] = 999;
  pending.resolve(response({ ...context, routes: [route('detour', [170, 170], [1])], excluded_segment_code: 'direct-0' }));
  assert.equal(await task, true); assert.equal(facts(planner).original.longest, 260);
  assert.equal(planner.selectedRoute.value, original); assert.equal(urls.length, 2); assert.deepEqual(navigations, []);
  assert.equal(await planner.startNavigation(), true); assert.deepEqual(navigations, ['/elder/navigation']);
  assert.equal(planner.selectedRoute.value, original); assert.equal(planner.restPreview.value, null);
});

test('both route responses require exact named trip context, independently of legacy preview availability', async () => {
  for (const side of ['baselinePatch', 'candidatePatch']) for (const patch of [
    { start_name: undefined }, { start_name: 'wrong' }, { end_name: 'wrong' }, { mobility_type: 'CANE' },
    { strategy: 'COMFORT' }, { start_context: { segment_code: 'gps' } },
  ]) {
    const { planner } = setup({ [side]: patch }); await planner.planRoutes();
    assert.equal(await planner.previewExclusion('direct-0'), true); assert.equal(facts(planner), null, `${side}: ${JSON.stringify(patch)}`);
  }
  const { planner } = setup(); await planner.planRoutes(); await planner.previewExclusion('direct-0');
  assert.equal(facts(planner).candidate.longest, 170);
  planner.routes.value[0] = route('direct', [260]);
  assert.equal(await planner.previewExclusion('direct-0'), true);
  assert.equal(facts(planner), null, 'unproven replacement cannot inherit response proof even with identical segment codes');
});

test('planner never substitutes a counterpart catalogue or rest preview for absent exact-route evidence', async () => {
  for (const side of ['baseline', 'candidate']) {
    const baseline = route('direct', [260]), candidate = route('detour', [170, 170], [1]);
    delete (side === 'baseline' ? baseline : candidate).navigation_rest;
    const { planner } = setup({ baseline, candidate }); await planner.planRoutes();
    planner.restPreview.value = { stop_name: 'unrelated', segment_lengths_m: [100, 100] };
    assert.equal(await planner.previewExclusion('direct-0'), true);
    assert.equal(facts(planner), null);
  }
});

for (const change of ['startName', 'endName', 'mobilityType', 'routeStrategy', 'selection', 'replan', 'leave', 'origin']) {
  test(`${change} invalidates completed and delayed paired evidence`, async () => {
    const pending = deferred(); let calls = 0;
    const { planner } = setup({ query: payload => ++calls === 1 ? response(payload) : pending.promise });
    await planner.planRoutes(); await planner.previewExclusion('direct-0'); assert.ok(facts(planner));
    const task = planner.previewExclusion('direct-0');
    if (change === 'selection') planner.selectRoute(1);
    else if (change === 'replan') await planner.planRoutes();
    else if (change === 'leave') planner.clearExclusionPreview();
    else if (change === 'origin') planner.beginCurrentOrigin();
    else planner[change].value = { startName: '其他地点', endName: '其他地点', mobilityType: 'CANE', routeStrategy: 'COMFORT' }[change];
    pending.resolve(response({ ...context, routes: [route('detour', [170, 170], [1])], excluded_segment_code: 'direct-0' }));
    assert.equal(await task, false); assert.equal(facts(planner), null); assert.equal(planner.exclusionState.value, 'idle');
  });
}

test('older success or failure cannot overwrite newer paired evidence', async () => {
  for (const fail of [false, true]) {
    const pending = deferred(); let calls = 0;
    const { planner } = setup({ query: payload => ++calls === 1 ? pending.promise : response(payload) });
    await planner.planRoutes(); const old = planner.previewExclusion('direct-0'); await planner.previewExclusion('direct-0');
    if (fail) pending.reject(Error('old')); else pending.resolve(response({ ...context, routes: [route('old', [999])], excluded_segment_code: 'direct-0' }));
    assert.equal(await old, false); assert.equal(facts(planner).candidate.longest, 170);
  }
});

test('rendered comparison names original/candidate longest walks, totals and unavailable evidence', async () => {
  const stub = { name: 'detour-budget-no-map', enforce: 'pre',
    resolveId(source) { if (/\/(AmapRouteMap|FallbackRouteMap|EvidenceGallery)\.vue$/.test(source)) return '\0detour-budget-map'; },
    load(id) { if (id === '\0detour-budget-map') return 'export default { render: () => null }'; } };
  const server = await createServer({ configFile: false, envDir: false, plugins: [stub, vue()],
    server: { middlewareMode: true, watch: null, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render = preview => renderToString(createSSRApp(Page, { apiBaseUrl: '', exclusionOptions: [{ segment_code: 'direct-0', name: '合成路段' }],
      exclusionState: 'ready', exclusionPreview: { name: '合成排除段', baselineDistance: 260, ...preview } }));
    const html = await render(pair());
    for (const text of ['绕行前后连续步行对比', '原所选路线', '绕行候选', '260 米', '170 米', '340 米', '缩短 90 米', '尚未设置预算', '不保证有座位', '适合休息']) assert.ok(html.includes(text), text);
    assert.equal((html.match(/aria-label="连续步行预算"/g) ?? []).length, 1);
    assert.match(await render(pair(route('direct', [246]), route('detour', [270, 174], [1]))), /增加 24 米/);
    const missing = pair(); delete missing.route.navigation_rest;
    const unavailable = await render(missing);
    assert.match(unavailable, /连续步行对比暂不可用/); assert.doesNotMatch(unavailable, /最长连续登记步行：/);
  } finally { await server.close(); }
});

test('shared preference updates bound UI facts, names first failing interval, and emits no request', async () => {
  const url = new URL('../src/pages/RouteOptionsPage.vue', import.meta.url);
  let script = compileScript(parse(await readFile(url, 'utf8')).descriptor, { id: 'detour-budget-binding' }).content;
  script = script.replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}={render:()=>null};`)
    .replace(/from '([^']+)'/g, (_, specifier) => `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  const { default: Page } = await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`); Page.render = () => null;
  const previousWindow = globalThis.window; globalThis.window = { matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {} };
  const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, patchProp() {}, insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
  const state = reactive({ exclusionOptions: [{ segment_code: 'direct-0', name: '合成路段' }], exclusionState: 'ready',
    exclusionPreview: pair(route('direct', [246]), route('detour', [270, 174], [1])), restPreviewAvailable: true,
    restPreview: { stop_name: '合成休息点1', segment_codes: ['x', 'y'], segment_names: ['x', 'y'], segment_lengths_m: [270, 174],
      stop_after_segment_index: 0, distance_m: 444, baseline_distance_m: 246, matches_baseline: false } });
  let vm; const events = [];
  const app = renderer.createApp({ render: () => h(Page, { apiBaseUrl: '', ...state, ref: v => { vm = v; }, onPreviewExclusion: () => events.push('request'), onStartNavigation: () => events.push('navigate') }) });
  try {
    app.mount({}); const page = vm.$.setupState;
    assert.equal(page.continuousBudget, ''); page.continuousBudget = 200;
    assert.equal(page.detourBudgetFacts.candidate.meetsBudget, false); assert.equal(page.budgetFacts.meetsBudget, false);
    assert.match(page.detourOverLimitText, /合成起点 → 合成休息点1.*270 米.*70 米/);
    page.continuousBudget = 300;
    assert.equal(page.detourBudgetFacts.candidate.meetsBudget, true); assert.equal(page.budgetFacts.meetsBudget, true);
    assert.equal(page.detourOverLimitText, '');
    state.exclusionPreview = pair(undefined, route('detour', [100, 250], [1])); await nextTick(); page.continuousBudget = 200;
    assert.match(page.detourOverLimitText, /合成休息点1 → 合成终点.*250 米/);
    state.restPreviewAvailable = false; state.exclusionOptions = []; state.exclusionPreview = null; await nextTick();
    assert.equal(page.continuousBudget, ''); assert.equal(page.detourBudgetFacts, null); assert.deepEqual(events, []);
  } finally { app.unmount(); globalThis.window = previousWindow; }
});
