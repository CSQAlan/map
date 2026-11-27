import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// The real NavigationPage runs only against an in-memory fixture and SDK.
// Every request is intercepted before navigation. No backend, hardware, real
// media, downloads, screenshots, browser profiles or test artifacts are saved.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
const photoIds = ['SY_IMG_9499', 'SY_IMG_9500', 'SY_IMG_9540', 'SY_IMG_9544'];
const tinyImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
function makeRoute() {
  const codes = ['S_SY_GATE_TO_MAIN', 'S_SY_MAIN_TO_BUILDING_B', 'S_SYNTHETIC_END'];
  return { distance_m: 330, segment_codes: codes,
    segments: codes.map((segment_code, i) => ({ segment_code,
      name: ['合成当前登记道路', '合成下一登记道路', '合成终点登记道路'][i],
      length_m: [80, 100, 150][i], step_count: 0, width_m: 2, risk_tags: [],
      geometry_coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] })) };
}
function makeFeatures(route) {
  const captions = {
    SY_IMG_9499: '师大苑内部主路入口段', SY_IMG_9500: '内部主路通行环境',
    SY_IMG_9540: '合成共享登记照片', SY_IMG_9544: '楼栋组团周边道路',
  };
  return [...route.segments.map((row, i) => ({ type: 'Feature',
    properties: { ...row, kind: 'segment', evidence_photos:
      [['SY_IMG_9499', 'SY_IMG_9500', 'SY_IMG_9540'], ['SY_IMG_9540', 'SY_IMG_9544'], []][i].map(photo_id => ({
        photo_id, caption: captions[photo_id], risk_tags: [],
        thumbnail_url: '/media/evidence/thumb/' + photo_id + '.webp',
        display_url: '/media/evidence/display/' + photo_id + '.webp',
      })) }, geometry: { type: 'LineString', coordinates: row.geometry_coordinates.map(point => [...point]) } })),
    { type: 'Feature', properties: { kind: 'segment', segment_code: 'S_SYNTHETIC_UNRELATED', name: '合成地图查看道路',
      evidence_photos: [{ photo_id: 'SY_IMG_9544', caption: '楼栋组团周边道路', risk_tags: [],
        thumbnail_url: '/media/evidence/thumb/SY_IMG_9544.webp', display_url: '/media/evidence/display/SY_IMG_9544.webp' }] },
      geometry: { type: 'LineString', coordinates: [[10, 10.001], [10.003, 10.001]] } }];
}
const fixture = `import { createApp, h, reactive } from 'vue';
import NavigationPage from '/src/pages/NavigationPage.vue';
import '/src/styles.css';
const makeRoute = ${makeRoute.toString()};
const makeFeatures = ${makeFeatures.toString()};
const selectedRoute = makeRoute();
const state = reactive({ selectedRoute, mapFeatures: makeFeatures(selectedRoute),
  apiBaseUrl: location.origin, selectedProfile: { label: '轮椅老人' },
  selectedSegmentCode: selectedRoute.segment_codes[0], textMemoRouteVerified: true, memoScope: 0,
  guidancePaused: false, detourActive: false, progress: { index: 0, paused: false },
  obstructionState: { options: [], reason: '' },
  mapFailure: location.search.includes('fallback') ? '合成底图不可用' : '',
  pilotArea: { center: [10,10], min_zoom: 16, max_zoom: 20,
    limit_bounds: { south_west: [9.99,9.99], north_east: [10.01,10.01] },
    boundary: { coordinates: [[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]] } } });
const events = [], session = reactive({ role: 'elder', view: 'navigation' });
function syncObstruction() {
  state.obstructionState = { reason: '', options: [state.progress.index, state.progress.index + 1].flatMap(index => {
    const row = state.selectedRoute.segments[index];
    return row ? [{ route: state.selectedRoute, trip: state.memoScope, manualIndex: state.progress.index,
      index, segment_code: row.segment_code, name: row.name, kind: index === state.progress.index ? 'current' : 'next' }] : [];
  }) };
}
function restore() {
  session.role = 'elder'; session.view = 'navigation';
  state.selectedRoute = makeRoute(); state.mapFeatures = makeFeatures(state.selectedRoute);
  state.apiBaseUrl = location.origin; state.selectedProfile = { label: '轮椅老人' };
  state.progress = { index: 0, paused: false }; state.selectedSegmentCode = state.selectedRoute.segment_codes[0];
  state.guidancePaused = false; state.detourActive = false; state.textMemoRouteVerified = true;
  state.memoScope++; syncObstruction();
}
syncObstruction();
const app = createApp({ render: () => session.role === 'elder' && session.view === 'navigation' ? h(NavigationPage, { ...state,
  onSelectSegment: code => { state.selectedSegmentCode = code; events.push({ select: code }); },
  onProgress: progress => { state.progress = progress; events.push({ progress }); syncObstruction(); },
  onPauseDetour: message => { state.guidancePaused = true; events.push({ pause: message }); },
  onMapError: message => { state.mapFailure = message; },
  onConfirmObstruction: choice => { events.push({ obstruction: choice.segment_code });
    state.guidancePaused = true; state.detourActive = true; state.textMemoRouteVerified = false; state.memoScope++; },
  onEndNavigation: () => { events.push({ end: true }); session.view = 'routes'; },
  onOpenRoutes: () => { events.push({ leave: true }); session.view = 'routes'; },
  onSendSos: () => events.push({ sos: true }) }) : h('p', session.role === 'elder' ? '合成路线视图' : '合成家庭视图') });
window.__photoFixture = { state, events, session, app, restore, makeRoute, makeFeatures }; app.mount('#app');`;

function installMocks() {
  const audit = window.__photoAudit = { fetches: [], storage: [], watches: 0, clears: 0, captures: 0,
    spoken: [], cancels: 0, wakeRequests: 0, wakeReleases: 0, cameras: [], mapChanges: [], overlays: [], maps: [] };
  const originalFetch = window.fetch;
  window.fetch = function (...args) { audit.fetches.push(String(args[0])); return originalFetch.apply(this, args); };
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
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      audit.storage.push({ method, args, kind: this === localStorage ? 'local' : 'session' });
      return original.apply(this, args);
    };
  }
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
  window.__photoSdk = { Map, Polyline, Polygon: Overlay, Circle: Overlay, Marker: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'navigation-photo-in-memory-fixture',
    resolveId(id) { if (id === '/__navigation_photo_fixture.js') return '\0navigation-photo-fixture'; },
    load(id) { if (id === '\0navigation-photo-fixture') return fixture; },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_photo', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__navigation_photo_fixture.js"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set(), audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const opener = page => button(page, '看实景认路');
const cue = page => page.getByTestId('navigation-photo-cue');
const image = page => page.getByTestId('navigation-photo-cue-image');
const caption = page => page.getByTestId('navigation-photo-cue-caption');
const step = page => page.getByTestId('navigation-photo-cue-step');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function setup(provider = 'sdk', failure = '') {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block', acceptDownloads: false });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider, failure, requests: [], media: [], api: [], external: [], rejected: [], errors: [], downloads: 0 };
  audits.push(audit);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()); audit.requests.push(url.href);
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return route.abort('blockedbyclient'); }
    const media = /^\/media\/evidence\/display\/(SY_IMG_\d+)\.webp$/.exec(url.pathname);
    if (media && photoIds.includes(media[1]) && !url.search && request.method() === 'GET') {
      audit.media.push({ id: media[1], type: request.resourceType(), url: url.href });
      if (failure === 'offline') return route.abort('internetdisconnected');
      if (failure === 'http') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'synthetic unavailable' });
      return route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: tinyImage });
    }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__photoSdk;}' });
    if (url.pathname === '/__navigation_photo' || url.pathname === '/__navigation_photo_fixture.js'
        || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks);
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  page.on('download', () => audit.downloads++);
  await page.goto(`${base}/__navigation_photo${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; }); await tick(page);
  return { page, audit, context, async close() { await context.close(); contexts.delete(context); } };
}
async function stable(page) {
  return page.evaluate(() => {
    const a = window.__photoAudit, f = window.__photoFixture;
    return JSON.parse(JSON.stringify({ state: f.state, session: f.session, events: f.events,
      fetches: a.fetches, storage: a.storage, local: { ...localStorage }, sessionStorage: { ...sessionStorage },
      watches: a.watches, clears: a.clears, captures: a.captures, spoken: a.spoken, cancels: a.cancels,
      wakeRequests: a.wakeRequests, wakeReleases: a.wakeReleases, cameras: a.cameras, mapChanges: a.mapChanges,
      overlays: a.overlays.map(item => item.options), counter: document.querySelector('.journey-counter')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      following: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
      instruction: document.querySelector('.journey-current > h2')?.textContent,
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed') }));
  });
}
async function closed(page) {
  await expect(cue(page)).toHaveCount(0); await expect(image(page)).toHaveCount(0);
  if (await opener(page).count()) await expect(opener(page)).toHaveAttribute('aria-expanded', 'false');
}
async function open(page) {
  await expect(opener(page)).toBeEnabled(); await opener(page).focus(); await page.keyboard.press('Enter');
  await expect(cue(page)).toBeVisible(); await expect(opener(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(button(page, '关闭实景')).toBeFocused();
  await expect(cue(page)).toContainText('登记实景照片，仅用于认路，拍摄时间/当前位置/道路施工与通行情况未确认');
  assert.equal(await cue(page).getAttribute('aria-modal'), null);
  assert.notEqual(await cue(page).getAttribute('role'), 'dialog');
  await expect(cue(page).locator('[role="dialog"], [aria-modal="true"]')).toHaveCount(0);
}
async function photo(page, id, text) {
  await expect(image(page)).toHaveCount(1); await expect(cue(page).locator('img')).toHaveCount(1);
  await expect(image(page)).toHaveAttribute('src', `${base}/media/evidence/display/${id}.webp`);
  await expect(caption(page)).toHaveText(text);
  await expect.poll(() => image(page).evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
}
async function layout(page, provider) {
  const overflow = await cue(page).evaluate(node => [node, ...node.querySelectorAll('*')].filter(item => {
    const box = item.getBoundingClientRect();
    return box.x < -1 || box.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1;
  }).map(item => item.tagName + ':' + item.textContent));
  assert.deepEqual(overflow, [], `${provider}: disclosure fits 320px at 150% root text`);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(widths[0] <= widths[1] + 1, `${provider}: document overflow ${widths}`);
  for (const target of [opener(page), ...await cue(page).getByRole('button').all()]) {
    const box = await target.boundingBox();
    assert.ok(box?.width >= 48 && box?.height >= 48, `${provider}: control is at least 48px`);
  }
  const fontSize = await caption(page).evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  assert.ok(fontSize >= 24, `${provider}: caption stays large`);
}
async function restore(page) {
  await page.evaluate(() => window.__photoFixture.restore()); await tick(page); await closed(page);
}
async function unchanged(page, before, label) {
  await tick(page); assert.deepEqual(await stable(page), before, label);
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['sdk', 'fallback']) {
    const run = await setup(provider), { page, audit } = run;
    await closed(page); assert.deepEqual(audit.media, [], 'mount requests no photo or thumbnail');
    if (provider === 'sdk') {
      const inspected = await page.evaluate(() => {
        const overlay = window.__photoAudit.overlays.find(item => item.options.extData?.segmentCode === 'S_SYNTHETIC_UNRELATED'
          && item.handlers.click?.length);
        if (!overlay) return false;
        for (const callback of overlay.handlers.click) callback({});
        return true;
      });
      assert.ok(inspected, 'SDK mock exercises an actual unrelated map road click');
    } else {
      await page.evaluate(() => { window.__photoFixture.state.selectedSegmentCode = 'S_SYNTHETIC_UNRELATED'; });
    }
    await tick(page); const before = await stable(page);
    await open(page); await photo(page, 'SY_IMG_9499', '师大苑内部主路入口段');
    await expect(step(page)).toContainText('合成当前登记道路');
    await expect(step(page)).not.toContainText('合成地图查看道路');
    await expect(button(page, '上一张')).toBeDisabled();
    await unchanged(page, before, 'opening photos leaves route, instruction, GPS, voice, wake, map, events, storage and fetch unchanged');
    assert.equal(audit.media.length, 1, 'opening requests only the selected full display image');
    await button(page, '下一张').click(); await photo(page, 'SY_IMG_9500', '内部主路通行环境');
    await button(page, '下一张').click(); await photo(page, 'SY_IMG_9540', '合成共享登记照片');
    await expect(button(page, '下一张')).toBeDisabled();
    await button(page, '上一张').click(); await photo(page, 'SY_IMG_9500', '内部主路通行环境');
    await button(page, '下一段实景').click(); await photo(page, 'SY_IMG_9540', '合成共享登记照片');
    await expect(step(page)).toContainText('合成下一登记道路');
    await expect(button(page, '上一张')).toBeDisabled();
    await button(page, '下一张').click(); await photo(page, 'SY_IMG_9544', '楼栋组团周边道路');
    await expect(button(page, '下一张')).toBeDisabled();
    await layout(page, provider);
    await button(page, '当前段实景').click(); await photo(page, 'SY_IMG_9499', '师大苑内部主路入口段');
    await unchanged(page, before, 'manual photo and current/next selection leave the navigation unchanged');
    const manualRequestCount = audit.media.length;
    await page.clock.install(); await page.clock.fastForward(60_000);
    assert.equal(audit.media.length, manualRequestCount, 'no automatic slideshow, prefetch or background retry');
    await button(page, '关闭实景').focus(); await page.keyboard.press('Enter');
    await closed(page); await expect(opener(page)).toBeFocused();
    await unchanged(page, before, 'closing affects no navigation or service state');

    // Normal manual progression and each legacy mobility profile still work.
    for (const label of ['轮椅老人', '拐杖老人', '慢行老人', '独立出行', '家属陪同']) {
      await restore(page); await page.evaluate(label => { window.__photoFixture.state.selectedProfile = { label }; }, label);
      await open(page); await button(page, '下一张').click();
      const count = audit.media.length; await button(page, '已走完这段').click(); await closed(page);
      assert.equal(audit.media.length, count, `${label}: manual advancement does not request a photo`);
      await expect(page.locator('.journey-counter')).toContainText('第 2 段');
      await open(page); await photo(page, 'SY_IMG_9540', '合成共享登记照片');
      await expect(step(page)).toContainText('合成下一登记道路');
    }
    for (const missing of ['missing', 'invalid']) {
      await restore(page);
      await page.evaluate(kind => {
        const row = window.__photoFixture.state.mapFeatures[0].properties;
        if (kind === 'missing') delete row.evidence_photos;
        else row.evidence_photos = [{ ...row.evidence_photos[0], display_url: 'https://example.invalid/untrusted.webp' }];
      }, missing);
      await tick(page); const beforeMissing = await stable(page), count = audit.media.length;
      await open(page); await expect(step(page)).toContainText('合成当前登记道路');
      await expect(image(page)).toHaveCount(0); await expect(caption(page)).toHaveCount(0);
      await expect(cue(page)).toContainText(missing === 'missing'
        ? '这一路段没有已登记的可用照片；请核对现场。'
        : '这一路段的照片资料未通过完整核对，暂不能展示；请核对现场。');
      assert.equal(audit.media.length, count, `${missing}: current metadata never substitutes the next or unrelated photo`);
      await unchanged(page, beforeMissing, `${missing}: no-photo disclosure leaves navigation unchanged`);
      await button(page, '下一段实景').click(); await photo(page, 'SY_IMG_9540', '合成共享登记照片');
      await button(page, '当前段实景').click(); await expect(image(page)).toHaveCount(0);
      // The shared image may already be decoded in this document. Explicit
      // selection can reuse it; it must never cause a second image to prefetch.
      assert.ok(audit.media.length <= count + 1, `${missing}: explicit next-step selection loads at most one photo`);
    }
    const resets = [
      ['same-step scope', () => page.evaluate(() => { window.__photoFixture.state.memoScope++; })],
      ['ordinary pause', () => button(page, '累了，休息一下').click()],
      ['revoked ordinary proof', () => page.evaluate(() => { window.__photoFixture.state.textMemoRouteVerified = false; })],
      ['profile', () => page.evaluate(() => { window.__photoFixture.state.selectedProfile = { label: '合成使用手杖' }; })],
      ['pilot scope', () => page.evaluate(() => { const f = window.__photoFixture; f.state.pilotArea = { ...f.state.pilotArea, name: '合成新范围' }; })],
      ['map evidence', () => page.evaluate(() => { const f = window.__photoFixture; f.state.mapFeatures = structuredClone(JSON.parse(JSON.stringify(f.state.mapFeatures))); })],
      ['new route', () => page.evaluate(() => { const f = window.__photoFixture; f.state.selectedRoute = f.makeRoute(); })],
      ['guidance pause', () => page.evaluate(() => { window.__photoFixture.state.guidancePaused = true; })],
      ['detour', () => page.evaluate(() => { window.__photoFixture.state.detourActive = true; })],
      ['obstruction disclosure', () => button(page, '前方走不了').click()],
      ['end confirmation', () => button(page, '结束导航').click()],
      ['leave navigation', () => button(page, '查看路线方案').click()],
      ['role unmount', () => page.evaluate(() => { window.__photoFixture.session.role = 'family'; })],
    ];
    for (const [label, action] of resets) {
      await restore(page); await open(page); await photo(page, 'SY_IMG_9499', '师大苑内部主路入口段');
      const count = audit.media.length; await action(); await tick(page); await closed(page);
      assert.equal(audit.media.length, count, `${label}: clearing never requests another photo`);
    }
    await restore(page); await open(page); await button(page, '累了，休息一下').click(); await closed(page);
    await button(page, '继续前行').click(); await closed(page);
    await open(page); await button(page, '结束导航').click(); await closed(page);
    await button(page, '继续导航').click(); await closed(page);
    await open(page); await button(page, '结束导航').click(); await button(page, '结束但未确认到达').click(); await closed(page);
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();
    await restore(page); await open(page); const beforeReload = audit.media.length;
    await page.reload(); await opener(page).waitFor(); await tick(page); await closed(page);
    assert.equal(audit.media.length, beforeReload, 'reload remembers no open photo');
    await open(page); const beforeUnmount = audit.media.length;
    await page.evaluate(() => window.__photoFixture.app.unmount()); await closed(page);
    assert.equal(audit.media.length, beforeUnmount, 'unmount never requests media');
    await run.close();
  }
  for (const failure of ['http', 'offline']) {
    const run = await setup('fallback', failure), { page, audit } = run;
    const before = await stable(page); await open(page);
    await expect(caption(page)).toHaveText('师大苑内部主路入口段');
    await expect(cue(page)).toContainText(/无法|失败|未能|不可用|没能/);
    await expect(page.locator('#current-segment-title')).toHaveText('合成当前登记道路');
    await unchanged(page, before, `${failure}: failed image keeps caption and navigation untouched`);
    assert.equal(audit.media.length, 1);
    await page.clock.install(); await page.clock.fastForward(60_000);
    assert.equal(audit.media.length, 1, `${failure}: no automatic retry or alternate image request`);
    await button(page, '关闭实景').click(); await closed(page); await expect(opener(page)).toBeFocused();
    await run.close();
  }
  for (const audit of audits) {
    assert.deepEqual(audit.api, [], `${audit.provider}/${audit.failure}: no API request`);
    assert.deepEqual(audit.external, [], `${audit.provider}/${audit.failure}: no external request`);
    assert.deepEqual(audit.rejected, [], `${audit.provider}/${audit.failure}: no unapproved request`);
    assert.deepEqual(audit.errors, [], `${audit.provider}/${audit.failure}: no page error`);
    assert.equal(audit.downloads, 0);
    assert.ok(audit.media.every(row => row.type === 'image'), 'photo URLs are image-only, never fetched or downloaded');
  }
  console.log('PASS navigation photo cue: real NavigationPage SDK mock/fallback; explicit-only single image, ordered current/next/shared metadata, keyboard close focus, 48px controls at 320px/150%, HTTP/offline caption fallback without retries, manual progression and mobility profiles, scope/proof/pause/profile/pilot/map/route/obstruction/end/role/reload/unmount clearing, and unchanged GPS/voice/wake/map/progress/events/storage/fetch. All requests intercepted; no backend, real media, hardware or saved artifacts.');
} catch (error) {
  console.error('Navigation photo browser audit:', JSON.stringify(audits.map(({ requests, ...audit }) => ({ ...audit, requestCount: requests.length }))));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
