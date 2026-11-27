import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdir, writeFile } from 'node:fs/promises';

// Focused extension of check-active-navigation using its existing synthetic fixture.
// No live SDK, backend, credentials, hardware location or external requests.
const output = '../artifacts/navigation-recovery';
const saveArtifacts = !process.argv.includes('--no-artifacts');
if (saveArtifacts) await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, envDir: false, plugins: [vue(), {
  name: 'navigation-recovery-fixture', configureServer(server) {
    server.middlewares.use('/__navigation_recovery', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/scripts/fixtures/navigation-map-fixture.js"></script></body></html>');
    });
  },
}], server: { host: '127.0.0.1', port: 0, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
const results = [];
try {
  for (const provider of ['amap-mock', 'fallback']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(() => {
      window.__maps = []; window.__roads = []; window.__watches = 0; window.__cleared = 0; window.__spoken = [];
      Object.defineProperty(navigator, 'geolocation', { value: {
        watchPosition(success, error) { window.__gps = success; window.__gpsError = error; window.__watches++; return 1; },
        clearWatch() { window.__cleared++; },
      } });
      Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, getVoices: () => [], speak: u => window.__spoken.push(u.text) } });
      window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
      class Overlay { constructor(options) { this.options = options; this.handlers = {}; } setOptions(o) { Object.assign(this.options, o); } on(name, callback) { this.handlers[name] = callback; } setPosition(p) { this.options.position = p; } setCenter(p) { this.options.center = p; } setRadius(r) { this.options.radius = r; } }
      class Map { constructor() { this.cameras = []; window.__maps.push(this); } setLimitBounds() {} addControl() {} add() {} remove() {} setFitView(overlays) { this.cameras.push({ kind: 'fit', codes: overlays.map(o => o.options.extData?.segmentCode).filter(Boolean) }); } setZoomAndCenter(zoom, point) { this.cameras.push({ kind: 'position', point: [...point] }); } destroy() {} }
      class Polyline extends Overlay { constructor(options) { super(options); window.__roads.push(this); } }
      window.__sdk = { Map, Polyline, Polygon: Overlay, Marker: Overlay, Circle: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
    });
    const page = await context.newPage(), errors = [], external = [], requests = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', request => requests.push(request.url()));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(base + '/src/services/amapLoader')) return route.fulfill({ contentType: 'application/javascript', body: 'export const loadAmap=()=>Promise.resolve(window.__sdk);' });
      if (url.startsWith(base)) return route.continue();
      external.push(url); return route.abort();
    });
    await page.goto(base + '/__navigation_recovery' + (provider === 'fallback' ? '?fallback' : ''));
    await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
    const click = label => page.getByRole('button', { name: label, exact: true }).click();
    const fix = (change = {}) => page.evaluate(change => {
      const timestamp = Math.max(Date.now(), (window.__lastFix || 0) + 1); window.__lastFix = timestamp;
      window.__gps({ coords: { longitude: 10.0005, latitude: 10.0005, accuracy: 10, ...change.coords }, timestamp: timestamp + (change.age || 0) });
    }, change);
    const counters = () => page.evaluate(() => ({ progress: window.__navFixture.events.filter(e => e.progress).length,
      speech: window.__spoken.length, watches: window.__watches, cameras: window.__maps.at(-1)?.cameras.length || 0 }));
    const followText = () => page.getByTestId('map-follow-state').innerText();
    assert.equal((await counters()).watches, 0);
    assert.equal(await page.getByTestId('navigation-recovery').count(), 0, 'initial location opt-out');
    assert.ok((await page.getByRole('button', { name: '累了，休息一下', exact: true }).boundingBox()).y < 300);
    await click('已走完这段');
    await click('累了，休息一下');
    assert.match(await page.getByTestId('navigation-paused').innerText(), /第 2 段，共 3 段：合成测试段乙/);
    assert.match(await page.getByTestId('navigation-paused').innerText(), /不表示已到登记休息点/);
    assert.equal(await page.getByTestId('navigation-rest').count(), 0);
    assert.equal(await page.getByRole('button', { name: '已走完这段', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '上一段', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: '继续前行', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.equal((await counters()).watches, 0); assert.equal((await counters()).speech, 0);
    await click('开启我的位置'); await fix();
    assert.match(await followText(), /正在跟随/);
    assert.equal(await page.getByTestId('navigation-recovery').count(), 0, 'good follow');
    await click('开启语音提示'); await click('累了，休息一下');
    const resting = await counters();
    for (let i = 0; i < 3; i++) await fix({ coords: { latitude: 10.005 } });
    await fix();
    assert.deepEqual(await counters(), resting, 'rest stops automatic cameras, narration and advancement');
    assert.match(await followText(), /休息.*暂停位置跟随/);
    if (saveArtifacts) await page.screenshot({ path: `${output}/${provider}-paused.png`, fullPage: true });
    await fix({ coords: { accuracy: 80 } }); await click('继续前行');
    assert.doesNotMatch(await followText(), /正在跟随/);
    await fix(); assert.match(await followText(), /正在跟随/);
    await click('累了，休息一下'); await fix(); await click('继续前行');
    assert.match(await followText(), /正在跟随/);
    await click('累了，休息一下'); await click('查看全程'); await fix(); await click('继续前行');
    assert.match(await followText(), /浏览全程/);
    await click('回到当前位置并跟随'); assert.match(await followText(), /正在跟随/);
    await click('累了，休息一下');
    await click('文字导航'); assert.equal(await page.locator('#optional-navigation-map').count(), 0);
    await click('地图导航');
    for (const width of [280, 390]) for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 844 });
      await page.addStyleTag({ content: `html {font-size:${scale}%}` });
      const clipped = await page.locator('.journey-rest-panel, .journey-page button').evaluateAll(nodes => nodes.filter(n => {
        const b = n.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1 || b.height < 48;
      }).map(n => n.textContent));
      assert.deepEqual(clipped, [], `${provider}, paused ${width}px ${scale}%`);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.addStyleTag({ content: 'html {font-size:100%}' });
    await click('继续前行');
    const stableState = () => page.evaluate(() => ({
      progress: window.__navFixture.events.filter(e => e.progress), voice: [...window.__spoken], watches: window.__watches,
      status: document.querySelector('.journey-panel > .journey-location').textContent,
      step: document.querySelector('.journey-counter').textContent,
    }));
    for (const [label, pattern, trigger] of [
      ['poor', /精度较低/, () => fix({ coords: { accuracy: 80 } })],
      ['stale', /位置已过期或无效/, () => fix({ age: -16001 })],
      ['outside', /超出登记地图覆盖范围/, () => fix({ coords: { longitude: 11 } })],
      ['off-route', /可能偏离登记路线/, async () => { for (let i = 0; i < 3; i++) await fix({ coords: { latitude: 10.005 } }); }],
      ['denied', /定位权限未开启/, () => page.evaluate(() => window.__gpsError({ code: 1 }))],
    ]) {
      await fix(); assert.equal(await page.getByTestId('navigation-recovery').count(), 0);
      await trigger();
      const strip = page.getByTestId('navigation-recovery');
      assert.match(await strip.innerText(), pattern, label);
      assert.match(await strip.innerText(), /第 2 段：合成测试段乙/);
      assert.match(await strip.innerText(), /不能确定您实际站在哪里/);
      const before = await stableState(), networkBefore = requests.length;
      await click('按本段文字继续');
      assert.equal(await page.locator('#optional-navigation-map').count(), 0);
      assert.deepEqual(await stableState(), before);
      await click('查看本段登记地图');
      await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
      if (provider === 'amap-mock') assert.deepEqual(await page.evaluate(() => window.__maps.at(-1).cameras.at(-1).codes), ['b']);
      else assert.match(await page.locator('.navigation-schematic-labels').innerText(), /当前 第2段.*合成测试段乙/);
      assert.deepEqual(await stableState(), before);
      assert.equal(requests.length, networkBefore, 'recovery actions issue no network requests');
    }
    if (saveArtifacts) await page.screenshot({ path: `${output}/${provider}-recovery.png`, fullPage: true });
    await click('累了，休息一下'); assert.equal(await page.getByTestId('navigation-recovery').count(), 0);
    await click('继续前行'); assert.equal(await page.getByTestId('navigation-recovery').count(), 1);
    await click('结束导航'); assert.equal(await page.getByTestId('navigation-recovery').count(), 0);
    await click('继续导航'); assert.equal(await page.getByTestId('navigation-recovery').count(), 1);
    await page.evaluate(() => { const f = window.__navFixture; f.state.mapFeatures = [...f.features, f.features[1]]; });
    assert.equal(await page.getByRole('button', { name: '查看本段登记地图', exact: true }).isDisabled(), true);
    assert.match(await page.getByTestId('navigation-recovery').innerText(), /登记图形缺失或无效/);
    const invalidBefore = await stableState(); await click('按本段文字继续');
    assert.deepEqual(await stableState(), invalidBefore);
    await click('地图导航');
    for (const width of [280, 390]) for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 844 }); await page.addStyleTag({ content: `html {font-size:${scale}%}` });
      const clipped = await page.locator('.journey-recovery, .journey-recovery button').evaluateAll(nodes => nodes.filter(n => {
        const b = n.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
      }).map(n => n.textContent));
      assert.deepEqual(clipped, [], `${provider}, recovery ${width}px ${scale}%`);
    }
    await page.setViewportSize({ width: 390, height: 844 }); await page.addStyleTag({ content: 'html {font-size:100%}' });
    await page.evaluate(() => { const f = window.__navFixture; f.state.mapFeatures = f.features; });
    await click('开启我的位置'); await fix();
    assert.equal(await page.getByTestId('navigation-recovery').count(), 0);
    await click('累了，休息一下');
    await page.evaluate(() => { window.__navFixture.state.detourActive = true; });
    await fix({ coords: { accuracy: 80 } });
    await page.getByRole('heading', { name: '绕行引导已暂停', exact: true }).waitFor();
    assert.equal(await page.getByTestId('navigation-paused').count(), 0);
    assert.equal(await page.getByRole('button', { name: '继续前行', exact: true }).count(), 0);
    assert.equal(await page.locator('#optional-navigation-map').count(), 0);
    assert.equal(await page.getByTestId('navigation-recovery').count(), 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ provider, pause: 'passed', recovery: 'poor/stale/outside/off-route/denied, current registered map/text, invalid geometry, exclusions, no progress/voice/status/watcher/network mutation', errors, external });
    await context.close();
  }
  if (saveArtifacts) await writeFile(output + '/checks.json', JSON.stringify({ synthetic: true, results }, null, 2));
  console.log('PASS: rest pause/resume and location recovery in local Chrome, AMap MOCK and fallback; synthetic GPS, no external requests.');
} finally { await browser.close(); await server.close(); }
