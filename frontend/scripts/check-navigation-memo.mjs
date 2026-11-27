import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Real NavigationPage with synthetic registrations and browser capabilities.
// No backend, live SDK, hardware, credentials, screenshots or saved artifacts.
// Explicit browser downloads are read from Playwright's transient stream only.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
function makeRoute(prefix = '') {
  const codes = ['PRIVATE_SEGMENT_A', 'PRIVATE_SEGMENT_B', 'PRIVATE_SEGMENT_C'].map(code => prefix + code);
  const lengths = [73.63, 86, 174];
  return { distance_m: 333.63, segment_codes: codes, id: 'PRIVATE_ROUTE_ID',
    summary: 'PRIVATE_FREEFORM_SUMMARY', start_name: 'PRIVATE_START_NAME', end_name: 'PRIVATE_END_NAME',
    user_id: 'PRIVATE_USER_ID', access_token: 'PRIVATE_ACCESS_TOKEN',
    family_snapshot: { name: 'PRIVATE_FAMILY_NAME', phone: 'PRIVATE_PHONE' },
    current_coordinates: [106.123456, 29.654321],
    segments: codes.map((segment_code, i) => ({ segment_code,
      name: ['合成林荫步道', '合成沿河小路', '合成花园通道'][i], length_m: lengths[i],
      explanation: 'PRIVATE_FREEFORM_EXPLANATION', risk_tags: ['PRIVATE_RISK_TAG'],
      step_count: [0, 0, 7][i], width_m: 2,
      geometry_coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: [...codes],
      node_codes: ['PRIVATE_NODE_START', 'PRIVATE_NODE_ONE', 'PRIVATE_NODE_REST', 'PRIVATE_NODE_END'],
      segment_lengths_m: [...lengths], stops: [{ node_index: 2, node_code: 'PRIVATE_NODE_REST', name: '合成中途休息点' }] } };
}
const fixture = `import { createApp, h, reactive } from 'vue';
import NavigationPage from '/src/pages/NavigationPage.vue';
import '/src/styles.css';
const makeRoute = ${makeRoute.toString()};
const makeFeatures = route => route.segments.map(row => ({ type: 'Feature', properties: { ...row, kind: 'segment' },
  geometry: { type: 'LineString', coordinates: row.geometry_coordinates.map(point => [...point]) } }));
const selectedRoute = makeRoute();
const state = reactive({ selectedRoute, selectedProfile: { label: '合成出行情况' },
  mapFeatures: makeFeatures(selectedRoute), selectedSegmentCode: selectedRoute.segment_codes[0],
  guidancePaused: false, detourActive: false, textMemoRouteVerified: true, memoScope: 0,
  progress: { index: 0, paused: false }, obstructionState: { options: [], reason: '' },
  mapFailure: location.search.includes('fallback') ? '合成底图不可用' : '',
  pilotArea: { center: [10,10], min_zoom: 16, max_zoom: 20,
    limit_bounds: { south_west: [9.99,9.99], north_east: [10.01,10.01] },
    boundary: { coordinates: [[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]] } } });
const events = [], session = reactive({ role: 'elder', view: 'navigation', account: 'PRIVATE_ACCOUNT' });
function syncObstruction() {
  const index = state.progress.index;
  state.obstructionState = { reason: '', options: [index, index + 1].flatMap(i => {
    const row = state.selectedRoute?.segments[i];
    return row ? [{ route: state.selectedRoute, trip: state.memoScope, manualIndex: index, index: i,
      segment_code: row.segment_code, name: row.name, kind: i === index ? 'current' : 'next' }] : [];
  }) };
}
function restore() {
  session.role = 'elder'; session.view = 'navigation';
  state.selectedRoute = makeRoute(); state.mapFeatures = makeFeatures(state.selectedRoute);
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
  onEndNavigation: () => { events.push({ end: true }); state.textMemoRouteVerified = false; session.view = 'routes'; },
  onOpenRoutes: () => { events.push({ leave: true }); session.view = 'routes'; },
  onSendSos: () => events.push({ sos: true }) }) : h('p', session.role === 'elder' ? '合成路线视图' : '合成家庭视图') });
window.__memoFixture = { state, events, session, app, makeRoute, makeFeatures, restore }; app.mount('#app');`;

function installMocks({ capability, failure }) {
  const audit = window.__memoAudit = { spoken: [], cancels: 0, watches: 0, clears: 0, captures: 0,
    wakeRequests: 0, wakeReleases: 0, cameras: [], mapChanges: [], overlays: [], maps: [],
    storage: [], fetches: [], fixes: [], privatePrompts: { clipboardRead: 0, clipboardWrite: 0, share: 0, contacts: 0, permissionRequest: 0 },
    created: [], revoked: [], anchors: [], clicks: [], createAttempts: 0, failure };
  const unexpectedPrompt = name => async () => { audit.privatePrompts[name]++; throw new Error('合成隐私接口不应调用'); };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    readText: unexpectedPrompt('clipboardRead'), writeText: unexpectedPrompt('clipboardWrite'),
  } });
  Object.defineProperty(navigator, 'share', { configurable: true, value: unexpectedPrompt('share') });
  Object.defineProperty(navigator, 'contacts', { configurable: true, value: { select: unexpectedPrompt('contacts') } });
  Object.defineProperty(navigator.permissions, 'request', { configurable: true, value: unexpectedPrompt('permissionRequest') });
  const originalFetch = window.fetch;
  window.fetch = function (...args) { audit.fetches.push(String(args[0])); return originalFetch.apply(this, args); };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(ok, bad) { audit.captures++; audit.fixes.push({ ok, bad }); },
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
  const createObjectURL = URL.createObjectURL.bind(URL), revokeObjectURL = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (blob) {
    audit.createAttempts++;
    if (audit.failure === 'create') throw new Error('合成浏览器创建失败');
    const url = createObjectURL(blob);
    audit.created.push({ url, blob }); return url;
  };
  URL.revokeObjectURL = function (url) { audit.revoked.push(url); return revokeObjectURL(url); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    audit.anchors.push(this);
    audit.clicks.push({ href: this.href, filename: this.download, connected: this.isConnected });
    if (audit.failure === 'click') throw new Error('合成浏览器点击失败');
    return click.call(this);
  };
  if (capability === 'no-url') URL.createObjectURL = undefined;
  if (capability === 'no-download') delete HTMLAnchorElement.prototype.download;
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
  window.__memoSdk = { Map, Polyline, Polygon: Overlay, Circle: Overlay, Marker: Overlay,
    Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [{ name: 'navigation-memo-local-api', enforce: 'pre', resolveId(id) {
    if (/\/config\/api(?:\.js)?$/.test(id)) return '\0navigation-memo-local-api';
  }, load(id) {
    if (id === '\0navigation-memo-local-api') return 'export const API_BASE_URL=""; export const apiConfigurationError="";';
  } }, vue(), { name: 'navigation-memo-local-fixture',
    resolveId(id) { if (id === '/__navigation_memo_fixture.js') return '\0navigation-memo-fixture'; },
    load(id) { if (id === '\0navigation-memo-fixture') return fixture; },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_memo', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__navigation_memo_fixture.js"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set(), audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const toggle = page => page.getByRole('button', { name: /^(?:保存文字路线|收起文字路线|收起路线备忘)$/ });
const preview = page => page.getByTestId('navigation-memo-preview');
const memoText = page => page.getByTestId('navigation-memo-text');
const downloadButton = page => button(page, '下载文字路线（浏览器）');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const completionClaims = /(?:保存成功|已保存|保存完成|下载成功|下载完成|已下载|导出成功)/;

async function setup(provider = 'sdk', capability = 'normal', failure = '') {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block',
    acceptDownloads: true, ...(capability === 'webview' ? { userAgent: 'Mozilla/5.0 (Linux; Android 14; Synthetic; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36' } : {}) });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider, capability, failure, requests: [], api: [], external: [], rejected: [], errors: [], downloads: 0 };
  audits.push(audit);
  await context.route('**/*', route => {
    const url = new URL(route.request().url()); audit.requests.push(url.href);
    if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return route.abort('blockedbyclient'); }
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__memoSdk;}' });
    if (url.pathname === '/__navigation_memo' || url.pathname === '/__navigation_memo_fixture.js'
        || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks, { capability, failure });
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  page.on('download', () => audit.downloads++);
  await page.goto(`${base}/__navigation_memo${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; }); await tick(page);
  return { page, audit, async close() { await context.close(); contexts.delete(context); } };
}
async function stable(page, audit) {
  return { requests: audit.requests.length, browser: await page.evaluate(() => {
    const a = window.__memoAudit, f = window.__memoFixture;
    return { state: JSON.parse(JSON.stringify(f.state)), session: { ...f.session }, events: f.events,
      fetches: a.fetches, privatePrompts: a.privatePrompts, watches: a.watches, clears: a.clears, captures: a.captures,
      spoken: a.spoken, cancels: a.cancels, wakeRequests: a.wakeRequests, wakeReleases: a.wakeReleases,
      cameras: a.cameras, mapChanges: a.mapChanges, overlayOptions: a.overlays.map(item => item.options),
      storage: a.storage, local: { ...localStorage }, sessionStorage: { ...sessionStorage },
      counter: document.querySelector('.journey-counter')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      following: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
      location: document.querySelector('.journey-panel > .journey-location')?.textContent,
      mode: [...document.querySelectorAll('.journey-mode-switch button')].map(node => node.getAttribute('aria-pressed')),
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed'),
      pausedRest: document.querySelector('[data-testid="paused-rest-preview"]')?.textContent,
      walkingPlan: document.querySelector('#navigation-walking-plan')?.value };
  }) };
}
async function resources(page) {
  return page.evaluate(() => { const a = window.__memoAudit; return {
    created: a.created.map(item => ({ url: item.url, type: item.blob.type, size: item.blob.size })),
    revoked: [...a.revoked], clicks: [...a.clicks], createAttempts: a.createAttempts,
    attached: a.anchors.filter(anchor => anchor.isConnected).length,
    attachedDownloadAnchors: document.querySelectorAll('a[download]').length,
  }; });
}
async function noMemo(page) {
  await expect(preview(page)).toHaveCount(0); await expect(memoText(page)).toHaveCount(0);
  if (await toggle(page).count()) await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  assert.deepEqual(await page.evaluate(() => window.__memoAudit.privatePrompts), {
    clipboardRead: 0, clipboardWrite: 0, share: 0, contacts: 0, permissionRequest: 0,
  }, 'memo never opens clipboard, sharing, contact or permission prompts');
}
async function openMemo(page) {
  await expect(toggle(page)).toBeEnabled();
  await toggle(page).focus(); await page.keyboard.press('Enter');
  await expect(preview(page)).toBeVisible(); await expect(memoText(page)).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  const text = await memoText(page).textContent();
  for (const name of ['合成林荫步道', '合成沿河小路', '合成花园通道']) assert.ok(text.includes(name));
  assert.ok(text.indexOf('合成林荫步道') < text.indexOf('合成沿河小路'));
  assert.ok(text.indexOf('合成沿河小路') < text.indexOf('合成花园通道'));
  assert.doesNotMatch(text, /PRIVATE_|106\.123456|29\.654321|geometry|access_token|segment_code|user_id/);
  assert.doesNotMatch(await preview(page).innerText(), completionClaims);
  return text;
}
async function selectable(page, expected) {
  const selection = await memoText(page).evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const selected = getSelection(); selected.removeAllRanges(); selected.addRange(range);
    const result = { text: selected.toString(), userSelect: getComputedStyle(node).userSelect };
    selected.removeAllRanges(); return result;
  });
  assert.equal(selection.text, expected); assert.notEqual(selection.userSelect, 'none');
}
async function layout(page, provider) {
  const issues = await preview(page).evaluate(node => [node, ...node.querySelectorAll('*')].filter(item => {
    const box = item.getBoundingClientRect();
    return box.x < -1 || box.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1;
  }).map(item => item.tagName + ':' + item.textContent));
  assert.deepEqual(issues, [], `${provider}: memo fits 320px at 150% root font`);
  const textStyle = await memoText(page).evaluate(node => {
    const s = getComputedStyle(node); return { fontSize: parseFloat(s.fontSize), whiteSpace: s.whiteSpace };
  });
  assert.ok(textStyle.fontSize >= 24, `${provider}: large memo text`);
  assert.ok(['pre-wrap', 'break-spaces', 'normal'].includes(textStyle.whiteSpace), `${provider}: wrapping text`);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(widths[0] <= widths[1] + 1, `${provider}: document overflows: ${widths}`);
  for (const target of [toggle(page), downloadButton(page)]) {
    const box = await target.boundingBox(); assert.ok(box?.width >= 48 && box?.height >= 48, `${provider}: memo target >=48px`);
  }
  const nearProgress = await toggle(page).evaluate(node => {
    const progress = document.querySelector('.journey-progress');
    return Boolean(progress && node.closest('.journey-panel') === progress.closest('.journey-panel')
      && Math.abs(node.getBoundingClientRect().top - progress.getBoundingClientRect().bottom) < 600);
  });
  assert.ok(nearProgress, `${provider}: memo action stays near manual progress`);
}
async function downloadMemo(page, audit, expected) {
  const before = await resources(page), previousDownloads = audit.downloads;
  await downloadButton(page).focus();
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  assert.equal(download.suggestedFilename(), 'route-memo.txt');
  const stream = await download.createReadStream(); assert.ok(stream, 'download is readable without saveAs');
  const chunks = []; for await (const chunk of stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString('utf8'), expected, 'real browser file equals visible text byte for byte');
  assert.equal(await download.failure(), null);
  await expect.poll(async () => {
    const value = await resources(page); return value.created.every(item => value.revoked.includes(item.url));
  }).toBe(true);
  const after = await resources(page);
  assert.equal(audit.downloads, previousDownloads + 1);
  assert.equal(after.created.length, before.created.length + 1);
  assert.equal(after.clicks.length, before.clicks.length + 1);
  assert.equal(after.clicks.at(-1).filename, 'route-memo.txt');
  assert.equal(after.clicks.at(-1).connected, true, 'temporary anchor is attached for its explicit click');
  assert.equal(after.attached, 0); assert.equal(after.attachedDownloadAnchors, 0);
  const blobText = await page.evaluate(() => window.__memoAudit.created.at(-1).blob.text());
  assert.equal(blobText, expected); assert.match(after.created.at(-1).type, /^text\/plain(?:;|$)/i);
  assert.doesNotMatch(await preview(page).innerText(), completionClaims);
}
async function restore(page) {
  await page.evaluate(() => window.__memoFixture.restore()); await tick(page); await noMemo(page);
}

async function appIntegration() {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block', acceptDownloads: true });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider: 'real-App', capability: 'normal', requests: [], api: [], external: [], rejected: [], errors: [], downloads: 0, mockedApi: true };
  audits.push(audit);
  const ordinary = { ...makeRoute(), rank: 1, route_score: 90, estimated_minutes: 8 };
  const candidate = { rank: 2, route_score: 85, estimated_minutes: 5, distance_m: 200,
    summary: 'PRIVATE_OTHER_CANDIDATE_SUMMARY', segment_codes: ['PRIVATE_CANDIDATE_ONE', 'PRIVATE_CANDIDATE_TWO'],
    segments: ['合成竹林小径', '合成庭院连廊'].map((name, i) => ({ name,
      segment_code: ['PRIVATE_CANDIDATE_ONE', 'PRIVATE_CANDIDATE_TWO'][i], length_m: [90, 110][i],
      step_count: 0, width_m: 2, geometry_coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] })) };
  const features = [...ordinary.segments, ...candidate.segments].map(row => ({ type: 'Feature',
    properties: { kind: 'segment', segment_code: row.segment_code, name: row.name },
    geometry: { type: 'LineString', coordinates: row.geometry_coordinates } }));
  const entry = { segment_code: ordinary.segment_codes[0], name: ordinary.segments[0].name,
    allowed: true, distance_m: 2, snapped_coordinates: [10.0005, 10] };
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()); audit.requests.push(url.href);
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname.startsWith('/api/')) {
      audit.api.push({ path: url.pathname, method: request.method(), params: Object.fromEntries(url.searchParams) });
      if (url.pathname.endsWith('/pois')) return route.fulfill({ json: ['合成出发点', '合成目的地'].map(name => ({ name })) });
      if (url.pathname.includes('/pilot-areas/')) return route.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/geojson')) return route.fulfill({ json: { features } });
      if (url.pathname.endsWith('/start-options')) return route.fulfill({ json: { candidates: [entry] } });
      if (url.pathname.endsWith('/recommend')) return route.fulfill({ json: { ...Object.fromEntries(url.searchParams),
        routes: url.searchParams.has('start_longitude') ? [ordinary] : [ordinary, candidate], avoided_segments: [],
        ...(url.searchParams.has('start_longitude') ? { start_context: entry } : {}) } });
      return route.fulfill({ json: url.pathname.endsWith('/sites') ? [] : {} });
    }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export async function loadAmap(){throw new Error("合成本地示意图");}' });
    if (url.pathname === '/' || url.pathname === '/index.html'
        || /^\/(?:src|assets|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks, { capability: 'normal', failure: '' });
  const page = await context.newPage(); page.on('pageerror', error => audit.errors.push(error.message));
  page.on('download', () => audit.downloads++);
  await page.goto(`${base}/#/login`); await button(page, '跳过登录，直接使用').click();
  await page.getByRole('button', { name: /使用轮椅/ }).click();
  await button(page, '下一步').click(); await button(page, '暂时跳过').click();
  await page.getByLabel('选择出发地点', { exact: true }).selectOption('合成出发点');
  await page.getByLabel('选择目的地', { exact: true }).selectOption('合成目的地');
  await button(page, '查询适合的路线').click();
  await expect(page.getByRole('heading', { name: '请选择适合您的路线', exact: true })).toBeVisible();
  // Browser history into navigation has no explicit trip and cannot supply proof.
  await page.evaluate(() => { location.hash = '/elder/navigation'; });
  await expect(toggle(page)).toBeDisabled(); await noMemo(page);
  await page.evaluate(() => { location.hash = '/elder/routes'; });
  await page.locator('.route-card').nth(1).locator('.route-card-select').click();
  await button(page, '开始导航').click(); await expect(toggle(page)).toBeEnabled();
  const snapshot = async () => ({ requests: audit.requests.length, value: await page.evaluate(async () => {
    const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
    const auth = (await import('/src/composables/useAuthSession.js')).useAuthSession();
    const app = document.getElementById('app').__vue_app__._instance.setupState, a = window.__memoAudit;
    return JSON.parse(JSON.stringify({ routes: planner.routes.value, selectedRouteIndex: planner.selectedRouteIndex.value,
      selectedRoute: planner.selectedRoute.value, start: planner.startName.value, end: planner.endName.value,
      mobility: planner.mobilityType.value, strategy: planner.routeStrategy.value, detour: planner.detour.session.value,
      currentOrigin: planner.currentOrigin.value, startContext: planner.startContext.value,
      proof: planner.textMemoRouteVerified.value, user: auth.currentUser.value, guest: auth.isGuest.value,
      progress: app.navigationProgress, selectedSegmentCode: planner.selectedSegmentCode.value,
      captures: a.captures, watches: a.watches, clears: a.clears, spoken: a.spoken, cancels: a.cancels,
      wakeRequests: a.wakeRequests, wakeReleases: a.wakeReleases, cameras: a.cameras, mapChanges: a.mapChanges,
      fetches: a.fetches, privatePrompts: a.privatePrompts, storage: a.storage, local: { ...localStorage }, session: { ...sessionStorage } }));
  }) });
  // Resolve the module imports before capturing the network baseline.
  await snapshot(); await tick(page); const before = await snapshot();
  await toggle(page).click(); await expect(preview(page)).toBeVisible();
  const selectedText = await memoText(page).textContent();
  assert.match(selectedText, /合成竹林小径/); assert.match(selectedText, /合成庭院连廊/);
  assert.doesNotMatch(selectedText, /合成林荫步道|合成沿河小路|合成花园通道|PRIVATE_/);
  assert.deepEqual(await snapshot(), before, 'real App getter and selected candidate stay read-only on preview');
  await downloadMemo(page, audit, selectedText);
  assert.deepEqual(await snapshot(), before, 'real guest App download changes no route, progress, session, storage or service state');
  await toggle(page).click(); await button(page, '查看路线方案').click();
  await page.locator('.route-card').first().locator('.route-card-select').click();
  await button(page, '开始导航').click();
  await toggle(page).click(); await expect(memoText(page)).toContainText('合成林荫步道');
  await expect(memoText(page)).not.toContainText('合成竹林小径');
  await button(page, '前方走不了').click(); await noMemo(page);
  await page.locator('#navigation-obstruction input').first().check();
  await button(page, '绕开这段，暂停导航').click(); await noMemo(page);
  await expect(page.getByRole('heading', { name: '绕行引导已暂停', exact: true })).toBeVisible();
  await button(page, '取消本次绕行').click();
  await page.evaluate(() => { location.hash = '/elder/home'; });
  await button(page, '使用当前位置').click();
  await page.evaluate(() => window.__memoAudit.fixes.at(-1).ok({ coords: { longitude: 10.0005, latitude: 10, accuracy: 8 }, timestamp: Date.now() }));
  await page.getByLabel('附近已收录道路', { exact: true }).selectOption(entry.segment_code);
  await button(page, '确认我在这条道路上').click();
  await page.getByLabel('选择目的地', { exact: true }).selectOption('合成目的地');
  await button(page, '查询适合的路线').click(); await button(page, '开始导航').click();
  await expect(toggle(page)).toBeDisabled(); await noMemo(page);
  assert.ok(audit.api.some(item => item.path.endsWith('/recommend') && item.params.start_longitude), 'real GPS-start UI sends coordinate route query');
  assert.equal(audit.downloads, 1, 'App lifecycle and GPS path never request another download');
  assert.deepEqual(audit.api.filter(item => item.method !== 'GET'), [], 'guest memo never publishes navigation or private data');
  await context.close(); contexts.delete(context);
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['sdk', 'fallback']) {
    const run = await setup(provider), { page, audit } = run;
    await noMemo(page); assert.equal(audit.downloads, 0);
    assert.deepEqual((await resources(page)).created, [], 'mount creates no download');
    await button(page, '开启我的位置').click();
    await page.evaluate(() => window.__memoAudit.ok({ coords: { longitude: 10.0005, latitude: 10, accuracy: 8 }, timestamp: Date.now() }));
    await button(page, '导航时保持屏幕亮').click(); await tick(page);
    const before = await stable(page, audit), text = await openMemo(page);
    assert.deepEqual(await stable(page, audit), before, 'opening is read-only for the entire navigation/session state');
    assert.equal(audit.downloads, 0); assert.equal((await resources(page)).createAttempts, 0);
    await selectable(page, text); await layout(page, provider);
    await toggle(page).focus(); await page.keyboard.press('Enter'); await noMemo(page);
    assert.deepEqual(await stable(page, audit), before, 'closing changes no navigation/session state');
    assert.equal((await resources(page)).createAttempts, 0, 'closing never starts a download');
    await openMemo(page); await downloadMemo(page, audit, text);
    assert.deepEqual(await stable(page, audit), before, 'explicit file download changes no GPS, voice, wake, map, progress, events, storage, session or fetch state');
    await toggle(page).click(); await noMemo(page);

    // A still-pending URL is revoked immediately when the journey scope changes.
    await openMemo(page);
    const [pendingDownload] = await Promise.all([page.waitForEvent('download'), downloadButton(page).click()]);
    assert.equal(pendingDownload.suggestedFilename(), 'route-memo.txt');
    const pendingURL = await page.evaluate(() => window.__memoAudit.created.at(-1).url);
    assert.equal(await page.evaluate(url => window.__memoAudit.revoked.includes(url), pendingURL), false, 'cleanup timer is still pending');
    await page.evaluate(() => { window.__memoFixture.state.memoScope++; }); await noMemo(page);
    assert.equal(await page.evaluate(url => window.__memoAudit.revoked.includes(url), pendingURL), true, 'scope invalidation revokes without waiting for timer');
    const pendingStream = await pendingDownload.createReadStream(), pendingChunks = [];
    assert.ok(pendingStream); for await (const chunk of pendingStream) pendingChunks.push(chunk);
    assert.equal(Buffer.concat(pendingChunks).toString('utf8'), text);

    // Ordinary rest remains supported and keeps the separate rest disclosure frozen.
    await button(page, '关闭定位').click(); await button(page, '关闭屏幕常亮').click(); await tick(page);
    await button(page, '累了，休息一下').click();
    await button(page, '看看前方能在哪歇').click(); await expect(page.getByTestId('paused-rest-preview')).toBeVisible();
    const paused = await stable(page, audit); await openMemo(page);
    assert.deepEqual(await stable(page, audit), paused, 'memo leaves paused rest and its disclosure unchanged');
    await toggle(page).click(); await noMemo(page);
    assert.deepEqual(await stable(page, audit), paused); await button(page, '继续前行').click();

    const invalidations = [
      ['registered name corruption', () => page.evaluate(() => { window.__memoFixture.state.selectedRoute.segments[0].name = '合成其他登记名'; })],
      ['registered length corruption', () => page.evaluate(() => { window.__memoFixture.state.selectedRoute.segments[0].length_m++; })],
      ['registry name corruption', () => page.evaluate(() => { window.__memoFixture.state.mapFeatures[0].properties.name = '合成其他登记名'; })],
      ['duplicate registry', () => page.evaluate(() => { const f = window.__memoFixture; f.state.mapFeatures.push(f.state.mapFeatures[0]); })],
      ['coordinate origin', () => page.evaluate(() => { window.__memoFixture.state.selectedRoute.start_context = { source: 'PRIVATE_GPS_ORIGIN' }; })],
      ['revoked provenance', () => page.evaluate(() => { window.__memoFixture.state.textMemoRouteVerified = false; })],
      ['new route object', () => page.evaluate(() => { const f = window.__memoFixture; f.state.selectedRoute = f.makeRoute('PRIVATE_REPLAN_'); f.state.mapFeatures = f.makeFeatures(f.state.selectedRoute); })],
      ['memo scope', () => page.evaluate(() => { window.__memoFixture.state.memoScope++; })],
      ['detour session', () => page.evaluate(() => { window.__memoFixture.state.detourActive = true; })],
      ['guidance paused', () => page.evaluate(() => { window.__memoFixture.state.guidancePaused = true; })],
      ['obstruction disclosure', () => button(page, '前方走不了').click()],
      ['end confirmation', () => button(page, '结束导航').click()],
      ['leave routes', () => button(page, '查看路线方案').click()],
      ['role unmount', () => page.evaluate(() => { window.__memoFixture.session.role = 'family'; })],
    ];
    for (const [name, action] of invalidations) {
      await restore(page); await openMemo(page);
      const count = (await resources(page)).createAttempts, downloadCount = audit.downloads;
      await action(); await tick(page); await noMemo(page);
      assert.equal((await resources(page)).createAttempts, count, `${name}: invalidation never creates a file`);
      assert.equal(audit.downloads, downloadCount, `${name}: invalidation never downloads`);
    }
    await restore(page); await openMemo(page); await button(page, '前方走不了').click(); await noMemo(page);
    await page.locator('#navigation-obstruction input').first().check();
    await button(page, '绕开这段，暂停导航').click(); await noMemo(page);
    await expect(page.getByRole('heading', { name: '绕行引导已暂停', exact: true })).toBeVisible();
    await restore(page); await openMemo(page); await button(page, '结束导航').click(); await noMemo(page);
    await button(page, '继续导航').click(); await noMemo(page);
    await openMemo(page); await button(page, '结束导航').click(); await button(page, '结束但未确认到达').click(); await noMemo(page);
    await expect(page.getByText('合成路线视图', { exact: true })).toBeVisible();
    await restore(page); await openMemo(page); await page.evaluate(() => window.__memoFixture.app.unmount()); await noMemo(page);
    const downloadCount = audit.downloads;
    await page.reload(); await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor(); await tick(page);
    await noMemo(page); assert.equal(audit.downloads, downloadCount, 'reload never repeats a previous download');
    assert.equal((await resources(page)).createAttempts, 0, 'reload does not restore a download or preview');
    assert.deepEqual(await page.evaluate(() => window.__memoAudit.storage), []);
    await run.close();
  }
  for (const capability of ['webview', 'no-url', 'no-download']) {
    const run = await setup('fallback', capability), { page, audit } = run;
    const before = await stable(page, audit), text = await openMemo(page);
    await selectable(page, text);
    if (await downloadButton(page).count()) await expect(downloadButton(page)).toBeDisabled();
    await expect(preview(page)).toContainText(/浏览器|复制|长按|选择|不支持/);
    assert.equal((await resources(page)).createAttempts, 0); assert.equal(audit.downloads, 0);
    assert.deepEqual(await stable(page, audit), before, `${capability}: selectable fallback stays isolated`);
    await run.close();
  }
  for (const failure of ['create', 'click']) {
    const run = await setup('fallback', 'normal', failure), { page, audit } = run;
    const before = await stable(page, audit), text = await openMemo(page), oldMessage = await preview(page).innerText();
    await downloadButton(page).click(); await expect(preview(page)).toBeVisible();
    await expect(preview(page)).toContainText(/未能|失败|无法|不支持/);
    assert.notEqual(await preview(page).innerText(), oldMessage, `${failure}: failure is visibly reported`);
    assert.equal(await memoText(page).textContent(), text); await selectable(page, text);
    assert.equal(audit.downloads, 0); assert.doesNotMatch(await preview(page).innerText(), completionClaims);
    const value = await resources(page); assert.equal(value.attached, 0); assert.equal(value.attachedDownloadAnchors, 0);
    assert.ok(value.created.every(item => value.revoked.includes(item.url)), `${failure}: cleanup revokes created URLs`);
    assert.deepEqual(await stable(page, audit), before, `${failure}: failure leaves navigation unchanged`);
    await run.close();
  }
  await appIntegration();
  for (const audit of audits) {
    if (!audit.mockedApi) assert.deepEqual(audit.api, [], `${audit.provider}/${audit.capability}: API attempts`);
    assert.deepEqual(audit.external, [], `${audit.provider}/${audit.capability}: external attempts`);
    assert.deepEqual(audit.rejected, [], `${audit.provider}/${audit.capability}: non-fixture/import attempts`);
    assert.deepEqual(audit.errors, [], `${audit.provider}/${audit.capability}: page errors`);
  }
  console.log('PASS navigation memo: real NavigationPage SDK mock/fallback and real guest App planner binding; selected-candidate UTF-8 browser download read in memory, explicit-click-only Blob/anchor cleanup including immediate scope revocation, selectable WebView/unsupported/error fallback, keyboard/48px/320px/150% layout, private-field exclusion, paused-rest coexistence, corruption/obstruction/end/route/scope/role/unmount/reload clearing, actual GPS-start rejection, and unchanged GPS/voice/wake/map/progress/session/storage/network state. No hardware or live-service test.');
} catch (error) {
  console.error('Navigation memo browser audit:', JSON.stringify(audits.map(({ requests, ...audit }) => ({ ...audit, requestCount: requests.length })))); throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
