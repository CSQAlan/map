import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.UI_OUTPUT_DIR || 'artifacts/survey-browser';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
const errors = [];
const checks = [];
const photo = index => ({ photo_id: `photo-${index}`, caption: `道路现场照片 ${index}`, kind: 'scene', thumbnail_url: `/media/survey/thumb-${index}.svg`, display_url: `/media/survey/display-${index}.svg` });
const features = [
  { type: 'Feature', geometry: { type: 'Point', coordinates: [106.31, 29.60] }, properties: { record_code: 'located', title: '入口坡道', site_code: 'one', site_name: '校园入口', location_source: 'EXIF', issue_tags: ['坡道'], notes: [], evidence_photos: [photo(1), photo(2)] } },
  { type: 'Feature', geometry: null, properties: { record_code: 'unlocated', title: '林间台阶', site_code: 'two', site_name: '林间步道', issue_tags: ['台阶'], notes: [], evidence_photos: [photo(3)] } },
];

async function fixtures(page, state) {
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__mapMode = 'reject'; window.__maps = []; window.__mapResolvers = [];
    class Overlay {
      constructor(options) { this.options = options; }
      on(name, handler) { this[name] = handler; }
    }
    class Map {
      constructor(element) { if (!(element instanceof HTMLElement)) throw Error('No live map container'); this.element = element; this.events = {}; this.destroyed = false; window.__maps.push(this); }
      on(name, handler) { this.events[name] = handler; if (name === 'complete') setTimeout(() => { if (!this.destroyed) handler(); }, 30); }
      addControl() {} add() {} remove() {} setFitView() {} panTo() {} setCenter() {} setZoomAndCenter() {}
      destroy() { this.destroyed = true; }
    }
    window.__surveySdk = { Map, Marker: Overlay, ToolBar: Overlay, Scale: Overlay };
  });
  // Deterministic SDK fault injection requires the Vite development endpoint.
  await page.route('**/src/services/amapLoader.js*', route => route.fulfill({ contentType: 'application/javascript', body: `export function loadAmap() { if (window.__mapMode === 'reject') return Promise.reject(new Error('SDK fixture offline')); if (window.__mapMode === 'defer') return new Promise(resolve => window.__mapResolvers.push(resolve)); return Promise.resolve(window.__surveySdk); }` }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/survey-records') && state.offline) return route.abort('connectionfailed');
    const data = url.pathname.endsWith('/survey-records/sites')
      ? [{ site_code: 'one', name: '校园入口', record_count: 1 }, { site_code: 'two', name: '林间步道', record_count: 1 }]
      : url.pathname.endsWith('/survey-records') ? { features: features.filter(feature => !url.searchParams.get('site_code') || feature.properties.site_code === url.searchParams.get('site_code')) }
        : url.pathname.endsWith('/pois') ? [] : { features: [], suggestions: [] };
    await route.fulfill({ json: data });
  });
  await page.route('**/media/survey/**', async route => {
    if (state.photosFail) return route.fulfill({ status: 404, body: '' });
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#dce9df"/><path d="M70 400 280 80 380 80 550 400" fill="#8ca99a"/></svg>' });
  });
}

try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const state = { offline: true, photosFail: false };
    await fixtures(page, state);
    await page.goto(`${base}/#/elder/survey`);
    await expect(page.getByRole('heading', { name: '踩点资料', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('连接资料服务');
    assert.doesNotMatch(await page.locator('body').innerText(), /Failed to fetch/);
    state.offline = false;
    await page.getByRole('button', { name: '重新加载资料', exact: true }).click();
    await expect(page.locator('.survey-library-record')).toHaveCount(2);
    await expect(page.getByLabel('按踩点地点筛选')).toContainText('全部 2 个地点');
    await expect(page.locator('#survey-detail-title')).toHaveText('入口坡道');
    if (width < 1024) await page.locator('.survey-library-map summary').click();
    await expect(page.getByRole('button', { name: '重新加载地图', exact: true })).toBeVisible();
    await page.evaluate(() => { window.__mapMode = 'ready'; });
    await page.getByRole('button', { name: '重新加载地图', exact: true }).click();
    await expect(page.locator('.survey-map-legend')).toBeVisible();
    await page.getByRole('button', { name: '查看大图：道路现场照片 1', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '踩点照片大图' })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.survey-viewer-image img')).toHaveAttribute('alt', '道路现场照片 2');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: '查看大图：道路现场照片 1', exact: true })).toBeFocused();
    await page.getByLabel('按踩点地点筛选').selectOption('two');
    await expect(page.locator('.survey-library-record')).toHaveCount(1);
    await expect(page.locator('#survey-detail-title')).toHaveText('林间台阶');
    await expect.poll(() => page.locator('.survey-photo-open img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    state.photosFail = true;
    await page.getByRole('button', { name: '查看大图：道路现场照片 3', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试大图', exact: true })).toBeVisible();
    state.photosFail = false;
    await page.getByRole('button', { name: '重试大图', exact: true }).click();
    await expect(page.locator('.survey-viewer-image img')).toBeVisible();
    await expect.poll(() => page.locator('.survey-viewer-image img').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.keyboard.press('Escape');
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, `${width}px overflow: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: `${output}/survey-${width}.png`, fullPage: true });
    checks.push({ width, ...dimensions, recovery: true, filtering: true, photoDialog: true });
    await context.close();
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const state = { offline: false, photosFail: true };
  await fixtures(page, state);
  await page.goto(`${base}/#/elder/survey`);
  await expect(page.getByRole('button', { name: '重试照片', exact: true }).first()).toBeVisible();
  state.photosFail = false;
  await page.getByRole('button', { name: '重试照片', exact: true }).first().click();
  await expect(page.locator('.survey-photo-open').first()).toBeVisible();
  await page.evaluate(() => { window.__mapMode = 'defer'; });
  await page.clock.install();
  await page.locator('.survey-library-map summary').click();
  await page.waitForFunction(() => window.__mapResolvers.length === 1);
  await page.clock.fastForward(12100);
  await expect(page.locator('.survey-map-recovery')).toContainText('超时');
  await expect(page.getByRole('button', { name: '刷新页面重试地图', exact: true })).toBeVisible();
  await page.evaluate(() => { window.__mapResolvers.forEach(resolve => resolve(window.__surveySdk)); });
  assert.equal(await page.evaluate(() => window.__maps.length), 0, 'Timed-out SDK must not create a map');
  await page.getByRole('button', { name: '刷新页面重试地图', exact: true }).click();
  await expect(page.locator('.survey-library-record')).toHaveCount(2);
  await page.evaluate(() => { window.__mapMode = 'ready'; });
  await page.locator('.survey-library-map summary').click();
  await page.clock.fastForward(100);
  await expect(page.locator('.survey-map-legend')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__maps.length), 1);
  await page.locator('.survey-library-map summary').click();
  await expect.poll(() => page.evaluate(() => window.__maps.every(map => map.destroyed))).toBe(true);
  await page.evaluate(() => { window.__mapMode = 'defer'; });
  await page.locator('.survey-library-map summary').click();
  await page.waitForFunction(() => window.__mapResolvers.length === 1);
  await page.evaluate(() => { location.hash = '/elder/home'; });
  await expect(page.locator('.survey-library')).toHaveCount(0);
  await page.evaluate(() => { window.__mapResolvers.forEach(resolve => resolve(window.__surveySdk)); });
  await page.evaluate(() => new Promise(resolve => queueMicrotask(resolve)));
  assert.equal(await page.evaluate(() => window.__maps.length), 1, 'Unmounted SDK must not create a map');
  await context.close();
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(`${output}/checks.json`, JSON.stringify({ fixtures: true, checks, errors, lifecycle: true }, null, 2));
  console.log(`PASS: ${checks.length} viewports, network recovery, all records browsing, map retry/deadline/disposal, image retry and keyboard/focus checks. Fixtures are mocked. Screenshots: ${output}`);
} finally { await browser.close(); }
