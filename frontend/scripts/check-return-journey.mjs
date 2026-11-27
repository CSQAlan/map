import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Self-contained mock app: no backend, account, key, GPS or external network.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../../artifacts/return-journey/', import.meta.url));
const saveArtifacts = !process.argv.includes('--no-artifacts');
const server = await createServer({ root, configFile: false, envDir: false, plugins: [vue()],
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
if (saveArtifacts) await mkdir(output, { recursive: true });
const checks = [];
const makeRoute = code => ({ rank: 1, distance_m: code === 'RETURN_ONLY' ? 270 : 120,
  estimated_minutes: 5, summary: `本地模拟路线 ${code}`, segment_codes: [code],
  segments: [{ segment_code: code, name: `模拟路段 ${code}`, length_m: 120,
    width_m: 2, slope_percent: 0, step_count: 0, wheelchair_accessible: true,
    geometry_coordinates: [[106.3, 29.6], [106.301, 29.6]] }] });

async function setup(role = 'guest') {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__returnAudit = { gps: 0, speech: 0 };
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition() { window.__returnAudit.gps++; },
      watchPosition() { window.__returnAudit.gps++; return 1; }, clearWatch() {},
    } });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [], speak() { window.__returnAudit.speech++; }, cancel() {},
    } });
  });
  const page = await context.newPage();
  const requests = [], errors = [], external = [];
  let delayedResponse = null, release = null;
  await context.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams),
        method: request.request().method(), body: request.request().postDataJSON() });
      if (url.pathname.endsWith('/pois')) return request.fulfill({ json: ['A', 'B', 'C'].map(name => ({ name })) });
      if (url.pathname.includes('/pilot-areas/')) return request.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/geojson')) return request.fulfill({ json: { features: [] } });
      if (url.pathname.endsWith('/recommend')) {
        if (delayedResponse) {
          const wait = delayedResponse; delayedResponse = null;
          await wait;
        }
        const code = url.searchParams.has('exclude_segment_code') ? 'DETOUR'
          : url.searchParams.get('start_name') === 'B' ? 'RETURN_ONLY' : 'OUT';
        return request.fulfill({ json: { ...Object.fromEntries(url.searchParams), routes: [makeRoute(code)],
          excluded_segment_code: url.searchParams.get('exclude_segment_code'), avoided_segments: [] } });
      }
      return request.fulfill({ json: url.pathname.endsWith('/sites') ? [] : {} });
    }
    if (url.origin !== base) { external.push(url.href); return request.abort(); }
    if (url.pathname === '/src/services/amapLoader.js') return request.fulfill({ contentType: 'application/javascript',
      body: 'export async function loadAmap(){throw new Error("Local mock map only");}' });
    return request.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/#/elder/home`);
  await expect(page.getByLabel('选择出发地点', { exact: true }).locator('option[value="A"]')).toHaveCount(1);
  await page.evaluate(async role => {
    const auth = (await import('/src/composables/useAuthSession.js')).useAuthSession();
    auth.enterGuestMode();
    if (role === 'elder') {
      auth.isGuest.value = false;
      auth.currentUser.value = { id: 'local-mock-elder', role: 'elder', profileComplete: true };
    }
  }, role);
  const plan = async () => {
    await page.getByLabel('选择出发地点', { exact: true }).selectOption('A');
    await page.getByLabel('选择目的地', { exact: true }).selectOption('B');
    await page.getByRole('button', { name: '查询适合的路线', exact: true }).click();
    await expect(page.getByRole('heading', { name: '请选择适合您的路线' })).toBeVisible();
  };
  const start = () => page.getByRole('button', { name: '开始导航', exact: true }).click();
  const finish = async () => {
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    await expect(page.getByTestId('return-journey')).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: /^(结束但未确认到达|确认结束导航)$/ }).click();
    await expect(page.getByRole('heading', { name: '请选择适合您的路线' })).toBeVisible();
  };
  const close = async label => {
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.deepEqual(await page.evaluate(() => window.__returnAudit), { gps: 0, speech: 0 });
    checks.push(label); await context.close();
  };
  return { page, requests, plan, start, finish, close,
    delayNext() { delayedResponse = new Promise(resolve => { release = resolve; }); },
    release() { release(); } };
}
const routeRequests = requests => requests.filter(r => r.path.endsWith('/recommend'));
const writes = requests => requests.filter(r => r.method !== 'GET');

try {
  for (const role of ['guest', 'elder']) {
    const app = await setup(role), { page, requests } = app;
    await app.plan();
    await expect(page.getByTestId('return-journey')).toHaveCount(0);
    await app.start();
    await app.finish();
    const card = page.getByTestId('return-journey');
    await expect(card).toContainText('拟定起点：B');
    await expect(card).toContainText('拟定目的地：A');
    await expect(card).toContainText('请确认您确实位于所选起点');
    assert.equal(routeRequests(requests).length, 1, 'ending does not plan');
    if (role === 'elder') {
      await expect.poll(() => writes(requests).some(r => r.body?.status === 'COMPLETED')).toBe(true);
      const completed = writes(requests).filter(r => r.body?.status === 'COMPLETED');
      assert.equal(completed.length, 1, 'existing completion sync retained exactly once');
      assert.match(completed[0].body.current_step, /是否到达请本人确认/);
    } else assert.equal(writes(requests).length, 0);
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    assert.ok(dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
    if (saveArtifacts) await page.screenshot({ path: `${output}/${role}-320.png`, fullPage: true });
    const beforeWrites = writes(requests).length;
    await card.getByRole('button', { name: '填入返程地点' }).click();
    await expect(page.getByLabel('选择出发地点', { exact: true })).toHaveValue('B');
    await expect(page.getByLabel('选择目的地', { exact: true })).toHaveValue('A');
    assert.equal(routeRequests(requests).length, 1, 'prefill does not plan');
    assert.equal(writes(requests).length, beforeWrites, 'prefill sends no status/SOS');
    await page.getByRole('button', { name: '查询适合的路线', exact: true }).click();
    await expect(page.getByRole('button', { name: '开始导航', exact: true })).toBeVisible();
    const query = routeRequests(requests).at(-1).params;
    assert.equal(routeRequests(requests).length, 2);
    assert.equal(query.start_name, 'B'); assert.equal(query.end_name, 'A');
    assert.equal('start_longitude' in query, false);
    assert.equal(query.mobility_type, routeRequests(requests)[0].params.mobility_type);
    assert.equal(query.strategy, routeRequests(requests)[0].params.strategy);
    await expect(page.locator('.route-candidates-panel')).toContainText('RETURN_ONLY');
    await expect(page.getByTestId('return-journey')).toHaveCount(0);
    assert.equal(writes(requests).length, beforeWrites, 'query shows a result without starting/sending status');
    await app.close(`${role}: explicit A→B start/end, inert B→A prefill, fresh explicit return query; 320px at 150%`);
  }

  for (const kind of ['never-started', 'missing-name', 'identical-names', 'invalid-name', 'context', 'destination', 'profile', 'session', 'unregistered', 'current-origin', 'detour', 'new-navigation', 'reload']) {
    const app = await setup(), { page } = app;
    await app.plan();
    if (kind === 'never-started') {
      await page.evaluate(() => { location.hash = '/elder/navigation'; });
    } else if (kind === 'current-origin') {
      // Model a coordinate-origin route whose start label happens to be registered.
      await page.evaluate(async () => {
        const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
        planner.startContext.value = { label: 'A', source: 'coordinate-mock' };
      });
      await app.start();
    } else if (kind === 'detour') {
      await page.evaluate(async route => {
        const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
        const ok = planner.detour.activate({ code: 'OUT', name: '模拟排除路段', createdAt: Date.now(), route,
          navigationContext: { startName: 'A', endName: 'B', mobilityType: planner.mobilityType.value,
            strategy: planner.routeStrategy.value, scope: 'guest:guest:true' } });
        if (!ok) throw new Error('Mock detour activation failed');
      }, makeRoute('DETOUR'));
      await page.getByRole('region', { name: '本次绕行行程' }).getByRole('button', { name: '开始绕行导航', exact: true }).click();
    } else await app.start();
    if (['missing-name', 'identical-names', 'invalid-name'].includes(kind)) {
      await page.evaluate(async kind => {
        const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
        planner.endName.value = kind === 'missing-name' ? '' : kind === 'identical-names' ? 'A' : 'unregistered';
      }, kind);
    }
    await app.finish();
    if (['never-started', 'missing-name', 'identical-names', 'invalid-name', 'current-origin', 'detour'].includes(kind)) {
      await expect(page.getByTestId('return-journey')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('return-journey')).toBeVisible();
      if (kind === 'context') {
        await page.evaluate(() => { location.hash = '/elder/home'; });
        await expect(page.getByRole('button', { name: '查询适合的路线' })).toBeVisible();
        await page.evaluate(() => { location.hash = '/elder/routes'; });
      } else if (kind === 'new-navigation') {
        await app.start();
        await page.getByRole('button', { name: '查看路线方案', exact: true }).click();
      } else if (kind === 'reload') await page.reload();
      else await page.evaluate(async kind => {
        const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
        if (kind === 'destination') { planner.endName.value = 'C'; planner.endName.value = 'B'; }
        if (kind === 'profile') { planner.mobilityType.value = 'CANE'; }
        if (kind === 'session') {
          const auth = (await import('/src/composables/useAuthSession.js')).useAuthSession();
          auth.clearCurrentUser(); auth.enterGuestMode();
        }
        if (kind === 'unregistered') {
          const map = (await import('/src/composables/useMapData.js')).useMapData();
          const previous = map.startOptions.value;
          map.startOptions.value = previous.filter(option => option.value !== 'B');
          map.startOptions.value = previous;
        }
      }, kind);
      await expect(page.getByTestId('return-journey')).toHaveCount(0);
    }
    await app.close(`hidden after ${kind}`);
  }

  // Pending old-context results must not restore the return card or its draft.
  const app = await setup(), { page } = app;
  await app.plan(); await app.start(); await app.finish();
  await page.getByRole('button', { name: '填入返程地点' }).click();
  app.delayNext();
  await page.getByRole('button', { name: '查询适合的路线', exact: true }).click();
  await expect.poll(() => routeRequests(app.requests).length).toBe(2);
  await page.getByLabel('选择目的地', { exact: true }).selectOption('C');
  app.release();
  await expect.poll(() => page.evaluate(async () => {
    const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
    return [planner.startName.value, planner.endName.value, planner.selectedRoute.value];
  })).toEqual(['B', 'C', null]);
  await expect(page.getByTestId('return-journey')).toHaveCount(0);
  await app.close('stale response cannot change the edited draft or open results');
  if (saveArtifacts) await writeFile(`${output}/checks.json`, JSON.stringify({ checks, externalCalls: 0, realAccounts: false }, null, 2));
  console.log(`PASS ${checks.length} local mock browser scenarios; no external calls, automatic GPS or speech.`);
} finally { await browser.close(); await server.close(); }
