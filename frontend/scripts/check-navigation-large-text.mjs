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
const events = [], session = reactive({ role: 'elder', view: 'navigation', key: 0, holdExit: false });
function syncObstruction() {
  state.obstructionState = { reason: '', options: [state.progress.index, state.progress.index + 1].flatMap(index => {
    const code = state.selectedRoute.segment_codes[index];
    const row = state.selectedRoute.segments.find(row => row.segment_code === code);
    return row ? [{ route: state.selectedRoute, manualIndex: state.progress.index, index,
      segment_code: code, name: row.name, kind: index === state.progress.index ? 'current' : 'next' }] : [];
  }) };
}
function restore() {
  session.role = 'elder'; session.view = 'navigation'; session.holdExit = false; session.key++;
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
    onEndNavigation: () => { events.push({ end: true }); if (!session.holdExit) session.view = 'routes'; },
    onOpenRoutes: () => { events.push({ leave: true }); if (!session.holdExit) session.view = 'routes'; },
    onSendSos: () => events.push({ sos: true }) })
  : h('p', session.role === 'elder' ? '合成路线视图' : '合成家庭视图') });
window.__largeFixture = { state, events, session, app, restore, makeRoute, makeFeatures }; app.mount('#app');`;

function installMocks() {
  const audit = window.__largeAudit = { fetches: [], xhr: [], beacon: [], storage: [], files: [], clipboard: [],
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
  window.__largeSdk = { Map, Polyline, Polygon: Overlay, Circle: Overlay, Marker: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'navigation-large-step-memory-fixture',
    resolveId(id) { if (id === '/__navigation_large_fixture.js') return '\0navigation-large-fixture'; },
    load(id) { if (id === '\0navigation-large-fixture') return fixture; },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_large', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__navigation_large_fixture.js"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set(), audits = [], measurements = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
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
      contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__largeSdk;}' });
    if (request.method() === 'GET' && (url.pathname === '/__navigation_large' || url.pathname === '/__navigation_large_fixture.js'
        || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname))) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks);
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message)); page.on('download', () => audit.downloads++);
  await page.goto(`${base}/__navigation_large${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor(); await tick(page);
  return { page, audit, context, async close() { await context.close(); contexts.delete(context); } };
}
const toggle = page => page.locator('button.journey-text-size');
const pageRoot = page => page.locator('.journey-page');
const typographySelectors = {
  title: '#current-segment-title', action: '.journey-action-sentence',
  counter: '.journey-counter', button: 'button.journey-text-size',
};
async function snapshot(page, audit) {
  await tick(page);
  const client = await page.evaluate(() => {
    const a = window.__largeAudit, f = window.__largeFixture;
    return JSON.parse(JSON.stringify({ state: f.state, session: f.session, events: f.events,
      audit: Object.fromEntries(Object.entries(a).filter(([key]) => !['overlays', 'maps', 'ok', 'bad'].includes(key))),
      maps: a.maps.length, overlays: a.overlays.map(item => item.options),
      localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage },
      counter: document.querySelector('.journey-counter')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      following: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
      instruction: document.querySelector('#current-segment-title')?.textContent,
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed'),
      shellClasses: [document.documentElement.className, document.body.className],
      disclosures: [...document.querySelectorAll('.journey-show-step, .journey-current-brief, .journey-memo, .journey-photo-cue')]
        .map(node => node.outerHTML),
      mapGeometry: [...document.querySelectorAll('.amap-route-map, .campus-map, .campus-map svg, .campus-map path, .campus-map polyline, .campus-map circle, .campus-map text, .amap-map-actions button')]
        .map(node => ({ tag: node.tagName, d: node.getAttribute('d'), points: node.getAttribute('points'),
          transform: node.getAttribute('transform'), viewBox: node.getAttribute('viewBox'),
          width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height,
          fontSize: getComputedStyle(node).fontSize })),
      currentUrl: location.href }));
  });
  return { client, requests: [...audit.requests], downloads: audit.downloads };
}
async function unchanged(page, audit, before, label) {
  assert.deepEqual(await snapshot(page, audit), before, label);
}
async function enabled(page, value) {
  await expect(toggle(page)).toHaveAttribute('aria-pressed', String(value));
  await expect(toggle(page)).toHaveText(value ? '关闭导航文字放大' : '放大导航文字');
  if (value) await expect(pageRoot(page)).toHaveClass(/\bjourney-large-text\b/);
  else await expect(pageRoot(page)).not.toHaveClass(/\bjourney-large-text\b/);
}
async function setLarge(page, value) {
  if ((await toggle(page).getAttribute('aria-pressed')) !== String(value)) await toggle(page).click();
  await enabled(page, value); await tick(page);
}
async function restore(page) {
  await page.evaluate(() => window.__largeFixture.restore()); await tick(page);
  await expect(pageRoot(page)).toBeVisible(); await enabled(page, false);
  await expect(page.locator('.journey-counter')).toContainText('第 2 段');
}
async function sizes(page) {
  return page.evaluate(selectors => Object.fromEntries(Object.entries(selectors).map(([key, selector]) =>
    [key, parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)])), typographySelectors);
}
async function layout(page, provider, percent, mode) {
  await tick(page);
  const result = await page.evaluate(() => {
    const root = document.querySelector('.journey-page');
    const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden'
      && !node.closest('.journey-announcement, svg');
    const label = node => node.tagName + (node.id ? '#' + node.id : '.' + String(node.className || '').replaceAll(' ', '.'));
    const overflow = [root, ...root.querySelectorAll('*')].filter(node => node instanceof HTMLElement && visible(node))
      .filter(node => { const box = node.getBoundingClientRect(); return box.left < -1 || box.right > innerWidth + 1
        || node.scrollWidth > node.clientWidth + 1; }).map(label);
    const smallTargets = [...root.querySelectorAll('button, select, summary')].filter(visible)
      .map(node => ({ name: node.textContent.trim(), width: node.getBoundingClientRect().width,
        height: node.getBoundingClientRect().height }))
      .filter(box => box.width < 48 || box.height < 48);
    const clipped = [];
    for (const node of root.querySelectorAll('#current-segment-title, .journey-action-sentence, .journey-counter, .journey-rest-step, button')) {
      if (!visible(node)) continue;
      const box = node.getBoundingClientRect();
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      for (let text = walker.nextNode(); text; text = walker.nextNode()) {
        if (!text.textContent.trim() || text.parentElement.closest('.journey-announcement')) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        if ([...range.getClientRects()].some(rect => rect.left < box.left - 1 || rect.right > box.right + 1
          || rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) clipped.push(label(node));
      }
      for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if ((['hidden', 'clip'].includes(style.overflowX) && (box.left < bounds.left - 1 || box.right > bounds.right + 1))
          || (['hidden', 'clip'].includes(style.overflowY) && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1))) {
          clipped.push(label(node) + ' clipped by ' + label(parent));
        }
      }
    }
    return { overflow, smallTargets, clipped, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth };
  });
  assert.ok(result.documentWidth <= result.viewport, `${provider}/${percent}%/${mode}: no document overflow: ${JSON.stringify(result)}`);
  assert.deepEqual(result.overflow, [], `${provider}/${percent}%/${mode}: no component overflow`);
  assert.deepEqual(result.clipped, [], `${provider}/${percent}%/${mode}: no clipped instructions or button labels`);
  assert.deepEqual(result.smallTargets, [], `${provider}/${percent}%/${mode}: 48px controls`);
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['sdk', 'fallback']) {
    const run = await setup(provider), { page, audit } = run;
    await enabled(page, false);
    assert.equal(await toggle(page).evaluate(node => node.tagName), 'BUTTON', 'native keyboard control');
    assert.equal(await toggle(page).getAttribute('type'), 'button');
    // Initial mount may inspect the manual current segment. Settle it before the
    // mutation-free preference checks; all subsequent toggles must be local.
    const before = await snapshot(page, audit);
    const offStyle = await toggle(page).evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color }));
    await toggle(page).focus(); await page.keyboard.press('Enter'); await enabled(page, true);
    await expect(toggle(page)).toBeFocused();
    const onStyle = await toggle(page).evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color, outline: getComputedStyle(node).outlineStyle,
      outlineWidth: parseFloat(getComputedStyle(node).outlineWidth) }));
    assert.notEqual(onStyle.background, offStyle.background, 'pressed state has visible contrast');
    assert.notEqual(onStyle.color, offStyle.color, 'pressed state changes foreground');
    assert.notEqual(onStyle.outline, 'none', 'keyboard focus is visible');
    assert.ok(onStyle.outlineWidth >= 3, 'keyboard focus has a substantial outline');
    await unchanged(page, audit, before, `${provider}: Enter only enlarges local text`);
    await page.keyboard.press('Space'); await enabled(page, false);
    await expect(toggle(page)).toBeFocused();
    assert.deepEqual(await toggle(page).evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color })), offStyle, 'off control returns to original appearance');
    await unchanged(page, audit, before, `${provider}: Space only restores local text`);

    for (const percent of [100, 150, 200]) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value + '%'; }, percent);
      await setLarge(page, false); await layout(page, provider, percent, 'default');
      const normal = await sizes(page), beforeLarge = await snapshot(page, audit);
      await setLarge(page, true); const large = await sizes(page);
      for (const key of Object.keys(normal)) assert.ok(large[key] > normal[key], `${provider}/${percent}%: ${key} is larger`);
      const rootSize = 16 * percent / 100;
      assert.equal(large.title, rootSize * 2, 'title follows 2rem');
      assert.equal(large.action, rootSize * 1.625, 'action follows 1.625rem');
      assert.equal(large.counter, rootSize * 1.625, 'counter follows 1.625rem');
      assert.equal(large.button, rootSize * 1.5, 'button follows 1.5rem');
      const baseline = measurements.find(row => row.provider === provider && row.percent === 100) || { normal, large };
      for (const [mode, current] of Object.entries({ normal, large })) {
        for (const [key, actual] of Object.entries(current)) {
          const expected = baseline[mode][key] * percent / 100;
          assert.ok(Math.abs(actual - expected) <= 0.02,
            `${provider}/${percent}%: ${mode} ${key} scales with root font (${actual}px vs ${expected}px)`);
        }
      }
      measurements.push({ provider, percent, normal, large });
      await layout(page, provider, percent, 'large');
      await unchanged(page, audit, beforeLarge, `${provider}/${percent}%: enlarging has no service, route, map, event or storage effect`);
      await setLarge(page, false); assert.deepEqual(await sizes(page), normal, 'off restores original computed font sizes');
      await unchanged(page, audit, beforeLarge, `${provider}/${percent}%: restoring has no side effects`);
      await setLarge(page, true);
      await button(page, '累了，休息一下').click(); await enabled(page, true);
      await expect(page.getByTestId('navigation-paused')).toBeVisible();
      await expect(button(page, '已走完这段')).toBeDisabled();
      const restBefore = await snapshot(page, audit);
      const largeRest = await page.locator('.journey-rest-step').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      assert.equal(largeRest, rootSize * 1.625, 'rest step follows 1.625rem');
      await layout(page, provider, percent, 'large ordinary rest');
      await setLarge(page, false);
      const normalRest = await page.locator('.journey-rest-step').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
      assert.ok(largeRest > normalRest, 'rest step is larger than its ordinary default');
      await setLarge(page, true); await unchanged(page, audit, restBefore, `${provider}/${percent}%: rest toggling does not resume or publish`);
      await button(page, '继续前行').click(); await enabled(page, true);
      await expect(page.getByTestId('navigation-paused')).toHaveCount(0);
    }

    // The reading preference follows ordinary in-page manual/map/text actions.
    await button(page, '上一段').click(); await enabled(page, true);
    await expect(page.locator('.journey-counter')).toContainText('第 1 段');
    await button(page, '已走完这段').click(); await enabled(page, true);
    await expect(page.locator('.journey-counter')).toContainText('第 2 段');
    for (const name of ['文字导航', '地图导航', '文字导航']) {
      await button(page, name).click(); await tick(page); await enabled(page, true);
      await expect(page.locator('.journey-counter')).toContainText('第 2 段');
      if (name === '文字导航') await expect(page.locator('#optional-navigation-map')).toHaveCount(0);
      else await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
      await layout(page, provider, 200, name);
      const modeBefore = await snapshot(page, audit);
      await setLarge(page, false); await setLarge(page, true);
      await unchanged(page, audit, modeBefore, `${provider}/${name}: toggles do not alter map mode, manual step or effects`);
    }

    await restore(page); await button(page, '保存文字路线').click();
    await button(page, '给身边的人看').click(); await button(page, '慢一点，只听这一段').click();
    await expect(page.getByTestId('navigation-memo-preview')).toBeVisible();
    await expect(page.getByTestId('navigation-show-step')).toBeVisible();
    await expect(page.getByTestId('navigation-current-brief')).toBeVisible();
    const disclosuresBefore = await snapshot(page, audit);
    await setLarge(page, true); await setLarge(page, false);
    await unchanged(page, audit, disclosuresBefore, `${provider}: existing memo/show-card/brief disclosures and speech state stay open and unchanged`);

    const resets = [
      ['route identity', () => page.evaluate(() => { const f = window.__largeFixture; f.state.selectedRoute = f.makeRoute(); })],
      ['profile', () => page.evaluate(() => { window.__largeFixture.state.selectedProfile = { label: '拐杖老人' }; })],
      ['pilot area', () => page.evaluate(() => { const f = window.__largeFixture; f.state.pilotArea = { ...f.state.pilotArea }; })],
      ['memo scope', () => page.evaluate(() => { window.__largeFixture.state.memoScope++; })],
      ['guidance paused', () => page.evaluate(() => { window.__largeFixture.state.guidancePaused = true; })],
      ['detour', () => page.evaluate(() => { window.__largeFixture.state.detourActive = true; })],
      ['end confirmation', () => button(page, '结束导航').click()],
      ['obstruction draft', () => button(page, '前方走不了').click()],
      ['route exit restClosed', async () => {
        await page.evaluate(() => { window.__largeFixture.session.holdExit = true; });
        await button(page, '查看路线方案').click();
      }],
    ];
    for (const [label, action] of resets) {
      await restore(page); await setLarge(page, true); await action(); await tick(page);
      await expect(page.locator('.journey-large-text')).toHaveCount(0);
      if (label === 'guidance paused') {
        await expect(page.locator('.journey-paused')).toBeVisible();
        await page.evaluate(() => { window.__largeFixture.state.guidancePaused = false; }); await tick(page);
      }
      await enabled(page, false);
      if (['end confirmation', 'obstruction draft', 'route exit restClosed'].includes(label)) {
        await expect(toggle(page)).toBeDisabled();
        const blockedBefore = await snapshot(page, audit);
        await toggle(page).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        await enabled(page, false); await unchanged(page, audit, blockedBefore, `${provider}/${label}: disabled handler cannot re-enable`);
      }
      if (label === 'end confirmation') { await button(page, '继续导航').click(); await enabled(page, false); }
      if (label === 'obstruction draft') { await button(page, '取消，继续原行程').click(); await enabled(page, false); }
      if (label === 'detour') {
        await expect(toggle(page)).toBeEnabled();
        const detourBefore = await snapshot(page, audit);
        await setLarge(page, true); await unchanged(page, audit, detourBefore, 'active valid detour can explicitly enlarge without effects');
        await button(page, '累了，休息一下').click(); await enabled(page, true);
        await page.evaluate(() => { window.__largeFixture.state.detourActive = false; }); await enabled(page, false);
      }
      if (label === 'profile' || label === 'pilot area' || label === 'memo scope') {
        assert.deepEqual(await sizes(page), measurements.find(row => row.provider === provider && row.percent === 200).normal,
          `${label}: measured default CSS restored at 200%`);
      }
    }

    await restore(page); await setLarge(page, true);
    await page.evaluate(() => { window.__largeFixture.state.selectedRoute = null; }); await tick(page);
    await enabled(page, false); await expect(toggle(page)).toBeDisabled();
    const noRouteBefore = await snapshot(page, audit);
    await toggle(page).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await enabled(page, false); await unchanged(page, audit, noRouteBefore, 'no route cannot enable text preference');

    await restore(page); await setLarge(page, true);
    await button(page, '结束导航').click(); await button(page, '结束但未确认到达').click();
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();
    await expect(page.locator('.journey-large-text')).toHaveCount(0);
    await restore(page); await setLarge(page, true); await button(page, '查看路线方案').click();
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();
    await expect(page.locator('.journey-large-text')).toHaveCount(0);
    await restore(page); await setLarge(page, true);
    await page.evaluate(() => { window.__staleLargeButton = document.querySelector('button.journey-text-size');
      window.__largeFixture.session.role = 'family'; }); await tick(page);
    await expect(pageRoot(page)).toHaveCount(0); await expect(page.locator('.journey-large-text')).toHaveCount(0);
    const exitBefore = await snapshot(page, audit);
    await page.evaluate(() => window.__staleLargeButton.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await unchanged(page, audit, exitBefore, `${provider}: captured detached handler has no effects after unmount`);
    await restore(page); await enabled(page, false);
    assert.deepEqual(await sizes(page), measurements.find(row => row.provider === provider && row.percent === 200).normal,
      'remount restores measured default CSS');
    await setLarge(page, true); await page.reload(); await toggle(page).waitFor(); await tick(page); await enabled(page, false);
    assert.deepEqual(await sizes(page), measurements.find(row => row.provider === provider && row.percent === 100).normal,
      'reload keeps no preference or CSS');
    await setLarge(page, true); await page.evaluate(() => window.__largeFixture.app.unmount());
    await expect(page.locator('#app')).toBeEmpty(); await expect(page.locator('.journey-large-text')).toHaveCount(0);
    await run.close();
  }
  for (const audit of audits) {
    assert.deepEqual(audit.api, [], `${audit.provider}: no API requests`);
    assert.deepEqual(audit.external, [], `${audit.provider}: no external requests`);
    assert.deepEqual(audit.rejected, [], `${audit.provider}: no non-source requests`);
    assert.deepEqual(audit.errors, [], `${audit.provider}: no page errors`); assert.equal(audit.downloads, 0);
  }
  console.log('Computed font sizes (px):', JSON.stringify(measurements));
  console.log('PASS navigation large text: actual NavigationPage with mocked SDK and real SVG fallback; native Enter/Space pressed state, visible focus and clear off control; direct default/large font comparisons at 320px and 100/150/200% root font; no document/component overflow or clipped instructions and 48px controls; ordinary rest/manual progress/map-text persistence; route/profile/pilot/memo/pause/detour/end/obstruction/restClosed/reset/reload/unmount clearing and no stale CSS; toggling changes no services, network, GPS, speech, wake, storage, map overlays/camera, route, events or progress. All requests intercepted; synthetic data only; no saved artifacts.');
} catch (error) {
  console.error('Navigation large-text audit:', JSON.stringify(audits.map(({ requests, ...audit }) => ({ ...audit, requestCount: requests.length }))));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
