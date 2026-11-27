import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// The existing synthetic navigation fixture, served only on an ephemeral local
// port. No SDK, backend, account, real GPS, environment changes or saved files.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = '/__navigation_manual_recovery';
const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [vue(), { name: 'navigation-manual-recovery-fixture', configureServer(vite) {
    vite.middlewares.use(fixturePath, (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/scripts/fixtures/navigation-map-fixture.js"></script></body></html>');
    });
  } }], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
let browser, base;
const contexts = new Set(), audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const trigger = page => page.getByTestId('navigation-manual-recovery-trigger');
const card = page => page.getByTestId('navigation-recovery');
const closeButton = page => page.getByTestId('navigation-manual-recovery-close');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

function installMocks() {
  const audit = window.__manualRecoveryAudit = { watches: 0, clears: 0, captures: 0,
    spoken: [], cancels: 0, cameras: [], mapChanges: [], maps: [] };
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition() { audit.captures++; },
    watchPosition(success, error) { audit.gps = success; audit.gpsError = error; return ++audit.watches; },
    clearWatch() { audit.clears++; },
  } });
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    cancel() { audit.cancels++; },
    getVoices: () => [{ lang: 'zh-CN', localService: true, name: '合成本地中文' }],
    speak(utterance) { audit.spoken.push(utterance.text); },
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  class Overlay {
    constructor(options = {}) { this.options = options; this.handlers = {}; }
    setOptions(value) { Object.assign(this.options, value); audit.mapChanges.push('options'); }
    on(name, callback) { this.handlers[name] = callback; }
    setPosition(value) { this.options.position = value; audit.mapChanges.push('position'); }
    setCenter(value) { this.options.center = value; audit.mapChanges.push('center'); }
    setRadius(value) { this.options.radius = value; audit.mapChanges.push('radius'); }
  }
  class Map {
    constructor() { audit.maps.push(this); }
    setLimitBounds() {} addControl() {} resize() {}
    add() { audit.mapChanges.push('add'); }
    remove() { audit.mapChanges.push('remove'); }
    setFitView(overlays) { audit.cameras.push({ kind: 'fit', codes: overlays.map(item => item.options.extData?.segmentCode).filter(Boolean) }); }
    setZoomAndCenter(zoom, point) { audit.cameras.push({ kind: 'position', zoom, point: [...point] }); }
    destroy() { audit.mapChanges.push('destroy'); }
  }
  window.__manualRecoverySdk = { Map, Polyline: Overlay, Polygon: Overlay, Marker: Overlay,
    Circle: Overlay, Bounds: Overlay, Scale: Overlay, ToolBar: Overlay };
}

async function seed(page) {
  await page.evaluate(() => {
    const f = window.__navFixture;
    f.state.textMemoRouteVerified = true;
    f.state.progress = { index: 0, paused: false };
    // Selection deliberately differs from the visible manual step.
    f.state.selectedSegmentCode = 'c';
    f.state.selectedProfile = { label: '合成老人' };
    f.state.memoScope = 0;
    f.state.obstructionState = { options: [{ route: f.state.selectedRoute, manualIndex: 0,
      index: 0, segment_code: 'a', name: '合成测试段甲', kind: 'current' }], reason: '' };
  });
  await tick(page);
}

async function setup(provider) {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 },
    serviceWorkers: 'block', acceptDownloads: false });
  contexts.add(context); context.setDefaultTimeout(8000);
  const audit = { provider, requests: [], external: [], api: [], rejected: [], errors: [] };
  audits.push(audit);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url()); audit.requests.push(url.href);
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname.startsWith('/api/')) { audit.api.push(url.href); return route.abort('blockedbyclient'); }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return route.fulfill({
      contentType: 'application/javascript', body: 'export const loadAmap=()=>Promise.resolve(window.__manualRecoverySdk);' });
    if (request.method() === 'GET' && (url.pathname === fixturePath
        || /^\/(?:scripts\/fixtures|src|node_modules|@vite|@id|@fs)\//.test(url.pathname))) return route.continue();
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(installMocks);
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message));
  await page.goto(`${base}${fixturePath}${provider === 'fallback' ? '?fallback' : ''}`);
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
  await seed(page);
  return { page, audit, context };
}

async function restore(page, provider) {
  await page.reload();
  await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
  await seed(page); await expect(card(page)).toHaveCount(0);
}

async function snapshot(page, audit, includeMap = true) {
  await tick(page);
  const client = await page.evaluate(includeMap => {
    const a = window.__manualRecoveryAudit, f = window.__navFixture;
    return JSON.parse(JSON.stringify({ state: f.state, events: f.events,
      watches: a.watches, clears: a.clears, captures: a.captures, spoken: a.spoken, cancels: a.cancels,
      counter: document.querySelector('.journey-counter')?.textContent,
      instruction: document.querySelector('#current-segment-title')?.textContent,
      remaining: document.querySelector('[data-testid="manual-remaining"]')?.textContent,
      location: document.querySelector('.journey-panel > .journey-location')?.textContent,
      voice: document.querySelector('.journey-tools button')?.getAttribute('aria-pressed'),
      ...(includeMap ? { cameras: a.cameras, mapChanges: a.mapChanges, maps: a.maps.length,
        following: document.querySelector('[data-testid="map-follow-state"]')?.textContent,
        map: Boolean(document.querySelector('#optional-navigation-map')) } : {}) }));
  }, includeMap);
  return { client, requests: [...audit.requests] };
}

async function unchanged(page, audit, before, label, includeMap = true) {
  assert.deepEqual(await snapshot(page, audit, includeMap), before, label);
}

async function open(page, index = 1, name = '合成测试段甲') {
  await expect(trigger(page)).toBeEnabled();
  await expect(trigger(page)).toHaveText('我不确定走到哪');
  await expect(trigger(page)).toHaveAttribute('aria-controls', 'navigation-recovery');
  await trigger(page).focus(); await page.keyboard.press('Enter');
  await expect(card(page)).toHaveCount(1); await expect(card(page)).toBeVisible();
  await expect(card(page)).toHaveAttribute('id', 'navigation-recovery');
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(card(page)).toContainText(`手动进度仍在第 ${index} 段：${name}`);
  await expect(card(page)).toContainText('不能确定您实际站在哪里');
  await expect(closeButton(page)).toHaveText('关闭核对');
  assert.doesNotMatch(await card(page).innerText(), /您现在位于|您已到达|请.{0,6}(?:左转|右转|掉头)|距离.{0,6}米后/);
}

async function closed(page, automatic = false) {
  await expect(card(page)).toHaveCount(automatic ? 1 : 0);
  if (await trigger(page).count()) await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(closeButton(page)).toHaveCount(0);
}

async function blocked(page) {
  await closed(page);
  if (await trigger(page).count()) await expect(trigger(page)).toBeDisabled();
}

async function fix(page, coords = {}) {
  await page.evaluate(coords => {
    const a = window.__manualRecoveryAudit;
    const timestamp = Math.max(Date.now(), (a.lastFix || 0) + 1); a.lastFix = timestamp;
    a.gps({ coords: { longitude: 10.0005, latitude: 10.0005, accuracy: 10, ...coords }, timestamp });
  }, coords);
  await tick(page);
}

async function layout(page, provider, percent) {
  await page.evaluate(percent => { document.documentElement.style.fontSize = `${percent}%`; }, percent);
  await tick(page);
  const overflow = await card(page).evaluate(node => [node, ...node.querySelectorAll('*')].filter(item => {
    const box = item.getBoundingClientRect();
    return box.left < -1 || box.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1;
  }).map(item => item.tagName + ':' + item.textContent));
  assert.deepEqual(overflow, [], `${provider}: recovery fits 320px at ${percent}% text`);
  for (const target of [trigger(page), ...await card(page).getByRole('button').all()]) {
    const box = await target.boundingBox();
    assert.ok(box?.width >= 48 && box?.height >= 48, `${provider}/${percent}%: every recovery control has a 48px target`);
  }
}

try {
  await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const provider of ['amap-mock', 'fallback']) {
    const { page, audit, context } = await setup(provider);
    await closed(page);
    const initial = await snapshot(page, audit);
    assert.equal(initial.client.watches, 0, 'manual recovery requires no GPS permission');
    await open(page);
    await unchanged(page, audit, initial, 'opening without GPS changes no camera, navigation, service or requests');
    await closeButton(page).click(); await closed(page); await expect(trigger(page)).toBeFocused();
    await unchanged(page, audit, initial, 'close returns focus without navigation or service changes');
    await open(page); await page.keyboard.press('Escape'); await closed(page); await expect(trigger(page)).toBeFocused();
    await unchanged(page, audit, initial, 'Escape returns focus without navigation or service changes');

    await open(page);
    for (const percent of [100, 150]) await layout(page, provider, percent);
    await closeButton(page).click(); await closed(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });

    // Existing map/text recovery controls work without silently selecting a road.
    await open(page);
    const actionState = await snapshot(page, audit, false);
    await button(page, '按本段文字继续').click();
    await expect(page.locator('#optional-navigation-map')).toHaveCount(0);
    await unchanged(page, audit, actionState, 'manual text action preserves step, selected road, GPS, speech and requests', false);
    await button(page, '查看本段登记地图').click();
    await page.locator(provider === 'fallback' ? '.campus-map' : '.amap-route-map').waitFor();
    if (provider === 'amap-mock') assert.deepEqual(await page.evaluate(() => window.__manualRecoveryAudit.cameras.at(-1).codes), ['a']);
    else await expect(page.locator('.navigation-schematic-labels')).toContainText('当前 第1段');
    await unchanged(page, audit, actionState, 'manual map action preserves step, selected road, GPS, speech and requests', false);
    await closeButton(page).click(); await closed(page);

    // Waiting and healthy GPS are both ordinary eligible navigation states.
    await button(page, '开启我的位置').click(); await closed(page);
    await expect(page.locator('.journey-panel > .journey-location')).toContainText('正在获取位置');
    const waiting = await snapshot(page, audit);
    await open(page); await unchanged(page, audit, waiting, 'waiting GPS opening is read-only');
    await closeButton(page).click(); await closed(page);
    await fix(page); await expect(page.getByTestId('map-follow-state')).toContainText('正在跟随');
    await button(page, '开启语音提示').click();
    const healthy = await snapshot(page, audit);
    await open(page); await unchanged(page, audit, healthy, 'healthy follow opening neither moves camera nor speaks');
    await page.keyboard.press('Escape'); await closed(page); await expect(trigger(page)).toBeFocused();
    await unchanged(page, audit, healthy, 'healthy follow Escape preserves follow, voice and GPS');

    // A manual disclosure and automatic GPS issue share one card; manual close
    // cannot dismiss evidence from the still-active automatic issue.
    await fix(page, { accuracy: 80 });
    await expect(card(page)).toContainText('定位精度较低'); await closed(page, true);
    const automatic = await snapshot(page, audit);
    await open(page); await expect(card(page)).toHaveCount(1); await expect(card(page)).toContainText('定位精度较低');
    await unchanged(page, audit, automatic, 'opening automatic issue adds no services or navigation changes');
    await closeButton(page).click(); await closed(page, true); await expect(trigger(page)).toBeFocused();
    await expect(card(page)).toContainText('定位精度较低');
    await page.keyboard.press('Escape'); await closed(page, true);
    await unchanged(page, audit, automatic, 'closing manual disclosure leaves automatic issue and navigation intact');
    await fix(page); await closed(page);
    await open(page); await fix(page, { accuracy: 80 });
    await expect(card(page)).toHaveCount(1); await closeButton(page).click(); await closed(page, true);
    await fix(page); await closed(page);

    const resets = [
      ['route replacement', () => page.evaluate(() => { const f = window.__navFixture; f.state.selectedRoute = { ...f.state.selectedRoute }; })],
      ['profile replacement', () => page.evaluate(() => { window.__navFixture.state.selectedProfile = { label: '合成新档案' }; })],
      ['memo scope', () => page.evaluate(() => { window.__navFixture.state.memoScope++; })],
      ['pilot scope', () => page.evaluate(() => { const f = window.__navFixture; f.state.pilotArea = { ...f.state.pilotArea }; })],
      ['manual advance', async () => {
        await button(page, '已走完这段').click();
        await page.evaluate(() => { const f = window.__navFixture; f.state.progress = [...f.events].reverse().find(event => event.progress).progress; });
      }],
    ];
    for (const [label, action] of resets) {
      await restore(page, provider); await open(page); await action(); await tick(page); await closed(page);
      await expect(trigger(page)).toBeEnabled();
      if (label === 'manual advance') {
        await open(page, 2, '合成测试段乙'); await page.keyboard.press('Escape'); await closed(page);
      }
    }
    const forbidden = [
      ['rest', () => button(page, '累了，休息一下').click()],
      ['guidance pause', () => page.evaluate(() => { window.__navFixture.state.guidancePaused = true; })],
      ['detour', () => page.evaluate(() => { window.__navFixture.state.detourActive = true; })],
      ['obstruction', () => button(page, '前方走不了').click()],
      ['finish confirmation', () => button(page, '结束导航').click()],
      ['invalid manual index', () => page.evaluate(() => { window.__navFixture.state.progress.index = 99; })],
      ['ordinary route proof loss', () => page.evaluate(() => { window.__navFixture.state.textMemoRouteVerified = false; })],
      ['GPS start route', () => page.evaluate(() => { window.__navFixture.state.selectedRoute.start_context = { source: 'synthetic-gps' }; })],
    ];
    for (const [label, action] of forbidden) {
      await restore(page, provider); await open(page); await action(); await tick(page); await blocked(page);
      const before = await snapshot(page, audit);
      if (await trigger(page).count()) await trigger(page).evaluate(node => node.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await blocked(page); await unchanged(page, audit, before, `${label}: blocked handler has no effects`);
    }
    await restore(page, provider); await open(page); await button(page, '累了，休息一下').click(); await blocked(page);
    await button(page, '继续前行').click(); await closed(page); await expect(trigger(page)).toBeEnabled();
    await open(page); await button(page, '结束导航').click(); await blocked(page);
    await button(page, '继续导航').click(); await closed(page); await expect(trigger(page)).toBeEnabled();
    await open(page); await button(page, '结束导航').click(); await button(page, '结束但未确认到达').click(); await blocked(page);
    await restore(page, provider); await open(page);
    await page.evaluate(() => document.querySelector('#app').__vue_app__.unmount()); await closed(page);
    assert.equal(await page.locator('#app').innerHTML(), '');

    assert.deepEqual(audit.api, [], `${provider}: no API requests`);
    assert.deepEqual(audit.external, [], `${provider}: no external requests`);
    assert.deepEqual(audit.rejected, [], `${provider}: no unexpected requests`);
    assert.deepEqual(audit.errors, [], `${provider}: no page errors`);
    await context.close(); contexts.delete(context);
  }
  console.log('PASS navigation manual recovery: real NavigationPage, existing synthetic fixture, mock AMap and fallback; no-GPS/waiting/healthy disclosure; one shared automatic/manual card; close/Escape focus return; registered current map/text; no camera/GPS/speech/progress/selection/follow/network effects on disclosure; route/profile/scope/step/pause/obstruction/finish/unmount clearing; blocked rest/detour/invalid step; 320px at 150% text and 48px controls. Local server only; no saved artifacts.');
} catch (error) {
  console.error('Navigation manual-recovery audit:', JSON.stringify(audits.map(({ requests, ...audit }) => ({ ...audit, requestCount: requests.length }))));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
