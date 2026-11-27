import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Real NavigationPage, synthetic directed roads and browser capabilities only.
// No backend, live SDK, credentials, hardware GPS, screenshots or artifact writes.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
function makeRoute(prefix = '') {
  const codes = ['a', 'b', 'c'].map(code => prefix + code), lengths = [73.63, 86, 174];
  return { distance_m: 333.63, segment_codes: codes,
    segments: codes.map((segment_code, i) => ({ segment_code, name: ['合成当前整段', '合成中间整段', '合成终点整段'][i],
      length_m: lengths[i], step_count: 0, width_m: 2, risk_tags: [] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: [...codes],
      node_codes: ['start', 'one', 'rest', 'end'], segment_lengths_m: [...lengths],
      stops: [{ node_index: 0, node_code: 'start', name: '合成起点休息点' },
        { node_index: 2, node_code: 'rest', name: '合成中途休息点' },
        { node_index: 3, node_code: 'end', name: '合成终点休息点' }] } };
}
const fixture = `import { createApp, h, reactive } from 'vue';
import NavigationPage from '/src/pages/NavigationPage.vue';
import '/src/styles.css';
const makeRoute = ${makeRoute.toString()};
const selectedRoute = makeRoute();
const features = selectedRoute.segments.map((row,i)=>({type:'Feature',properties:{...row,kind:'segment'},
  geometry:{type:'LineString',coordinates:[[10+i*.001,10],[10+(i+1)*.001,10]]}}));
const state=reactive({selectedRoute,mapFeatures:features,selectedProfile:{label:'合成出行情况'},
  selectedSegmentCode:'a',guidancePaused:false,detourActive:false,
  mapFailure:location.search.includes('fallback')?'本地强制示意图':'',
  pilotArea:{center:[10,10],min_zoom:16,max_zoom:20,
    limit_bounds:{south_west:[9.99,9.99],north_east:[10.01,10.01]},
    boundary:{coordinates:[[[9.99,9.99],[10.01,9.99],[10.01,10.01],[9.99,10.01],[9.99,9.99]]]}}});
const events=[],session=reactive({role:'elder'});
const app=createApp({render:()=>session.role==='elder'?h(NavigationPage,{...state,
  onSelectSegment:code=>{state.selectedSegmentCode=code;events.push({select:code});},
  onProgress:progress=>events.push({progress}),onPauseDetour:message=>{state.guidancePaused=true;events.push({pause:message});},
  onMapError:message=>{state.mapFailure=message;},onEndNavigation:()=>events.push({end:true}),
  onOpenRoutes:()=>events.push({leave:true}),onSendSos:()=>events.push({sos:true})}):h('p','合成家庭视图')});
window.__pausedFixture={state,events,session,makeRoute,app};app.mount('#app');`;

function installMocks() {
  const audit = window.__pausedAudit = { watches: 0, clears: 0, captures: 0, spoken: [], cancels: 0,
    wakeRequests: 0, wakeReleases: 0, cameras: [], storage: [], maps: [] };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { audit.captures++; },
    watchPosition(ok, bad) { audit.ok = ok; audit.bad = bad; return ++audit.watches; },
    clearWatch() { audit.clears++; },
  } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'zh-CN', localService: true }],
    speak(utterance) { audit.spoken.push(utterance.text); }, cancel() { audit.cancels++; },
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { async request() {
    audit.wakeRequests++; return { released: false, addEventListener() {},
      async release() { this.released = true; audit.wakeReleases++; } };
  } } });
  for (const method of ['setItem', 'removeItem', 'clear']) {
    const original = Storage.prototype[method];
    Storage.prototype[method] = function (...args) {
      audit.storage.push({ method, args, kind: this === localStorage ? 'local' : 'session' });
      return original.apply(this, args);
    };
  }
  class Overlay {
    constructor(options = {}) { this.options = options; }
    on() {} setOptions(value) { Object.assign(this.options, value); }
    setPosition(value) { this.options.position = value; } setCenter(value) { this.options.center = value; }
    setRadius(value) { this.options.radius = value; }
  }
  class Map {
    constructor() { audit.maps.push(this); } setLimitBounds() {} addControl() {} add() {} remove() {}
    setFitView(items) { audit.cameras.push({ type: 'fit', codes: items.map(item => item.options.extData?.segmentCode).filter(Boolean) }); }
    setZoomAndCenter(zoom, point) { audit.cameras.push({ type: 'center', zoom, point: [...point] }); }
    destroy() {}
  }
  window.__pausedSdk = { Map, Polyline: Overlay, Polygon: Overlay, Circle: Overlay, Marker: Overlay,
    Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'paused-rest-local-fixture',
    resolveId(id) { if (id === '/__paused_rest_fixture.js') return '\0paused-rest-fixture'; },
    load(id) { if (id === '\0paused-rest-fixture') return fixture; },
    configureServer(vite) {
    vite.middlewares.use('/__paused_rest', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/__paused_rest_fixture.js"></script></body></html>');
    });
  } }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser;
try {
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['amap-mock', 'fallback']) {
    const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
    const requests = [], external = [], api = [], errors = [];
    try {
      await context.addInitScript(installMocks);
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url()); requests.push(url.href);
        if (url.origin !== base) { external.push(url.href); return route.abort(); }
        if (url.pathname.startsWith('/api/')) { api.push(url.pathname); return route.fulfill({ json: {} }); }
        if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
          contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__pausedSdk;}' });
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(8000);
      page.on('pageerror', error => errors.push(error.message));
      const button = label => page.getByRole('button', { name: label, exact: true });
      const click = label => button(label).click();
      const preview = page.getByTestId('paused-rest-preview');
      const open = button('看看前方能在哪歇'), close = button('收起前方休息信息');
      const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const mutate = fn => page.evaluate(fn).then(tick);
      const stable = async () => ({ requests: requests.length, browser: await page.evaluate(() => {
        const a = window.__pausedAudit, f = window.__pausedFixture;
        return { watches: a.watches, clears: a.clears, captures: a.captures, spoken: a.spoken, cancels: a.cancels,
          wakeRequests: a.wakeRequests, wakeReleases: a.wakeReleases, cameras: a.cameras,
          storage: a.storage, local: { ...localStorage }, session: { ...sessionStorage }, events: f.events,
          selected: f.state.selectedSegmentCode, counter: document.querySelector('.journey-counter')?.textContent,
          follow: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
          location: document.querySelector('.journey-panel > .journey-location')?.textContent };
      }) });
      const collapsed = async () => {
        await expect(preview).toHaveCount(0);
        await expect(open).toHaveAttribute('aria-expanded', 'false');
      };
      const checkReadOnly = async () => {
        await expect(preview.locator('button, input, select, textarea, a, [contenteditable="true"]')).toHaveCount(0);
        assert.equal(await preview.getAttribute('aria-live'), null);
        await expect(page.getByTestId('navigation-rest')).toHaveCount(0);
        await expect(page.getByTestId('navigation-rest-plan')).toHaveCount(0);
      };
      await page.goto(`${base}/__paused_rest${provider === 'fallback' ? '?fallback' : ''}`);
      await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor(); await tick();
      await expect(open).toHaveCount(0); await expect(preview).toHaveCount(0);
      await page.locator('#navigation-walking-plan').selectOption('100');
      await expect(page.getByTestId('navigation-rest-plan')).toContainText('59.63 米');
      await click('开启我的位置');
      await page.evaluate(() => window.__pausedAudit.ok({ coords: { longitude: 10.0005, latitude: 10, accuracy: 8 }, timestamp: Date.now() }));
      await click('开启语音提示'); await click('导航时保持屏幕亮'); await tick();
      await click('累了，休息一下'); await tick();
      const paused = page.getByTestId('navigation-paused');
      await collapsed(); await expect(open).toHaveAttribute('aria-controls', 'paused-rest-preview');
      assert.equal(await paused.locator('button').evaluateAll(nodes => nodes.findIndex(n => n.textContent === '继续前行')
        < nodes.findIndex(n => n.textContent === '看看前方能在哪歇')), true, 'resume precedes disclosure');
      let before = await stable();
      await open.focus(); await page.keyboard.press('Enter');
      await expect(close).toHaveAttribute('aria-expanded', 'true'); await expect(preview).toHaveAttribute('id', 'paused-rest-preview');
      await expect(preview).toContainText('合成中途休息点'); await expect(preview).toContainText('159.63 米');
      await expect(preview).toContainText('59.63 米');
      await expect(preview).toContainText(/当前整段/); await expect(preview).toContainText(/不保证.*座位.*通行/);
      await checkReadOnly(); assert.deepEqual(await stable(), before, 'opening is read-only with active GPS/voice history');
      await expect(button('已走完这段')).toBeDisabled(); await expect(button('上一段')).toBeDisabled();
      const beforeFix = await stable();
      await page.evaluate(() => window.__pausedAudit.ok({ coords: { longitude: 10.0007, latitude: 10, accuracy: 9 }, timestamp: Date.now() + 1 }));
      await tick();
      const afterFix = await stable(), fixedComparison = structuredClone(afterFix), frozenComparison = structuredClone(beforeFix);
      delete fixedComparison.browser.location; delete frozenComparison.browser.location;
      assert.deepEqual(fixedComparison, frozenComparison, 'GPS with disclosure open cannot move camera, speak or advance manual progress');
      await expect(preview).toContainText('159.63 米'); await expect(button('已走完这段')).toBeDisabled();
      await expect(button('上一段')).toBeDisabled(); before = afterFix;
      for (const scale of [100, 200]) {
        await page.evaluate(value => { document.documentElement.style.fontSize = `${value}%`; }, scale); await tick();
        const overflow = await paused.locator(':scope, button, #paused-rest-preview, #paused-rest-preview *').evaluateAll(nodes => nodes.filter(node => {
          const b = node.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1;
        }).map(node => node.tagName + ':' + node.textContent));
        assert.deepEqual(overflow, [], `${provider}: paused preview fits 320px at ${scale}% text`);
        for (const control of [button('继续前行'), close]) { const box = await control.boundingBox(); assert.ok(box.width >= 48 && box.height >= 48); }
      }
      await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
      await close.focus(); await page.keyboard.press('Enter'); await collapsed();
      assert.deepEqual(await stable(), before, 'closing changes no progress, location, speech, camera, wake lock, storage or network state');
      await open.click(); await click('继续前行'); await expect(preview).toHaveCount(0);
      await click('累了，休息一下'); await collapsed();
      await click('继续前行'); await click('已走完这段'); await click('累了，休息一下'); await open.click();
      await expect(preview).toContainText('86 米'); await expect(preview).not.toContainText('159.63 米');
      await checkReadOnly();
      // Route identity and deep evidence mutations both discard the open disclosure.
      await mutate(() => { window.__pausedFixture.state.selectedRoute = window.__pausedFixture.makeRoute('replacement-'); });
      await expect(preview).toHaveCount(0); await click('累了，休息一下'); await collapsed(); await open.click();
      await mutate(() => { window.__pausedFixture.state.selectedRoute.navigation_rest.stops[1].name = '合成更新中途点'; });
      await collapsed(); await open.click(); await expect(preview).toContainText('合成更新中途点');
      await expect(preview).not.toContainText('合成中途休息点');
      for (const mutation of [
        () => { window.__pausedFixture.state.selectedProfile = { label: '合成另一出行情况' }; },
        () => { window.__pausedFixture.state.pilotArea.center[0] = 10.0001; },
        () => { window.__pausedFixture.state.detourActive = true; },
      ]) { await mutate(mutation); await expect(preview).toHaveCount(0); if (await open.count()) await open.click(); }
      await mutate(() => { window.__pausedFixture.state.detourActive = false;
        window.__pausedFixture.state.selectedRoute.navigation_rest.version = 2; });
      await collapsed(); await open.click(); await expect(preview).toContainText('暂未确认');
      await expect(preview).not.toContainText(/159\.63|合成更新中途点|前方无已标注中途休息点/); await checkReadOnly();
      await mutate(() => { const r = window.__pausedFixture.state.selectedRoute;
        r.navigation_rest.version = 1; delete r.navigation_rest.node_codes; });
      await collapsed(); await open.click(); await expect(preview).toContainText('暂未确认');
      await expect(preview).not.toContainText(/159\.63|合成更新中途点|前方无已标注中途休息点/);
      await mutate(() => { const r = window.__pausedFixture.state.selectedRoute;
        r.navigation_rest.node_codes = ['start', 'one', 'rest', 'end']; r.segments[0].segment_code = 'unreliable-current'; });
      await collapsed(); await open.click(); await expect(preview).toContainText('暂未确认');
      await expect(preview).not.toContainText(/159\.63|合成更新中途点|估算超出计划/);
      await mutate(() => { const r = window.__pausedFixture.state.selectedRoute; r.segments[0].segment_code = r.segment_codes[0]; });
      await mutate(() => { const r = window.__pausedFixture.state.selectedRoute; r.navigation_rest.version = 1; r.navigation_rest.stops = []; });
      await collapsed(); await open.click(); await expect(preview).toContainText('前方无已标注中途休息点');
      await expect(preview).not.toContainText(/暂未确认|终点是登记休息点|159\.63|估算超出计划/); await checkReadOnly();
      await mutate(() => { window.__pausedFixture.state.selectedRoute.navigation_rest.stops = [{ node_index: 3, node_code: 'end', name: '合成仅终点休息点' }]; });
      await collapsed(); await open.click(); await expect(preview).toContainText('前方无已标注中途休息点');
      await expect(preview).toContainText('终点是登记休息点：合成仅终点休息点');
      await expect(preview).not.toContainText(/159\.63|前方最近登记中途休息点|估算超出计划/); await checkReadOnly();
      await click('结束导航'); await expect(preview).toHaveCount(0); await expect(open).toHaveCount(0); await expect(close).toHaveCount(0);
      await click('继续导航'); await collapsed(); await open.click();
      await mutate(() => { window.__pausedFixture.state.guidancePaused = true; });
      await expect(page.getByRole('heading', { name: '绕行引导已暂停', exact: true })).toBeVisible();
      await expect(paused).toHaveCount(0); await expect(preview).toHaveCount(0); await expect(open).toHaveCount(0);
      await mutate(() => { window.__pausedFixture.state.guidancePaused = false; });
      await click('累了，休息一下'); await collapsed(); await open.click();
      // The app's role gate unmounts this page. A new elder mount cannot revive it.
      await mutate(() => { window.__pausedFixture.session.role = 'family'; });
      await expect(paused).toHaveCount(0); await expect(preview).toHaveCount(0); await expect(open).toHaveCount(0);
      await mutate(() => { window.__pausedFixture.session.role = 'elder'; });
      await expect(preview).toHaveCount(0); await expect(open).toHaveCount(0);
      await click('累了，休息一下'); await collapsed(); await open.click();
      await click('查看路线方案'); await expect(preview).toHaveCount(0); await expect(open).toHaveCount(0);
      // A restored manual pause with no current route must say unknown, never zero.
      await mutate(() => { window.__pausedFixture.session.role = 'family'; });
      await mutate(() => { const f = window.__pausedFixture; f.state.selectedRoute = null;
        f.state.progress = { index: 0, paused: true }; f.session.role = 'elder'; });
      await collapsed(); await open.click(); await expect(preview).toContainText('当前路线暂未确认');
      await expect(preview).not.toContainText(/合成仅终点休息点|前方无已标注中途休息点|159\.63|0 米/);
      await checkReadOnly();
      assert.deepEqual(api, []); assert.deepEqual(external, []); assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => window.__pausedAudit.storage.length), 0, 'no preference persistence or storage writes');
      await mutate(() => { window.__pausedFixture.app.unmount(); });
    } finally { await context.close(); }
  }
  console.log('PASS: paused rest disclosure in real NavigationPage, AMap mock and fallback; explicit keyboard disclosure, whole frozen leg, read-only plan, unknown/none/destination and absent chain/current route, lifecycle resets, role unmount/remount and detour suppression, 320px/200% text, no disclosure side effects or external/API requests/artifacts. No hardware test.');
} finally { await browser?.close(); await server.close(); }
