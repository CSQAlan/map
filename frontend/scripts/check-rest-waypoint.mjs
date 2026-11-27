import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../../artifacts/rest-waypoint/', import.meta.url));
const saveArtifacts = !process.argv.includes('--no-artifacts');
const points = [[106.305, 29.601], [106.3055, 29.601], [106.306, 29.601], [106.3065, 29.601]];
const codes = ['A', 'B', 'C'];
const route = { distance_m: 150, segment_codes: codes,
  segments: codes.map((segment_code, i) => ({ segment_code, name: `合成登记步道${i + 1}`,
    length_m: 50, step_count: 0, width_m: 2, risk_tags: [], wheelchair_accessible: true })),
  navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: codes,
    node_codes: ['start', 'first', 'second', 'end'], segment_lengths_m: [50, 50, 50],
    stops: [{ node_index: 1, node_code: 'first', name: '合成第一休息点' },
      { node_index: 2, node_code: 'second', name: '合成第二休息点' }] } };
const features = codes.map((segment_code, i) => ({ type: 'Feature', properties: { kind: 'segment', segment_code },
  geometry: { type: 'LineString', coordinates: [points[i], points[i + 1]] } }));
const area = { center: points[0], min_zoom: 16, max_zoom: 20,
  limit_bounds: { south_west: [106.30, 29.60], north_east: [106.31, 29.61] },
  boundary: { coordinates: [[[106.30, 29.60], [106.31, 29.60], [106.31, 29.61], [106.30, 29.61], [106.30, 29.60]]] } };

function installMocks() {
  const audit = window.__restAudit = { cameras: [], instances: [], watches: 0, spoken: 0, events: [], storageWrites: 0 };
  Storage.prototype.setItem = () => { audit.storageWrites++; throw Error('fixture must not store preferences'); };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    watchPosition() { audit.watches++; throw Error('GPS must remain off'); },
    getCurrentPosition() { audit.watches++; throw Error('GPS must remain off'); }, clearWatch() {},
  } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    cancel() {}, getVoices: () => [], speak() { audit.spoken++; },
  } });
  class Overlay {
    constructor(options) { this.options = options; }
    on() {} setOptions(options) { Object.assign(this.options, options); }
  }
  class Map {
    constructor(element) { this.element = element; this.items = []; audit.instances.push(this); }
    setLimitBounds() {} addControl() {}
    add(items) { for (const item of [items].flat()) { this.items.push(item); if (item.options.content) this.element.append(item.options.content); } }
    remove(items) { for (const item of [items].flat()) item.options.content?.remove(); this.items = this.items.filter(item => ![items].flat().includes(item)); }
    setFitView() { audit.cameras.push({ kind: 'fit' }); }
    setZoomAndCenter(zoom, point) { audit.cameras.push({ kind: 'center', point: [...point] }); }
    destroy() { this.items = []; this.element.replaceChildren(); }
  }
  window.__restAmap = { Map, Polyline: Overlay, Polygon: Overlay, Marker: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

const harness = `
import { createApp, h, reactive } from 'vue';
import '/src/styles.css';
import '/src/styles/base.css';
import '/src/styles/mobile-refresh.css';
import Page from '/src/pages/NavigationPage.vue';
import Amap from '/src/components/AmapRouteMap.vue';
import Fallback from '/src/components/FallbackRouteMap.vue';
const mode = new URLSearchParams(location.search).get('mode');
const p = window.__restProps = reactive({ selectedRoute:${JSON.stringify(route)}, mapFeatures:${JSON.stringify(features)},
  pilotArea:${JSON.stringify(area)}, mapFailure:mode==='fallback'?'isolated fallback':'', guidancePaused:false });
window.__initialRestFixture = ${JSON.stringify({ route, features })};
const audit = window.__restAudit;
createApp({ render:()=>h(Page,{...p, onProgress:value=>audit.events.push(['progress',value]),
  onSelectSegment:value=>audit.events.push(['segment',value]), onOpenRoutes:()=>audit.events.push(['routes']),
  onEndNavigation:()=>audit.events.push(['end']), onMapError:value=>{throw Error(value);} }) }).mount('#app');
// Both ordinary route-map renderers must ignore the navigation-only prop.
createApp({ render:()=>h(mode==='fallback'?Fallback:Amap,{area:p.pilotArea,features:${JSON.stringify(features)},
  routeSegmentCodes:new Set(['A','B','C']),restWaypoint:{name:'must not show',nodeCode:'first',point:${JSON.stringify(points[1])}}}) }).mount('#ordinary');
`;
const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'isolated-rest-fixture',
    resolveId(id) { if (id === '/__rest-harness.js') return '\0rest-harness'; },
    load(id) { if (id === '\0rest-harness') return harness; },
    configureServer(server) { server.middlewares.use('/__rest-fixture', async (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await server.transformIndexHtml('/__rest-fixture', '<html lang="zh"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><div id="ordinary"></div><script type="module" src="/__rest-harness.js"></script></html>'));
    }); },
  }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser;
const audits = [];
const contexts = new Set();
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const marker = page => page.locator('#app [role="img"][aria-label^="下一登记中途休息点"]');
const button = page => page.getByRole('button', { name: '在地图查看休息点', exact: true });
const snapshot = page => page.evaluate(() => ({
  events: JSON.stringify(window.__restAudit.events), cameras: window.__restAudit.cameras.length,
  watches: window.__restAudit.watches, spoken: window.__restAudit.spoken,
  current: document.querySelector('.journey-counter')?.textContent,
}));
async function layout(page) {
  const sizes = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  assert.ok(sizes.scroll <= sizes.client + 1, `320px overflow ${JSON.stringify(sizes)}`);
  const bounds = await button(page).boundingBox();
  assert.ok(bounds.width >= 48 && bounds.height >= 48);
}

async function checkWalkingPlan(page, mode) {
  // Same synthetic rest path as the existing contest rest fixture: no real trip.
  await page.evaluate(() => {
    const r = structuredClone(window.__initialRestFixture.route);
    r.distance_m = 333.63;
    r.segments.forEach((row, i) => { row.length_m = [73.63, 86, 174][i]; });
    r.navigation_rest.segment_lengths_m = [73.63, 86, 174];
    r.navigation_rest.stops = [{ node_index: 2, node_code: 'second', name: '合成计划休息点' }];
    window.__restProps.selectedRoute = r;
  });
  const plan = page.getByLabel('我计划再走的距离（可选）', { exact: true });
  const comparison = page.getByTestId('navigation-rest-plan');
  await expect(plan).toHaveValue(''); await expect(comparison).toHaveCount(0);
  await expect(page.getByTestId('navigation-rest-message')).toContainText('159.63 米');
  const before = await snapshot(page);
  await plan.selectOption('100');
  await expect(comparison).toHaveText('估算超出计划约 59.63 米。');
  assert.deepEqual(await snapshot(page), before, 'selection has no camera, progress, GPS or speech effects');
  await expect(page.locator('#navigation-plan-explanation')).toContainText('下一登记中途休息点');
  await page.addStyleTag({ content: 'html { font-size:24px; }' });
  await layout(page);
  const bounds = await plan.boundingBox(); assert.ok(bounds.height >= 48);
  const sizes = await plan.evaluate(element => ({ width: element.getBoundingClientRect().width,
    parent: element.parentElement.getBoundingClientRect().width }));
  assert.ok(sizes.width <= sizes.parent + 1, 'select remains in the compact card at 320px/150%');
  await click(page, '已走完这段');
  await expect(page.getByTestId('navigation-rest-message')).toContainText('86 米');
  await expect(comparison).toHaveText('估算未超过计划，少约 14 米。');
  await click(page, '累了，休息一下');
  await expect(comparison).toHaveCount(0); await expect(marker(page)).toHaveCount(0);
  await click(page, '继续前行'); await expect(comparison).toHaveText('估算未超过计划，少约 14 米。');
  await click(page, '已走完这段');
  await expect(comparison).toHaveCount(0); await expect(plan).toHaveCount(0); await expect(marker(page)).toHaveCount(0);
  await expect(page.getByTestId('navigation-rest')).not.toContainText('合成计划休息点');
  await click(page, '上一段'); await expect(comparison).toHaveCount(1);
  await page.evaluate(() => { window.__restProps.selectedRoute.navigation_rest = null; });
  await expect(comparison).toHaveCount(0); await expect(marker(page)).toHaveCount(0);
  await expect(page.getByTestId('navigation-rest')).not.toContainText('合成计划休息点');
  await page.evaluate(() => { window.__restProps.selectedRoute = structuredClone(window.__initialRestFixture.route); });
  await expect(plan).toHaveValue(''); await expect(comparison).toHaveCount(0);
  // Exact 100 m boundary belongs in its own synthetic case.
  await page.evaluate(() => {
    const r = structuredClone(window.__initialRestFixture.route);
    r.distance_m = 200; r.segments[0].length_m = 100;
    r.navigation_rest.segment_lengths_m[0] = 100;
    window.__restProps.selectedRoute = r;
  });
  await plan.selectOption('100'); await expect(comparison).toHaveText('估算恰好等于计划（100 米）。');
  await plan.selectOption(''); await expect(comparison).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.__restAudit.storageWrites), 0);
  await page.evaluate(() => { window.__restProps.selectedRoute = structuredClone(window.__initialRestFixture.route); });
  console.log(`PASS synthetic walking plan ${mode}: 159.63 - 100 = 59.63; 100 - 86 = 14; passed/unknown/pause clear; exact 100; route reset; 320px/150%; zero storage/API/GPS/speech. Real trips tested: 0.`);
}

try {
  if (saveArtifacts) await mkdir(output, { recursive: true });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const mode of ['sdk', 'fallback']) {
    const audit = { mode, external: [], api: [], errors: [], sockets: [] }; audits.push(audit);
    const context = await browser.newContext({ viewport: { width: 320, height: 740 }, serviceWorkers: 'block' });
    contexts.add(context);
    await context.addInitScript(installMocks);
    await context.route('**/*', async intercepted => {
      const url = new URL(intercepted.request().url());
      if (url.hostname !== '127.0.0.1') { audit.external.push(url.href); return intercepted.abort(); }
      if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return intercepted.abort(); }
      // Vite's injected dev client opens HMR sockets even with hmr:false in this
      // version. This isolated harness needs only its CSS helper, no dev channel.
      if (url.pathname === '/@vite/client') return intercepted.fulfill({ contentType: 'application/javascript', body:
        'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){},invalidate(){},data:{}}); export function updateStyle(id,css){let s=document.getElementById(id);if(!s){s=document.createElement("style");s.id=id;document.head.append(s);}s.textContent=css;} export function removeStyle(id){document.getElementById(id)?.remove();}' });
      if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return intercepted.fulfill({
        contentType: 'application/javascript', body: 'export async function loadAmap(){return window.__restAmap;}' });
      return intercepted.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => audit.errors.push(error.message));
    page.on('websocket', socket => audit.sockets.push(socket.url()));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__rest-fixture?mode=${mode}`);
    await expect(marker(page)).toHaveCount(1);
    await expect(marker(page)).toHaveAttribute('aria-label', /合成第一休息点.*登记路网节点.*非座椅位置.*未确认实时到达/);
    await expect(page.locator('#ordinary [aria-label^="下一登记中途休息点"]')).toHaveCount(0);
    await layout(page);
    let before = await snapshot(page);
    assert.equal(before.watches, 0); assert.equal(before.spoken, 0);
    // Geometry updates redraw the waypoint without issuing camera or progress requests.
    await page.evaluate(() => { window.__restProps.mapFeatures = structuredClone(window.__initialRestFixture.features); });
    await tick(page);
    assert.deepEqual(await snapshot(page), before);
    await button(page).click(); await tick(page);
    let after = await snapshot(page);
    assert.equal(after.events, before.events); assert.equal(after.current, before.current);
    assert.equal(after.cameras, before.cameras + (mode === 'sdk' ? 1 : 0));
    if (mode === 'sdk') assert.deepEqual(await page.evaluate(() => window.__restAudit.cameras.at(-1).point), points[1]);
    await click(page, '文字导航'); await expect(marker(page)).toHaveCount(0);
    await button(page).click(); await expect(marker(page)).toHaveCount(1);
    assert.equal((await snapshot(page)).events, before.events);
    await page.addStyleTag({ content: 'html { font-size:24px; }' });
    await layout(page);
    if (saveArtifacts) {
      await page.screenshot({ path: `${output}/${mode}-320px-150pct.png`, fullPage: true });
      await page.locator('#optional-navigation-map').screenshot({ path: `${output}/${mode}-map.png` });
    }
    await click(page, '累了，休息一下'); await expect(marker(page)).toHaveCount(0); await expect(button(page)).toHaveCount(0);
    await click(page, '继续前行'); await expect(marker(page)).toHaveCount(1);
    await click(page, '已走完这段'); await expect(marker(page)).toHaveAttribute('aria-label', /合成第二休息点/);
    await click(page, '已走完这段'); await expect(marker(page)).toHaveCount(0); await expect(button(page)).toHaveCount(0);
    await click(page, '上一段'); await expect(marker(page)).toHaveAttribute('aria-label', /合成第二休息点/);
    await click(page, '上一段');
    // Unsupported and ambiguous adjacent geometry retains the validated text hint.
    for (const evidence of ['missing', 'duplicate', 'near', 'both', '3d', 'mixed']) {
      await page.evaluate(evidence => {
        const f = structuredClone(window.__initialRestFixture.features);
        if (evidence === 'missing') f[1].geometry = null;
        if (evidence === 'duplicate') f.push({ ...f[0], geometry: null });
        if (evidence === 'near') f[1].geometry.coordinates[0][0] += 1e-10;
        if (evidence === 'both') f[1].geometry.coordinates = [...f[0].geometry.coordinates].reverse();
        if (evidence === '3d') f[1].geometry.coordinates[0].push(0);
        if (evidence === 'mixed') f.push({ properties: { kind: 'segment', segment_code: 'unrelated' }, geometry: null });
        window.__restProps.mapFeatures = f;
      }, evidence);
      await expect(marker(page)).toHaveCount(evidence === 'mixed' ? 1 : 0);
      await expect(button(page)).toHaveCount(evidence === 'mixed' ? 1 : 0);
      await expect(page.getByTestId('navigation-rest-message')).toContainText('合成第一休息点');
    }
    await page.evaluate(() => { window.__restProps.mapFeatures = structuredClone(window.__initialRestFixture.features); });
    await expect(marker(page)).toHaveCount(1);
    await page.evaluate(() => { window.__restProps.selectedRoute = { ...structuredClone(window.__initialRestFixture.route), navigation_rest: null }; });
    await expect(marker(page)).toHaveCount(0); await expect(button(page)).toHaveCount(0);
    await page.evaluate(() => { window.__restProps.selectedRoute = structuredClone(window.__initialRestFixture.route); });
    await expect(marker(page)).toHaveCount(1);
    await page.evaluate(() => { window.__restProps.guidancePaused = true; });
    await expect(marker(page)).toHaveCount(0); await expect(button(page)).toHaveCount(0);
    await page.evaluate(() => { window.__restProps.selectedRoute = structuredClone(window.__initialRestFixture.route); });
    await expect(marker(page)).toHaveCount(0);
    await page.evaluate(() => { window.__restProps.guidancePaused = false; });
    await expect(marker(page)).toHaveCount(1);
    await click(page, '结束导航'); await expect(marker(page)).toHaveCount(0);
    await click(page, '继续导航'); await expect(marker(page)).toHaveCount(1);
    await checkWalkingPlan(page, mode);
    await click(page, '查看路线方案'); await expect(marker(page)).toHaveCount(0); await expect(button(page)).toHaveCount(0);
    after = await snapshot(page);
    assert.equal(after.watches, 0); assert.equal(after.spoken, 0);
    for (const key of ['external', 'api', 'errors', 'sockets']) assert.deepEqual(audit[key], [], `${mode}: ${key}`);
    await context.close(); contexts.delete(context);
  }
  if (saveArtifacts) await writeFile(`${output}/audit.json`, JSON.stringify({ passed: true, audits }, null, 2));
  console.log('PASS rest waypoint: SDK/SVG, explicit camera only, manual progress and pause cleanup, ordinary maps unchanged, 320px/150%, zero network API/GPS/WebSocket/speech.');
} catch (error) {
  console.error('Rest waypoint browser audit:', JSON.stringify(audits));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await server.close();
}
