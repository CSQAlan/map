import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Direct real-page fixture; every road, voice, GPS fix and SDK object is synthetic.
// No backend, credentials, real sound/location, snapshots or artifact writes.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
function makeRoute(prefix = '') {
  const codes = ['a', 'b', 'c'].map(code => prefix + code), lengths = [73.63, 86, 174];
  return { distance_m: 333.63, segment_codes: codes,
    segments: codes.map((segment_code, i) => ({ segment_code,
      name: ['合成当前步道', '合成下一步道', '合成台阶终段'][i], length_m: lengths[i],
      step_count: [0, 0, 7][i], width_m: 2, risk_tags: [] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: [...codes],
      node_codes: ['start', 'one', 'rest', 'end'], segment_lengths_m: [...lengths],
      stops: [{ node_index: 2, node_code: 'rest', name: '合成中途休息点' }] } };
}
const fixture = `import { createApp, h, reactive } from 'vue';
import NavigationPage from '/src/pages/NavigationPage.vue';
import '/src/styles.css';
const makeRoute = ${makeRoute.toString()};
const selectedRoute = makeRoute();
const state = reactive({ selectedRoute, selectedProfile: { label: '合成出行情况' },
  mapFeatures: selectedRoute.segments.map((row, i) => ({ type: 'Feature', properties: { ...row, kind: 'segment' },
    geometry: { type: 'LineString', coordinates: [[10+i*.001,10],[10+(i+1)*.001,10]] } })),
  selectedSegmentCode: 'a', guidancePaused: false, detourActive: false,
  mapFailure: location.search.includes('fallback') ? '合成底图不可用' : '',
  pilotArea: { center: [10,10], min_zoom: 16, max_zoom: 20,
    limit_bounds: { south_west: [9.99,9.99], north_east: [10.01,10.01] },
    boundary: { coordinates: [[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]] } } });
const events = [], session = reactive({ role: 'elder' });
const app = createApp({ render: () => session.role === 'elder' ? h(NavigationPage, { ...state,
  onSelectSegment: code => { state.selectedSegmentCode = code; events.push({ select: code }); },
  onProgress: progress => events.push({ progress }),
  onPauseDetour: message => { state.guidancePaused = true; events.push({ pause: message }); },
  onMapError: message => { state.mapFailure = message; },
  onEndNavigation: () => events.push({ end: true }), onOpenRoutes: () => events.push({ leave: true }),
  onSendSos: () => events.push({ sos: true }) }) : h('p', '合成家庭视图') });
window.__briefFixture = { state, events, session, app, makeRoute }; app.mount('#app');`;

function installMocks({ speechMode }) {
  const audit = window.__briefAudit = { speechMode, spoken: [], utterances: [], cancels: 0,
    watches: 0, clears: 0, captures: 0, wakeRequests: 0, wakeReleases: 0,
    cameras: [], mapChanges: [], overlays: [], storage: [], maps: [] };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { audit.captures++; },
    watchPosition(ok, bad) { audit.ok = ok; audit.bad = bad; return ++audit.watches; },
    clearWatch() { audit.clears++; },
  } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: speechMode === 'missing' ? undefined : {
    getVoices() { return audit.speechMode === 'empty' ? [] : audit.speechMode === 'remote'
      ? [{ lang: 'zh-CN', localService: false, name: '合成远程中文' }]
      : [{ lang: 'zh-CN', localService: true, name: '合成本地中文' }]; },
    speak(utterance) {
      audit.utterances.push(utterance);
      audit.spoken.push({ text: utterance.text, rate: utterance.rate, lang: utterance.lang,
        local: utterance.voice?.localService, voice: utterance.voice?.name });
    }, cancel() { audit.cancels++; },
  } });
  window.SpeechSynthesisUtterance = speechMode === 'missing' ? undefined : class {
    constructor(text) { this.text = text; }
  };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { async request() {
    audit.wakeRequests++;
    return { released: false, addEventListener() {}, async release() {
      this.released = true; audit.wakeReleases++;
    } };
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
  window.__briefSdk = { Map, Polyline, Polygon: Overlay, Circle: Overlay, Marker: Overlay,
    Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'navigation-brief-local-fixture',
    resolveId(id) { if (id === '/__navigation_brief_fixture.js') return '\0navigation-brief-fixture'; },
    load(id) { if (id === '\0navigation-brief-fixture') return fixture; },
    configureServer(vite) {
      vite.middlewares.use('/__navigation_brief', (_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__navigation_brief_fixture.js"></script></body></html>');
      });
    },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set();
const audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const brief = page => page.getByTestId('navigation-current-brief');
const hear = page => button(page, '慢一点，只听这一段');
const halt = page => button(page, '停止这一段播报');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const spoken = page => page.evaluate(() => window.__briefAudit.spoken);
const callback = (page, index, kind = 'onend') => page.evaluate(([index, kind]) => {
  window.__briefAudit.utterances[index]?.[kind]?.();
}, [index, kind]).then(() => tick(page));
async function setup(provider = 'sdk', speechMode = 'local') {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider, speechMode, requests: [], api: [], external: [], rejected: [], errors: [] };
  audits.push(audit);
  // Install the network boundary before page creation/navigation; reject every API
  // and non-fixture/import request, including attempted loopback backend traffic.
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()); audit.requests.push(url.href);
    if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return route.abort('blockedbyclient'); }
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__briefSdk;}' });
    if (url.pathname === '/__navigation_brief' || url.pathname === '/__navigation_brief_fixture.js'
      || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks, { speechMode });
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  await page.goto(`${base}/__navigation_brief${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
  await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; }); await tick(page);
  return { page, audit, async close() { await context.close(); contexts.delete(context); } };
}
async function stable(page, audit) {
  return { requests: audit.requests.length, browser: await page.evaluate(() => {
    const a = window.__briefAudit, f = window.__briefFixture;
    return { watches: a.watches, clears: a.clears, captures: a.captures,
      wakeRequests: a.wakeRequests, wakeReleases: a.wakeReleases, cameras: a.cameras, mapChanges: a.mapChanges,
      storage: a.storage, local: { ...localStorage }, session: { ...sessionStorage }, events: f.events,
      selected: f.state.selectedSegmentCode, counter: document.querySelector('.journey-counter')?.textContent,
      follow: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      location: document.querySelector('.journey-panel > .journey-location')?.textContent,
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed') };
  }) };
}
async function checkLayout(page, provider) {
  const overflow = await page.locator('.journey-current, .journey-current-brief, [data-testid="navigation-current-brief"], [data-testid="navigation-current-brief"] *').evaluateAll(nodes => nodes.filter(node => {
    const b = node.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1;
  }).map(node => node.tagName + ':' + node.textContent));
  assert.deepEqual(overflow, [], `${provider}: brief fits 320px at 150% root font`);
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(widths[0] <= widths[1] + 1, `${provider}: document overflows: ${widths}`);
  for (const target of [hear(page), halt(page)]) {
    const box = await target.boundingBox(); assert.ok(box?.width >= 48 && box?.height >= 48, `${provider}: brief targets >=48px`);
  }
}
async function startBrief(page) {
  const count = (await spoken(page)).length;
  await hear(page).click(); await expect(brief(page)).toBeVisible(); await expect(halt(page)).toBeVisible();
  const rows = await spoken(page); assert.equal(rows.length, count + 1, 'each click speaks exactly once');
  const last = rows.at(-1);
  assert.equal(last.text, await page.getByTestId('navigation-current-brief-text').textContent(), 'readable brief equals utterance byte for byte');
  assert.equal(last.rate, 0.70); assert.equal(last.local, true); assert.equal(last.lang, 'zh-CN');
  await expect(hear(page)).toHaveAttribute('aria-expanded', 'true');
  assert.ok(await button(page, '停止播报').count() <= 1, 'no duplicate general stop label');
  return count;
}
async function cleared(page) {
  await expect(brief(page)).toHaveCount(0); await expect(halt(page)).toHaveCount(0);
  if (await hear(page).count()) await expect(hear(page)).toHaveAttribute('aria-expanded', 'false');
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['sdk', 'fallback']) {
    const run = await setup(provider), { page, audit } = run;
    await cleared(page); assert.deepEqual(await spoken(page), [], 'mount is silent');
    await expect(page.locator('.journey-current').getByRole('button', { name: '慢一点，只听这一段', exact: true })).toHaveCount(1);
    await button(page, '开启我的位置').click();
    await page.evaluate(() => window.__briefAudit.ok({ coords: { longitude: 10.0005, latitude: 10, accuracy: 8 }, timestamp: Date.now() }));
    await button(page, '导航时保持屏幕亮').click(); await tick(page);
    const before = await stable(page, audit);
    await hear(page).focus(); await page.keyboard.press('Enter');
    await expect(halt(page)).toBeVisible();
    assert.equal((await spoken(page)).length, 1);
    assert.equal((await spoken(page))[0].text, await page.getByTestId('navigation-current-brief-text').textContent());
    assert.equal((await spoken(page))[0].rate, 0.70); assert.equal((await spoken(page))[0].local, true);
    assert.deepEqual(await stable(page, audit), before, 'brief changes no GPS, camera, map, wake, progress, preference, event, storage or network state');
    await checkLayout(page, provider);
    await callback(page, 0); await expect(halt(page)).toHaveCount(0); await expect(brief(page)).toBeVisible();
    assert.equal((await spoken(page)).length, 1, 'completion never repeats');
    assert.deepEqual(await stable(page, audit), before);
    const old = await startBrief(page); await halt(page).focus(); await page.keyboard.press('Enter');
    await expect(halt(page)).toHaveCount(0); await expect(brief(page)).toBeVisible();
    assert.deepEqual(await stable(page, audit), before, 'local stop is also isolated');
    const current = await startBrief(page);
    await callback(page, old); await callback(page, old, 'onerror');
    await expect(halt(page)).toBeVisible(); await expect(brief(page)).not.toContainText('播报未完成');
    await callback(page, current, 'onerror'); await expect(halt(page)).toHaveCount(0);
    await expect(brief(page)).toContainText(/播报未完成|无法播放|查看文字/);
    const afterError = (await spoken(page)).length; await callback(page, current); await tick(page);
    assert.equal((await spoken(page)).length, afterError, 'error never repeats');

    // Map inspection and next-step preview never change the manual source of the brief.
    if (provider === 'fallback') {
      await page.locator('svg .map-road[aria-label^="合成台阶终段"]').focus(); await page.keyboard.press('Enter');
    } else {
      await page.evaluate(() => { const road = window.__briefAudit.overlays.find(item => item.options.extData?.segmentCode === 'c');
        for (const fn of road.handlers.click || []) fn(); });
    }
    await expect(page.getByTestId('map-follow-state')).toContainText('正在查看含台阶的登记路段');
    let utterance = await startBrief(page);
    await expect(brief(page)).toContainText('合成当前步道'); await expect(brief(page)).not.toContainText('合成台阶终段');
    await callback(page, utterance); await button(page, '预览下一段').click();
    await expect(page.locator('#next-segment-preview')).toContainText('合成下一步道');
    const previewState = await stable(page, audit); utterance = await startBrief(page);
    await expect(brief(page)).toContainText('合成当前步道'); await expect(brief(page)).not.toContainText('合成下一步道');
    assert.deepEqual(await stable(page, audit), previewState); await callback(page, utterance);

    // Ordinary replay/automatic speech keep their existing rate and preference.
    await button(page, '重播本段').click(); await cleared(page);
    let rows = await spoken(page); assert.equal(rows.at(-1).rate, 0.85);
    await callback(page, rows.length - 1); await button(page, '开启语音提示').click();
    await expect(button(page, '关闭语音')).toHaveAttribute('aria-pressed', 'true');
    rows = await spoken(page); assert.equal(rows.at(-1).rate, 0.85);
    utterance = await startBrief(page); await expect(button(page, '关闭语音')).toHaveAttribute('aria-pressed', 'true');
    await callback(page, utterance); const enabledCount = (await spoken(page)).length;
    await button(page, '已走完这段').click(); await cleared(page);
    rows = await spoken(page); assert.equal(rows.length, enabledCount + 1); assert.equal(rows.at(-1).rate, 0.85);
    assert.match(rows.at(-1).text, /合成下一步道/); await button(page, '关闭语音').click();
    await button(page, '上一段').click();
    const silent = (await spoken(page)).length; await tick(page); assert.equal((await spoken(page)).length, silent);

    // Each invalidation cancels the active brief and cannot be revived by stale callbacks.
    const invalidate = async action => {
      const oldIndex = await startBrief(page); await action(); await tick(page); await cleared(page);
      await callback(page, oldIndex); await callback(page, oldIndex, 'onerror'); await cleared(page);
      assert.equal((await spoken(page)).length, oldIndex + 1, 'invalidation cannot schedule hidden speech');
    };
    await invalidate(() => button(page, '累了，休息一下').click());
    await expect(hear(page)).toBeDisabled(); await button(page, '继续前行').click();
    await invalidate(() => button(page, '已走完这段').click());
    await invalidate(() => button(page, '上一段').click());
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.selectedRoute.segments[0].explanation = '合成更新说明'; }));
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.selectedRoute = window.__briefFixture.makeRoute(); }));
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.selectedProfile = { label: '合成另一出行情况' }; }));
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.selectedProfile.label = '合成资料更新'; }));
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.detourActive = true; }));
    await page.evaluate(() => { window.__briefFixture.state.detourActive = false; }); await tick(page);
    await invalidate(() => page.evaluate(() => { window.__briefFixture.state.guidancePaused = true; }));
    await expect(page.getByRole('heading', { name: '绕行引导已暂停', exact: true })).toBeVisible();
    await page.evaluate(() => { window.__briefFixture.state.guidancePaused = false; }); await tick(page);
    await invalidate(() => button(page, '结束导航').click());
    await expect(hear(page)).toBeDisabled(); await button(page, '继续导航').click();
    await invalidate(() => page.evaluate(() => { window.__briefFixture.session.role = 'family'; }));
    const unmountedCount = (await spoken(page)).length;
    await page.evaluate(() => { window.__briefFixture.session.role = 'elder'; }); await tick(page);
    await cleared(page); assert.equal((await spoken(page)).length, unmountedCount, 'role remount is silent');
    await invalidate(() => button(page, '查看路线方案').click());
    await expect(hear(page)).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => window.__briefAudit.storage), [], 'fixture never writes storage');
    await run.close();
  }
  for (const speechMode of ['empty', 'remote', 'missing']) {
    const run = await setup('fallback', speechMode), { page, audit } = run;
    const before = await stable(page, audit); await hear(page).click();
    await expect(brief(page)).toBeVisible(); await expect(brief(page)).toContainText(/本地中文语音.*不可用|不支持语音|查看文字/);
    await expect(page.getByTestId('navigation-current-brief-text')).toContainText('合成当前步道');
    await expect(halt(page)).toHaveCount(0); assert.deepEqual(await spoken(page), [], `${speechMode}: no remote or unsupported speech`);
    assert.deepEqual(await stable(page, audit), before, `${speechMode}: blocked speech remains isolated`);
    if (speechMode !== 'missing') {
      await page.evaluate(() => { window.__briefAudit.speechMode = 'local'; });
      const utterance = await startBrief(page); await callback(page, utterance);
    }
    assert.deepEqual(await page.evaluate(() => window.__briefAudit.storage), [], 'unsupported/local retry never writes storage');
    await run.close();
  }
  for (const audit of audits) {
    assert.deepEqual(audit.api, [], `${audit.provider}/${audit.speechMode}: API attempts`);
    assert.deepEqual(audit.external, [], `${audit.provider}/${audit.speechMode}: external attempts`);
    assert.deepEqual(audit.rejected, [], `${audit.provider}/${audit.speechMode}: non-fixture/import attempts`);
    assert.deepEqual(audit.errors, [], `${audit.provider}/${audit.speechMode}: page errors`);
  }
  console.log('PASS navigation brief: real NavigationPage with SDK mock/fallback, exact readable local .70 one-shot speech, keyboard/48px/320px/150% layout, completion/error/stale callbacks, unchanged .85 normal speech and auto preference, current manual step during map inspection/preview, lifecycle clearing, unsupported/remote-only blocking, and no GPS/map/wake/progress/events/storage/API/external effects or artifacts. No hardware test.');
} catch (error) {
  console.error('Navigation brief browser audit:', JSON.stringify(audits)); throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
