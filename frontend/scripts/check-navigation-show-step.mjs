import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// The actual component, synthetic parent and SDK only. Every request is checked
// before navigation; no backend, real GPS, screenshots, downloads or saved traces.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
function makeRoute() {
  const segment_codes = ['S_SYNTHETIC_START', 'S_SYNTHETIC_MIDDLE', 'S_SYNTHETIC_END'];
  const rows = segment_codes.map((segment_code, i) => ({ segment_code,
    name: ['合成入口道路', '内部主路到楼栋组团B', '合成终点道路'][i],
    length_m: [80, 100, 150][i], step_count: [0, 0, 7][i], width_m: 2, risk_tags: [],
    explanation: 'SYNTHETIC_PRIVATE_EXPLANATION' }));
  return { distance_m: 330, segment_codes, segments: [rows[2], rows[0], rows[1]],
    origin_name: 'SYNTHETIC_PRIVATE_ORIGIN', destination_name: 'SYNTHETIC_PRIVATE_DESTINATION',
    private_address: 'SYNTHETIC_PRIVATE_ADDRESS', session: 'SYNTHETIC_PRIVATE_SESSION' };
}
function makeFeatures(route) {
  return [...route.segment_codes.map((code, i) => ({ type: 'Feature',
    properties: { ...route.segments.find(row => row.segment_code === code), kind: 'segment' },
    geometry: { type: 'LineString', coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] } })),
    { type: 'Feature', properties: { kind: 'segment', segment_code: 'S_SYNTHETIC_OTHER', name: '合成地图另选道路' },
      geometry: { type: 'LineString', coordinates: [[10, 10.001], [10.003, 10.001]] } }];
}
const fixture = `import { createApp, h, reactive } from 'vue';
import NavigationPage from '/src/pages/NavigationPage.vue';
import '/src/styles.css';
const makeRoute = ${makeRoute.toString()};
const makeFeatures = ${makeFeatures.toString()};
const selectedRoute = makeRoute();
const state = reactive({ selectedRoute, mapFeatures: makeFeatures(selectedRoute), apiBaseUrl: location.origin,
  selectedProfile: { label: '轮椅老人', phone: 'SYNTHETIC_PRIVATE_PHONE' },
  selectedSegmentCode: 'S_SYNTHETIC_END', textMemoRouteVerified: true, memoScope: 0,
  guidancePaused: false, detourActive: false, progress: { index: 1, paused: false },
  obstructionState: { options: [], reason: '' },
  mapFailure: location.search.includes('fallback') ? '合成底图不可用' : '',
  pilotArea: { center: [10,10], min_zoom: 16, max_zoom: 20,
    limit_bounds: { south_west: [9.99,9.99], north_east: [10.01,10.01] },
    boundary: { coordinates: [[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]] } } });
const events = [], session = reactive({ role: 'elder', view: 'navigation', key: 0 });
function syncObstruction() {
  state.obstructionState = { reason: '', options: [state.progress.index, state.progress.index + 1].flatMap(index => {
    const code = state.selectedRoute.segment_codes[index];
    const row = state.selectedRoute.segments.find(row => row.segment_code === code);
    return row ? [{ route: state.selectedRoute, manualIndex: state.progress.index, index,
      segment_code: code, name: row.name, kind: index === state.progress.index ? 'current' : 'next' }] : [];
  }) };
}
function restore() {
  session.role = 'elder'; session.view = 'navigation'; session.key++;
  state.selectedRoute = makeRoute(); state.mapFeatures = makeFeatures(state.selectedRoute);
  state.selectedProfile = { label: '轮椅老人', phone: 'SYNTHETIC_PRIVATE_PHONE' };
  state.progress = { index: 1, paused: false }; state.selectedSegmentCode = 'S_SYNTHETIC_END';
  state.guidancePaused = false; state.detourActive = false; state.textMemoRouteVerified = true;
  state.memoScope++; syncObstruction();
}
syncObstruction();
const app = createApp({ render: () => session.role === 'elder' && session.view === 'navigation'
  ? h(NavigationPage, { ...state, key: session.key,
    onSelectSegment: code => { state.selectedSegmentCode = code; events.push({ select: code }); },
    onProgress: progress => { state.progress = progress; events.push({ progress }); syncObstruction(); },
    onPauseDetour: message => { state.guidancePaused = true; events.push({ pause: message }); },
    onMapError: message => { state.mapFailure = message; events.push({ mapError: message }); },
    onConfirmObstruction: choice => { events.push({ obstruction: choice.segment_code });
      state.guidancePaused = true; state.detourActive = true; state.textMemoRouteVerified = false; state.memoScope++; },
    onEndNavigation: () => { events.push({ end: true }); session.view = 'routes'; },
    onOpenRoutes: () => { events.push({ leave: true }); session.view = 'routes'; },
    onSendSos: () => events.push({ sos: true }) })
  : h('p', session.role === 'elder' ? '合成路线视图' : '合成家庭视图') });
window.__showFixture = { state, events, session, app, restore, makeRoute, makeFeatures }; app.mount('#app');`;

function installMocks() {
  const audit = window.__showAudit = { fetches: [], xhr: [], beacon: [], storage: [], files: [], clipboard: [],
    shares: [], objectUrls: [], anchors: [], indexedDB: [], caches: [], permissions: [], sockets: [],
    watches: 0, clears: 0, captures: 0, spoken: [], cancels: 0,
    wakeRequests: 0, wakeReleases: 0, cameras: [], mapChanges: [], overlays: [], maps: [] };
  const originalFetch = window.fetch;
  window.fetch = function (...args) { audit.fetches.push(String(args[0])); return originalFetch.apply(this, args); };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) { audit.xhr.push(args.slice(0, 2)); return originalOpen.apply(this, args); };
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: (...args) => { audit.beacon.push(String(args[0])); return false; } });
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { audit.captures++; },
    watchPosition(ok, bad) { audit.ok = ok; audit.bad = bad; return ++audit.watches; },
    clearWatch() { audit.clears++; },
  } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'zh-CN', localService: true, name: '合成本地中文' }],
    speak(utterance) { audit.spoken.push({ text: utterance.text, rate: utterance.rate }); },
    cancel() { audit.cancels++; },
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { async request() {
    audit.wakeRequests++;
    return { released: false, addEventListener() {}, async release() { this.released = true; audit.wakeReleases++; } };
  } } });
  for (const method of ['getItem', 'setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      audit.storage.push({ method, args, kind: this === localStorage ? 'local' : 'session' });
      return original.apply(this, args);
    };
  }
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: Object.fromEntries(
    ['read', 'readText', 'write', 'writeText'].map(method => [method, async (...args) => { audit.clipboard.push({ method, args }); return ''; }])) });
  for (const method of ['share', 'canShare']) Object.defineProperty(navigator, method, { configurable: true,
    value: (...args) => { audit.shares.push({ method, args }); return method === 'canShare' ? false : Promise.resolve(); } });
  for (const method of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) window[method] = async () => {
    audit.files.push(method); throw new DOMException('Synthetic picker disabled', 'AbortError');
  };
  for (const method of ['createObjectURL', 'revokeObjectURL']) {
    const original = URL[method];
    URL[method] = function (...args) { audit.objectUrls.push(method); return original.apply(this, args); };
  }
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (...args) {
    audit.anchors.push({ href: this.href, download: this.download });
    return originalClick.apply(this, args);
  };
  for (const method of ['open', 'deleteDatabase']) {
    const original = indexedDB[method].bind(indexedDB);
    indexedDB[method] = (...args) => { audit.indexedDB.push({ method, args }); return original(...args); };
  }
  for (const method of ['open', 'delete']) {
    const original = caches[method].bind(caches);
    caches[method] = (...args) => { audit.caches.push({ method, args }); return original(...args); };
  }
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: {
    query: async value => { audit.permissions.push(value); return { state: 'denied', addEventListener() {} }; },
  } });
  for (const name of ['WebSocket', 'EventSource']) window[name] = class { constructor(url) { audit.sockets.push({ name, url }); } close() {} };
  class Emitter {
    constructor(options = {}) { this.options = options; this.handlers = {}; }
    on(name, fn) { (this.handlers[name] ||= []).push(fn); }
    off(name, fn) { this.handlers[name] = (this.handlers[name] || []).filter(item => item !== fn); }
  }
  class Overlay extends Emitter {
    setOptions(value) { Object.assign(this.options, value); audit.mapChanges.push('options'); }
    setPosition(value) { this.options.position = value; audit.mapChanges.push('position'); }
    setCenter(value) { this.options.center = value; audit.mapChanges.push('center'); }
    setRadius(value) { this.options.radius = value; audit.mapChanges.push('radius'); }
  }
  class Polyline extends Overlay { constructor(options) { super(options); audit.overlays.push(this); } }
  class Map extends Emitter {
    constructor() { super(); audit.maps.push(this); }
    setLimitBounds() {} addControl() {} resize() {}
    add() { audit.mapChanges.push('add'); } remove() { audit.mapChanges.push('remove'); }
    setFitView(items) { audit.cameras.push({ type: 'fit', codes: [items].flat().map(item => item.options.extData?.segmentCode).filter(Boolean) }); }
    setZoomAndCenter(zoom, point) { audit.cameras.push({ type: 'center', zoom, point: [...point] }); }
    destroy() { audit.mapChanges.push('destroy'); }
  }
  window.__showSdk = { Map, Polyline, Polygon: Overlay, Circle: Overlay, Marker: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'navigation-show-step-memory-fixture',
    resolveId(id) { if (id === '/__navigation_show_fixture.js') return '\0navigation-show-fixture'; },
    load(id) { if (id === '\0navigation-show-fixture') return fixture; },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_show', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__navigation_show_fixture.js"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set(), audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const opener = page => button(page, '给身边的人看');
const card = page => page.getByTestId('navigation-show-step');
const text = page => page.getByTestId('navigation-show-step-text');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function setup(provider) {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider, requests: [], api: [], external: [], rejected: [], errors: [], downloads: 0 };
  audits.push(audit);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()); audit.requests.push(url.href);
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return route.abort('blockedbyclient'); }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__showSdk;}' });
    if (request.method() === 'GET' && (url.pathname === '/__navigation_show' || url.pathname === '/__navigation_show_fixture.js'
        || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname))) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks);
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message)); page.on('download', () => audit.downloads++);
  await page.goto(`${base}/__navigation_show${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor(); await tick(page);
  return { page, audit, context, async close() { await context.close(); contexts.delete(context); } };
}
async function snapshot(page, audit) {
  await tick(page);
  const client = await page.evaluate(() => {
    const a = window.__showAudit, f = window.__showFixture;
    return JSON.parse(JSON.stringify({ state: f.state, session: f.session, events: f.events,
      audit: Object.fromEntries(Object.entries(a).filter(([key]) => !['overlays', 'maps', 'ok', 'bad'].includes(key))),
      maps: a.maps.length, overlays: a.overlays.map(item => item.options),
      localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage },
      counter: document.querySelector('.journey-counter')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      following: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
      instruction: document.querySelector('#current-segment-title')?.textContent,
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed'),
      currentUrl: location.href }));
  });
  return { client, requests: [...audit.requests], downloads: audit.downloads };
}
async function closed(page) {
  await expect(card(page)).toHaveCount(0);
  if (await opener(page).count()) await expect(opener(page)).toHaveAttribute('aria-expanded', 'false');
}
async function blocked(page) {
  await closed(page); if (await opener(page).count()) await expect(opener(page)).toBeDisabled();
}
async function open(page, expected = '第 2 段：内部主路到楼栋组团B') {
  await expect(opener(page)).toBeEnabled(); await opener(page).focus(); await page.keyboard.press('Enter');
  await expect(card(page)).toBeVisible(); await expect(card(page)).toBeFocused();
  await expect(card(page)).toHaveAttribute('role', 'region');
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(text(page)).toHaveText(expected);
  await expect(card(page)).toContainText('请帮我核对这段路');
  await expect(card(page)).toContainText('这是我在查看的路线步骤，不能确认我就在这里。');
  assert.equal(await card(page).getAttribute('aria-modal'), null);
  await expect(card(page).locator('[role="dialog"], [aria-modal="true"], img, input, textarea, a')).toHaveCount(0);
  assert.deepEqual(await card(page).getByRole('button').allTextContents(), ['关闭大字卡']);
  assert.doesNotMatch(await card(page).innerText(), /S_SYNTHETIC_|SYNTHETIC_PRIVATE_|合成地图另选道路|合成终点道路|合成入口道路/);
}
async function restore(page) {
  await page.evaluate(() => window.__showFixture.restore()); await tick(page); await closed(page);
  await expect(page.locator('.journey-counter')).toContainText('第 2 段');
}
async function unchanged(page, audit, before, label) { assert.deepEqual(await snapshot(page, audit), before, label); }
async function layout(page, provider, percent) {
  await page.evaluate(value => { document.documentElement.style.fontSize = value + '%'; }, percent); await tick(page);
  const overflow = await card(page).evaluate(node => [node, ...node.querySelectorAll('*')].filter(item => {
    const box = item.getBoundingClientRect();
    return box.left < -1 || box.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1;
  }).map(item => item.tagName + ':' + item.textContent));
  assert.deepEqual(overflow, [], `${provider}: card fits 320px/${percent}% text`);
  for (const target of [opener(page), button(page, '关闭大字卡')]) {
    const box = await target.boundingBox();
    assert.ok(box?.width >= 48 && box?.height >= 48, `${provider}/${percent}%: 48px opener and close`);
  }
  const size = await text(page).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(size >= 16 * percent / 100 * 1.7, `${provider}/${percent}%: enlarged step text`);
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['sdk', 'fallback']) {
    const run = await setup(provider), { page, audit } = run;
    await closed(page);
    // Actual SDK click or actual fallback road click changes map inspection only.
    if (provider === 'sdk') {
      assert.equal(await page.evaluate(() => {
        const overlay = window.__showAudit.overlays.find(item => item.options.extData?.segmentCode === 'S_SYNTHETIC_OTHER' && item.handlers.click?.length);
        if (!overlay) return false;
        overlay.handlers.click.forEach(callback => callback({})); return true;
      }), true);
    } else {
      await page.evaluate(() => { window.__showFixture.state.selectedSegmentCode = 'S_SYNTHETIC_OTHER'; });
    }
    const before = await snapshot(page, audit);
    await open(page); await unchanged(page, audit, before, 'opening has no service, route, map, event or storage effect');
    await page.keyboard.press('Tab'); await expect(button(page, '关闭大字卡')).toBeFocused();
    await page.keyboard.press('Escape'); await closed(page); await expect(opener(page)).toBeFocused();
    await unchanged(page, audit, before, 'Escape closing has no navigation or service effect');
    await open(page);
    for (const percent of [150, 200]) await layout(page, provider, percent);
    await button(page, '关闭大字卡').click(); await closed(page); await expect(opener(page)).toBeFocused();
    await unchanged(page, audit, before, 'button closing and large text layout have no navigation or service effect');

    await button(page, '累了，休息一下').click(); await closed(page);
    await expect(page.getByTestId('navigation-paused')).toBeVisible();
    const pausedBefore = await snapshot(page, audit);
    await open(page); await unchanged(page, audit, pausedBefore, 'ordinary pause opens same step without resuming or publishing progress');
    await button(page, '关闭大字卡').click(); await unchanged(page, audit, pausedBefore, 'ordinary pause closing changes no service or progress');
    await button(page, '继续前行').click(); await closed(page);

    const invalid = [
      ['duplicate registry', () => { const f = window.__showFixture; f.state.mapFeatures.push({ ...f.state.mapFeatures[1] }); }],
      ['missing registry', () => { window.__showFixture.state.mapFeatures.splice(1, 1); }],
      ['mismatched registry name', () => { window.__showFixture.state.mapFeatures[1].properties.name = '合成不同道路'; }],
      ['duplicate route detail', () => { const f = window.__showFixture; f.state.selectedRoute.segments.push({ ...f.state.selectedRoute.segments[2] }); }],
      ['missing route detail', () => { window.__showFixture.state.selectedRoute.segments.splice(2, 1); }],
      ['missing segment code', () => { window.__showFixture.state.selectedRoute.segment_codes[1] = 'S_SYNTHETIC_UNKNOWN'; }],
      ['invalid road name', () => { const f = window.__showFixture; f.state.selectedRoute.segments[2].name = '此处右转！'; f.state.mapFeatures[1].properties.name = '此处右转！'; }],
      ['unmatched total', () => { window.__showFixture.state.selectedRoute.distance_m++; }],
      ['raw index conflict', () => { window.__showFixture.state.progress.index = 0; }],
      ['proof loss', () => { window.__showFixture.state.textMemoRouteVerified = false; }],
      ['GPS start context', () => { window.__showFixture.state.selectedRoute.start_context = { source: 'synthetic-gps' }; }],
    ];
    for (const [label, mutate] of invalid) {
      await restore(page); await open(page); await page.evaluate(mutate); await tick(page); await blocked(page);
      const invalidBefore = await snapshot(page, audit);
      if (await opener(page).count()) await opener(page).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await blocked(page); await unchanged(page, audit, invalidBefore, `${label}: rejected handler changes no state or effects`);
    }
    for (const index of [-1, 99, 1.5, '1', null]) {
      await restore(page);
      await page.evaluate(index => { const f = window.__showFixture; f.state.progress = { index, paused: false }; f.session.key++; }, index);
      await tick(page); await blocked(page);
    }

    const resets = [
      ['route replacement', () => page.evaluate(() => { const f = window.__showFixture; f.state.selectedRoute = f.makeRoute(); })],
      ['profile replacement', () => page.evaluate(() => { window.__showFixture.state.selectedProfile = { label: '拐杖老人' }; })],
      ['same-step memo scope', () => page.evaluate(() => { window.__showFixture.state.memoScope++; })],
      ['registered features', () => page.evaluate(() => { const f = window.__showFixture; f.state.mapFeatures = f.makeFeatures(f.state.selectedRoute); })],
      ['pilot scope', () => page.evaluate(() => { const f = window.__showFixture; f.state.pilotArea = { ...f.state.pilotArea, name: '合成新范围' }; })],
      ['manual advance', () => button(page, '已走完这段').click()],
      ['ordinary pause', () => button(page, '累了，休息一下').click()],
      ['guidance pause', () => page.evaluate(() => { window.__showFixture.state.guidancePaused = true; })],
      ['detour', () => page.evaluate(() => { window.__showFixture.state.detourActive = true; })],
      ['obstruction', () => button(page, '前方走不了').click()],
      ['end confirmation', () => button(page, '结束导航').click()],
      ['view routes', () => button(page, '查看路线方案').click()],
      ['role switch', () => page.evaluate(() => { window.__showFixture.session.role = 'family'; })],
    ];
    for (const [label, action] of resets) {
      await restore(page); await open(page); await action(); await tick(page); await closed(page);
      if (['guidance pause', 'detour', 'obstruction', 'end confirmation'].includes(label)) await blocked(page);
    }

    // Existing manual, end and route controls keep their original behavior.
    await restore(page); await open(page); await button(page, '上一段').click(); await closed(page);
    await expect(page.locator('.journey-counter')).toContainText('第 1 段');
    await button(page, '已走完这段').click(); await expect(page.locator('.journey-counter')).toContainText('第 2 段');
    await open(page); await button(page, '结束导航').click(); await closed(page);
    await button(page, '继续导航').click(); await closed(page); await expect(opener(page)).toBeEnabled();
    await open(page); await button(page, '结束导航').click(); await button(page, '结束但未确认到达').click(); await closed(page);
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();
    await restore(page); await open(page); await button(page, '查看路线方案').click(); await closed(page);
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();

    // Synthetic permission failure exposes actual existing recovery controls.
    await restore(page); await button(page, '开启我的位置').click();
    await page.evaluate(() => window.__showAudit.bad({ code: 1, message: '合成定位权限未开启' })); await tick(page);
    await expect(page.getByTestId('navigation-recovery')).toBeVisible();
    const recoveryBefore = await snapshot(page, audit);
    await open(page); await unchanged(page, audit, recoveryBefore, 'recovery message does not make the card call GPS or change navigation');
    await button(page, '按本段文字继续').click(); await expect(page.locator('#optional-navigation-map')).toHaveCount(0);
    await expect(text(page)).toHaveText('第 2 段：内部主路到楼栋组团B');
    await button(page, '查看本段登记地图').click(); await expect(page.locator('#optional-navigation-map')).toBeVisible();
    await expect(text(page)).toHaveText('第 2 段：内部主路到楼栋组团B');

    await restore(page); await open(page); const beforeReload = audit.requests.length;
    await page.reload(); await opener(page).waitFor(); await tick(page); await closed(page);
    assert.ok(audit.requests.length > beforeReload, 'reload executes the fixture again');
    await open(page); await page.evaluate(() => window.__showFixture.app.unmount()); await closed(page);
    assert.equal(await page.locator('#app').innerHTML(), '');
    await run.close();
  }
  for (const audit of audits) {
    assert.deepEqual(audit.api, [], `${audit.provider}: no API requests`);
    assert.deepEqual(audit.external, [], `${audit.provider}: no external requests`);
    assert.deepEqual(audit.rejected, [], `${audit.provider}: no non-source requests`);
    assert.deepEqual(audit.errors, [], `${audit.provider}: no page errors`);
    assert.equal(audit.downloads, 0);
  }
  console.log('PASS navigation show step: actual NavigationPage with mock SDK and fallback; ordered second manual step from scrambled details; keyboard region focus/Tab/Escape/return; 320px at 150% and 200%, large text and 48px controls; ordinary pause; invalid route/registry/index/proof/GPS rejection; scope/step/profile/route/pause/detour/obstruction/end/role/reload/unmount clearing; legacy progress/end/routes/recovery controls; unchanged route/events/map/camera/network/GPS/speech/wake/storage/share/clipboard/file/download state. All requests intercepted; synthetic data only; no saved artifacts.');
} catch (error) {
  console.error('Navigation show-step audit:', JSON.stringify(audits.map(({ requests, ...audit }) => ({ ...audit, requestCount: requests.length }))));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
