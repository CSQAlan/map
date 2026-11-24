import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const api = process.env.UI_API_BASE_URL || 'http://127.0.0.1:8000';
const output = 'artifacts/current-origin';
await mkdir(output, { recursive: true });
const map = await (await fetch(`${api}/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=WGS84`)).json();
const source = map.features.find(feature => feature.properties.segment_code === 'S_SY_GATE_TO_MAIN');
assert.ok(source, 'Seeded real route geometry is required');
const point = source.geometry.coordinates[0].map((value, index) => (value + source.geometry.coordinates[1][index]) / 2);
const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
const checks = [];
const errors = [];
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['geolocation'], geolocation: { longitude: point[0], latitude: point[1], accuracy: 5 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    // Real API and database; only the map SDK is stubbed to isolate location UI.
    await page.route('**/src/services/amapLoader.js*', route => route.fulfill({ contentType: 'application/javascript', body: `export function loadAmap(){return Promise.reject(new Error('UI test map disabled'));}` }));
    await page.goto(`${base}/#/elder/home`);
    await page.getByRole('button', { name: '使用当前位置', exact: true }).click();
    await expect(page.getByLabel('附近已收录道路')).toBeVisible();
    await page.getByLabel('附近已收录道路').selectOption('S_SY_GATE_TO_MAIN');
    assert.equal(await page.getByLabel('选择出发地点', { exact: true }).inputValue(), '', 'No automatic start selection before confirmation');
    await page.getByRole('button', { name: '确认我在这条道路上', exact: true }).click();
    await expect(page.getByLabel('选择出发地点', { exact: true })).toHaveValue('当前位置附近 · 入口到内部主路中心');
    await page.screenshot({ path: `${output}/confirmed-${width}.png`, fullPage: true });
    await page.getByLabel('选择目的地', { exact: true }).selectOption('师大苑荷塘水景休息区');
    const response = page.waitForResponse(response => response.url().includes('/api/routes/recommend'));
    await page.getByRole('button', { name: '查询适合的路线', exact: true }).click();
    const routeResponse = await response;
    assert.equal(routeResponse.status(), 200);
    assert.equal(new URL(routeResponse.url()).searchParams.has('start_name'), false);
    const result = await routeResponse.json();
    assert.ok(result.start_context);
    assert.ok(Math.abs(result.routes[0].distance_m - 200) < 0.2, 'Half of the 92m first road plus the 154m next road (GPS coordinate rounding tolerance)');
    await expect(page.getByRole('heading', { name: '请选择适合您的路线' })).toBeVisible();
    await expect(page.locator('.route-accessibility-facts').first()).toContainText('登记无台阶');
    await expect(page.locator('.route-accessibility-facts').first()).toContainText('未知通行路段');
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, `${width}: overflow`);
    await page.screenshot({ path: `${output}/routes-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: '开始导航', exact: true }).click();
    await page.waitForURL('**/#/elder/navigation');
    await expect(page.locator('.journey-current h2')).toHaveText('入口到内部主路中心');
    await page.evaluate(() => { location.hash = '/elder/home'; });
    await page.getByLabel('选择出发地点', { exact: true }).selectOption('师大苑大学城西路入口');
    await expect(page.getByRole('button', { name: '使用当前位置', exact: true })).toBeVisible();
    await context.setGeolocation({ longitude: 116.397, latitude: 39.908, accuracy: 5 });
    await page.getByRole('button', { name: '使用当前位置', exact: true }).click();
    await expect(page.locator('.current-origin-picker')).toContainText('尚无适老路网覆盖');
    await expect(page.getByLabel('选择出发地点', { exact: true })).toHaveValue('师大苑大学城西路入口');
    assert.equal(await page.getByLabel('附近已收录道路').count(), 0, 'No fake start outside coverage');
    checks.push({ width, realApi: true, simulatedGps: true, partialDistance: result.routes[0].distance_m, ...dimensions });
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${output}/checks.json`, JSON.stringify({ checks, errors, simulatedGps: true, realPhoneGps: false }, null, 2));
  console.log('PASS: 4 viewports, simulated GPS + real DB/API, explicit road confirmation, mid-segment planning/navigation, accessibility facts, manual fallback and outside-coverage rejection. No real-phone GPS claim.');
} finally { await browser.close(); }
