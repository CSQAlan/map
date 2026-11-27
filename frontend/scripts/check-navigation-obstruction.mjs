import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Real App guest UI, synthetic roads/location/HTTP/speech, loopback only.
// No artifact writes, backend, account fixtures, SDK download or env files.
const root = fileURLToPath(new URL('../', import.meta.url));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = root;
const server = await createServer({ root, configFile: false, envDir: false,
  plugins: [{ name: 'obstruction-local-api', enforce: 'pre', resolveId(id) {
    if (/\/config\/api(?:\.js)?$/.test(id)) return '\0obstruction-local-api';
  }, load(id) {
    if (id === '\0obstruction-local-api') return 'export const API_BASE_URL=""; export const apiConfigurationError="";';
  } }, vue()], server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const road = (code, name) => ({ segment_code: code, name, length_m: 50, step_count: 0,
  width_m: 3, slope_percent: 0, geometry_coordinates: [[10, 10], [10.001, 10]] });
const rows = [road('blocked', '合成当前路'), road('next', '合成下一路'), road('later', '合成后续路')];
const original = { distance_m: 150, rank: 1, estimated_minutes: 4, summary: '合成命名起点路线',
  segment_codes: rows.map(r => r.segment_code), segments: rows };
const entry = { segment_code: 'alternative', name: '合成替代接入路', allowed: true, distance_m: 2,
  snapped_coordinates: [10.0005, 10] };
const alternate = { distance_m: 50, rank: 1, estimated_minutes: 2, summary: '合成绕行路线',
  segment_codes: ['alternative'], segments: [{ ...road('alternative', '合成绕行路'), geometry_coordinates: [[10.0005, 10], [10.001, 10]] }] };
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__obstruction = { captures: 0, watches: 0, cleared: 0, spoken: [], canceled: 0, fixes: [], watchCallbacks: [] };
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition(success, error) { window.__obstruction.captures++; window.__obstruction.fixes.push({ success, error }); },
      watchPosition(success) { window.__obstruction.watches++; window.__obstruction.watchCallbacks.push(success); return 1; },
      clearWatch() { window.__obstruction.cleared++; },
    } });
    Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => [],
      speak(u) { window.__obstruction.spoken.push(u.text); }, cancel() { window.__obstruction.canceled++; } } });
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  });
  const requests = [], external = [], errors = [];
  let lookupMode = 'ambiguous', delayed = null;
  await context.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (url.origin !== base) { external.push(url.href); return request.abort(); }
    if (url.pathname === '/src/services/amapLoader.js') return request.fulfill({ contentType: 'application/javascript',
      body: 'export async function loadAmap(){throw new Error("Local mock fallback only");}' });
    if (!url.pathname.startsWith('/api/')) return request.continue();
    requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), method: request.request().method(),
      ...(request.request().method() === 'POST' ? { body: request.request().postDataJSON() } : {}) });
    if (url.pathname.endsWith('/pois')) return request.fulfill({ json: ['合成起点', '合成终点'].map(name => ({ name })) });
    if (url.pathname.includes('/pilot-areas/')) return request.fulfill({ status: 503, json: {} });
    if (url.pathname.endsWith('/geojson')) return request.fulfill({ json: { features: rows.map(r => ({ type: 'Feature',
      properties: { kind: 'segment', segment_code: r.segment_code, name: r.name }, geometry: { type: 'LineString', coordinates: r.geometry_coordinates } })) } });
    if (url.pathname.endsWith('/start-options')) {
      if (delayed) { const pending = delayed; delayed = null; await pending; }
      if (lookupMode === 'ambiguous') return request.fulfill({ status: 422, json: { detail: {
        code: 'AMBIGUOUS_EXCLUDED_LOCATION', message: '合成位置可能仍在排除路段，定位有歧义，请重试。' } } });
      return request.fulfill({ json: { excluded_segment_code: 'blocked', candidates: lookupMode === 'missing' ? [] : [entry] } });
    }
    if (url.pathname.endsWith('/recommend')) {
      const gps = url.searchParams.has('start_longitude');
      return request.fulfill({ json: { ...Object.fromEntries(url.searchParams),
        routes: [gps ? alternate : original], excluded_segment_code: url.searchParams.get('exclude_segment_code'),
        ...(gps ? { start_context: entry } : {}), avoided_segments: [] } });
    }
    return request.fulfill({ json: url.pathname.endsWith('/sites') ? [] : {} });
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  const click = label => page.getByRole('button', { name: label, exact: true }).click();
  const stats = () => page.evaluate(() => ({ captures: window.__obstruction.captures,
    watches: window.__obstruction.watches, spoken: window.__obstruction.spoken.length }));
  const routeRequests = () => requests.filter(r => /\/(recommend|start-options)$/.test(r.path));
  const panel = page.getByRole('region', { name: '本次绕行行程' });
  const nextStep = panel.locator('.detour-next-step');
  const fitsPanel = async () => assert.deepEqual(await panel.locator('p, button, label, select, ol, li').evaluateAll(nodes => nodes.filter(n => {
    const b = n.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
  }).map(n => n.textContent)), [], 'panel text and controls fit 320px at 150%');
  const plan = async () => {
    await page.getByLabel('选择出发地点', { exact: true }).selectOption('合成起点');
    await page.getByLabel('选择目的地', { exact: true }).selectOption('合成终点');
    await click('查询适合的路线'); await click('开始导航');
    await expect(page.locator('.journey-current h2')).toHaveText('合成当前路');
  };
  const open = () => click('前方走不了');
  const selectCurrent = () => page.getByRole('radio', { name: /当前路线步骤.*合成当前路/ }).check();
  const paused = async () => {
    await expect(page.getByRole('heading', { name: '绕行引导已暂停', exact: true })).toBeVisible();
    await expect(page.locator('#optional-navigation-map, .journey-current, .journey-progress')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '开启语音提示', exact: true })).toHaveCount(0);
  };
  const lock = async () => { await open(); await selectCurrent(); await click('绕开这段，暂停导航'); await paused(); };
  const deliverFix = () => page.evaluate(() => {
    const state = window.__obstruction, timestamp = Math.max(Date.now(), (state.lastFix || 0) + 1); state.lastFix = timestamp;
    state.fixes.at(-1).success({ coords: { longitude: 10.0005, latitude: 10, accuracy: 8 }, timestamp });
  });
  const endDialog = page.getByRole('dialog', { name: '确认结束本次行程？', exact: true });
  const keepJourney = endDialog.getByRole('button', { name: '保留行程', exact: true });
  const confirmJourney = endDialog.getByRole('button', { name: '确认结束行程', exact: true });
  const panelEnd = panel.getByRole('button', { name: '结束本次行程', exact: true });
  const pausedEnd = page.locator('.journey-paused').getByRole('button', { name: '结束本次行程', exact: true });
  const journeySnapshot = () => page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    const sensors = window.__obstruction;
    return JSON.parse(JSON.stringify({ path: location.hash, mode: state.activeMode,
      session: state.detourSession, phase: state.detourPhase, message: state.detourMessage,
      candidates: state.detourCandidates, pending: state.detourPending, route: state.selectedRoute,
      progress: state.navigationProgress, status: state.actionStatus,
      family: state.familyMonitor, sharingDenied: state.sharingDenied,
      captures: sensors.captures, watches: sensors.watches, cleared: sensors.cleared,
      spoken: sensors.spoken, canceled: sensors.canceled,
      voice: [...document.querySelectorAll('.journey-tools button')].map(button => button.textContent),
      location: document.querySelector('.journey-location')?.textContent }));
  });
  const checkEndCancellation = async trigger => {
    const unchanged = await journeySnapshot(), requestCount = requests.length;
    await trigger.click(); await expect(keepJourney).toBeFocused();
    assert.deepEqual(await journeySnapshot(), unchanged, 'opening the end dialog only changes dialog UI');
    await page.keyboard.press('Enter');
    await expect(endDialog).toHaveCount(0); await expect(trigger).toBeFocused();
    assert.deepEqual(await journeySnapshot(), unchanged, 'Enter defaults to keeping the journey');
    await trigger.click(); await expect(keepJourney).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(confirmJourney).toBeFocused();
    await page.keyboard.press('Tab'); await expect(keepJourney).toBeFocused();
    await page.keyboard.press('Tab'); await expect(confirmJourney).toBeFocused();
    await page.keyboard.press('Tab'); await expect(keepJourney).toBeFocused();
    assert.deepEqual(await endDialog.locator('h2, p, button').evaluateAll(nodes => nodes.filter(node => {
      const box = node.getBoundingClientRect();
      return box.x < -1 || box.right > innerWidth + 1 || node.scrollWidth > node.clientWidth + 1
        || (node.tagName === 'BUTTON' && box.height < 48);
    }).map(node => node.textContent)), [], 'end dialog text and controls fit 320px at 150%');
    await page.keyboard.press('Escape');
    await expect(endDialog).toHaveCount(0); await expect(trigger).toBeFocused();
    assert.deepEqual(await journeySnapshot(), unchanged, 'Escape preserves journey, sensors, speech and family state');
    await trigger.click(); await keepJourney.click();
    await expect(endDialog).toHaveCount(0); await expect(trigger).toBeFocused();
    assert.deepEqual(await journeySnapshot(), unchanged, 'explicit keep preserves all journey state');
    assert.equal(requests.length, requestCount, 'open and keep send no HTTP requests, including family updates');
  };
  const checkOrdinaryEndDialog = async () => {
    await click('结束导航');
    const ordinaryDialog = page.getByRole('dialog', { name: '确认结束这次导航？', exact: true });
    await expect(ordinaryDialog).toBeVisible();
    await expect(ordinaryDialog.getByText('请现场确认是否到达目的地。结束导航不会自动验证到达。', { exact: true })).toBeVisible();
    await expect(ordinaryDialog.getByRole('button', { name: '继续导航', exact: true })).toBeFocused();
    await expect(ordinaryDialog.getByRole('button', { name: /^(结束但未确认到达|确认结束导航)$/, exact: true })).toBeVisible();
    await expect(endDialog).toHaveCount(0);
    await ordinaryDialog.getByRole('button', { name: '继续导航', exact: true }).click();
    await expect(ordinaryDialog).toHaveCount(0);
  };
  await page.goto(`${base}/#/login`);
  await click('跳过登录，直接使用');
  await page.getByRole('button', { name: /使用轮椅/ }).click(); await click('下一步'); await click('暂时跳过');
  await plan();
  await checkOrdinaryEndDialog();
  await expect(page.getByRole('button', { name: '前方走不了', exact: true })).toBeEnabled();
  await click('预览下一段');
  const before = await stats(), count = requests.length;
  await open();
  await expect(page.getByRole('heading', { name: '哪一段走不了？' })).toBeFocused();
  await expect(page.getByRole('radio', { name: /当前路线步骤.*合成当前路/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: /下一路线步骤.*合成下一路/ })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(2);
  await selectCurrent();
  await click('取消，继续原行程');
  await expect(page.locator('.journey-counter')).toContainText('第 1 段，共 3 段：合成当前路');
  assert.deepEqual(await stats(), before); assert.equal(requests.length, count);
  // Keyboard confirmation and enlarged text remain inside the narrow viewport.
  await open(); await selectCurrent();
  await page.addStyleTag({ content: 'html { font-size:150%; }' });
  const clipped = await page.locator('.journey-obstruction, .journey-obstruction button, .journey-obstruction label').evaluateAll(nodes => nodes.filter(n => {
    const b = n.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || b.height < 48 || n.scrollWidth > n.clientWidth + 1;
  }).map(n => n.textContent));
  assert.deepEqual(clipped, []);
  await page.getByRole('button', { name: '绕开这段，暂停导航', exact: true }).focus(); await page.keyboard.press('Enter');
  await paused(); assert.deepEqual(await stats(), before); assert.equal(requests.length, count);
  assert.ok(page.url().endsWith('/elder/navigation'));
  await expect(page.getByRole('button', { name: '从当前位置重新规划绕行', exact: true })).toBeFocused();
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toContainText('合成当前路');
  const lockedSummary = '目的地：合成终点；出行选择：轮椅老人；路线偏好：“综合推荐”。';
  await expect(panel).toContainText(lockedSummary);
  await expect(nextStep).toHaveText('下一步：点“从当前位置重新规划绕行”，获取当前位置。');
  await expect(panel).toContainText('仅在这次行程中绕开所选路段，不代表公共封路；刷新页面后不会恢复导航。');
  await checkEndCancellation(panelEnd);
  await checkEndCancellation(pausedEnd);

  // A retained callback cannot end a different session, a departed page or a changed account.
  for (const invalidation of ['session', 'path', 'account']) {
    await panelEnd.click(); await expect(keepJourney).toBeFocused();
    await page.evaluate(async invalidation => {
      const state = document.getElementById('app').__vue_app__._instance.setupState;
      window.__staleEndRequest = state.detourEndRequest;
      if (invalidation === 'session') state.detourSession = { ...state.detourSession };
      if (invalidation === 'path') {
        await state.router.push('/elder/routes'); await state.router.push('/elder/navigation');
      }
      if (invalidation === 'account') {
        state.currentUser = { id: 'synthetic-stale-end-owner', role: 'elder' };
        state.currentUser = null;
      }
    }, invalidation);
    await expect(endDialog).toHaveCount(0); await paused();
    const unchanged = await journeySnapshot(), requestCount = requests.length;
    await page.evaluate(async () => {
      const state = document.getElementById('app').__vue_app__._instance.setupState;
      await state.confirmDetourEnd(window.__staleEndRequest);
    });
    assert.deepEqual(await journeySnapshot(), unchanged, `${invalidation} invalidates an old confirmation`);
    assert.equal(requests.length, requestCount);
    await panelEnd.click(); await expect(keepJourney).toBeFocused();
    await page.evaluate(() => {
      const state = document.getElementById('app').__vue_app__._instance.setupState;
      state.dismissDetourEnd(window.__staleEndRequest);
    });
    await expect(endDialog).toBeVisible();
    await keepJourney.click(); await expect(panelEnd).toBeFocused();
  }
  // Changing editable settings must not relabel the locked trip.
  await page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    state.endName = '合成可变终点'; state.mobilityType = 'CANE'; state.routeStrategy = 'SAFEST';
  });
  await expect(panel).toContainText(lockedSummary);
  await expect(panel).not.toContainText('合成可变终点');
  await expect(panel).not.toContainText('拐杖老人');
  await expect(panel).not.toContainText('最安全');
  await page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    state.endName = '合成终点'; state.mobilityType = 'WHEELCHAIR'; state.routeStrategy = 'BALANCED';
  });
  // Unknown locked options are omitted, even while editable choices are known.
  for (const [mobilityType, strategy, expected, absent] of [
    ['UNKNOWN_PROFILE', 'BALANCED', '路线偏好：“综合推荐”', '出行选择'],
    ['WHEELCHAIR', 'UNKNOWN_STRATEGY', '出行选择：轮椅老人', '路线偏好'],
    ['UNKNOWN_PROFILE', 'UNKNOWN_STRATEGY', '目的地：合成终点', '出行选择|路线偏好'],
  ]) {
    await page.evaluate(({ mobilityType, strategy }) => {
      const state = document.getElementById('app').__vue_app__._instance.setupState;
      state.detourSession = { ...state.detourSession, mobilityType, strategy };
    }, { mobilityType, strategy });
    await expect(panel).toContainText(expected);
    await expect(panel).not.toContainText(new RegExp(`WHEELCHAIR|BALANCED|UNKNOWN_PROFILE|UNKNOWN_STRATEGY|${absent}`));
  }
  await page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    state.detourSession = { ...state.detourSession, mobilityType: 'WHEELCHAIR', strategy: 'BALANCED' };
  });
  await expect(panel).toContainText(lockedSummary);
  assert.deepEqual(await stats(), before); assert.equal(requests.length, count);
  assert.deepEqual(await page.locator('.detour-panel, .detour-panel button').evaluateAll(nodes => nodes.filter(n => {
    const b = n.getBoundingClientRect(); return b.x < -1 || b.right > innerWidth + 1 || n.scrollWidth > n.clientWidth + 1;
  }).map(n => n.textContent)), [], 'paused panel fits 320px at 150%');
  await fitsPanel();
  await click('从当前位置重新规划绕行');
  await expect(nextStep).toHaveCount(0); // locating must not ask for another action
  await deliverFix();
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toContainText('定位有歧义'); await paused();
  assert.equal(routeRequests().length, 2); assert.equal(routeRequests().at(-1).params.exclude_segment_code, 'blocked');
  lookupMode = 'missing';
  await click('从当前位置重新规划绕行'); await deliverFix();
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toContainText('资料不足'); await paused();
  lookupMode = 'unique';
  await click('从当前位置重新规划绕行'); await deliverFix();
  await expect(page.getByRole('button', { name: '确认此路段并查询绕行', exact: true })).toBeDisabled();
  await expect(nextStep).toHaveText('下一步：对照周围道路，选择实际所在路段，再点“确认此路段并查询绕行”。');
  await fitsPanel();
  const lookups = routeRequests().length;
  await page.getByLabel('确认您实际所在的替代路段').selectOption('alternative'); await paused();
  assert.equal(routeRequests().length, lookups);
  await click('确认此路段并查询绕行');
  await expect(page.getByRole('button', { name: '使用这条绕行路线', exact: true })).toBeVisible(); await paused();
  await expect(nextStep).toHaveText('下一步：核对下方新路线，确认后点“使用这条绕行路线”。');
  await expect(panel).toContainText('最新候选登记全程 50 米');
  await fitsPanel();
  const final = routeRequests().at(-1).params;
  assert.equal(final.exclude_segment_code, 'blocked'); assert.equal(final.start_segment_code, 'alternative');
  assert.equal('start_name' in final, false); assert.equal(final.end_name, '合成终点');
  await click('使用这条绕行路线'); await expect(page.locator('.journey-current h2')).toHaveText('合成绕行路');
  await expect(nextStep).toHaveCount(0);
  await page.addStyleTag({ content: 'html { font-size:100%; }' });
  await expect(page.getByRole('button', { name: '前方走不了', exact: true })).toBeDisabled();
  assert.equal((await stats()).spoken, 0, 'adoption does not automatically speak or share location');
  await checkOrdinaryEndDialog();
  await click('取消本次绕行'); await expect(page).toHaveURL(/\/elder\/plan$/);
  await expect(page.locator('.journey-current')).toHaveCount(0);

  // Active voice/location stop on locking, and an outstanding fix cannot revive it.
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan();
  await click('开启语音提示'); await click('开启我的位置');
  const active = await stats(), cancels = await page.evaluate(() => window.__obstruction.canceled); await lock();
  assert.deepEqual(await stats(), active);
  assert.ok(await page.evaluate(() => window.__obstruction.canceled) > cancels, 'actual speech cancellation on lock');
  assert.equal(await page.evaluate(() => window.__obstruction.cleared), 1);
  await page.evaluate(() => window.__obstruction.watchCallbacks.at(-1)({ coords: { longitude: 10, latitude: 10, accuracy: 8 }, timestamp: Date.now() }));
  await paused(); assert.deepEqual(await stats(), active);
  await click('从当前位置重新规划绕行');
  const cancelCount = requests.length;
  await click('取消本次绕行'); await deliverFix();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page).toHaveURL(/\/elder\/plan$/);
  assert.equal(requests.length, cancelCount, 'late fix sends no lookup');
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toHaveCount(0);

  // Outstanding HTTP must stay inert after cancel as well.
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan(); await lock();
  let release; delayed = new Promise(resolve => { release = resolve; });
  const n = routeRequests().length;
  const lateResponse = page.waitForResponse(response => response.url().includes('/api/routes/start-options?'));
  await click('从当前位置重新规划绕行'); await deliverFix();
  await expect.poll(() => routeRequests().length).toBe(n + 1);
  await click('取消本次绕行'); release(); await (await lateResponse).finished();
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await expect(page).toHaveURL(/\/elder\/plan$/);
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toHaveCount(0);
  await expect(page.locator('.journey-current')).toHaveCount(0);
  assert.equal(routeRequests().length, n + 1, 'late HTTP produces no final route query');

  // App must reject a queued choice when the role has changed, even if a
  // caller bypasses the now-closed inline controls. All state is synthetic.
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan(); await open(); await selectCurrent();
  const beforeRole = requests.length;
  const rejected = await page.evaluate(async () => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
    const choice = planner.obstructionState.value.options[0];
    state.currentUser = { id: 'synthetic-role-only', role: 'family' }; state.isGuest = false;
    return state.confirmNavigationObstruction(choice);
  });
  assert.equal(rejected, false);
  await expect(page.locator('#navigation-obstruction')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '前方走不了', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: '本次绕行行程' })).toHaveCount(0);
  await expect(page.locator('.journey-current h2')).toHaveText('合成当前路');
  assert.equal(requests.length, beforeRole);
  assert.deepEqual(requests.filter(r => r.method !== 'GET'), [], 'guest never reports, syncs or writes');

  // This owner is entirely synthetic. The existing family publisher is exercised only against the loopback fixture.
  await page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    state.currentUser = { id: 'synthetic-end-owner', role: 'elder', mobilityType: 'WHEELCHAIR', profileComplete: true };
    state.isGuest = false; location.hash = '/elder/home';
  });
  await plan(); await lock();
  await click('从当前位置重新规划绕行'); await deliverFix();
  await page.getByLabel('确认您实际所在的替代路段').selectOption('alternative');
  await click('确认此路段并查询绕行'); await click('使用这条绕行路线');
  await expect(page.locator('.journey-current h2')).toHaveText('合成绕行路');
  await click('开启语音提示'); await click('开启我的位置');
  await page.addStyleTag({ content: 'html { font-size:150%; }' });
  await checkEndCancellation(panelEnd);
  await panelEnd.click(); await expect(keepJourney).toBeFocused();
  const completedBefore = requests.filter(request => request.body?.status === 'COMPLETED').length;
  const replacements = await page.evaluate(async () => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    const request = state.detourEndRequest, replace = state.router.replace;
    let replacements = 0;
    state.router.replace = (...args) => {
      if (args[0] === '/elder/routes') replacements++;
      return replace(...args);
    };
    try {
      const button = [...document.querySelectorAll('dialog button')].find(button => button.textContent.trim() === '确认结束行程');
      button.click(); button.click();
      await state.confirmDetourEnd(request);
      await new Promise(requestAnimationFrame);
      return replacements;
    } finally { state.router.replace = replace; }
  });
  await expect(page).toHaveURL(/\/elder\/routes$/);
  await expect(panel).toHaveCount(0); await expect(endDialog).toHaveCount(0);
  await expect.poll(() => requests.filter(request => request.body?.status === 'COMPLETED').length).toBe(completedBefore + 1);
  assert.equal(replacements, 1, 'the destructive action calls the existing finish path once');
  assert.deepEqual(await page.evaluate(() => document.getElementById('app').__vue_app__._instance.setupState.navigationProgress),
    { index: 0, paused: false });

  // The paused-page trigger also consumes its confirmation once without inventing an absent route snapshot.
  await page.addStyleTag({ content: 'html { font-size:100%; }' });
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan(); await lock();
  await pausedEnd.click(); await expect(keepJourney).toBeFocused();
  const pausedCompletedBefore = requests.filter(request => request.body?.status === 'COMPLETED').length;
  await page.evaluate(() => {
    const state = document.getElementById('app').__vue_app__._instance.setupState;
    const probe = window.__pausedEndProbe = { request: state.detourEndRequest, replace: state.router.replace, replacements: 0 };
    state.router.replace = (...args) => {
      if (args[0] === '/elder/routes') probe.replacements++;
      return probe.replace(...args);
    };
  });
  await confirmJourney.click();
  await expect(page).toHaveURL(/\/elder\/routes$/);
  const pausedReplacements = await page.evaluate(async () => {
    const state = document.getElementById('app').__vue_app__._instance.setupState, probe = window.__pausedEndProbe;
    try {
      await state.confirmDetourEnd(probe.request); await state.confirmDetourEnd(probe.request);
      return probe.replacements;
    } finally { state.router.replace = probe.replace; }
  });
  assert.equal(pausedReplacements, 1, 'the paused trigger enters the existing finish path once');
  await expect(panel).toHaveCount(0); await expect(endDialog).toHaveCount(0);
  assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__._instance.setupState.detourSession), null);
  assert.equal(requests.filter(request => request.body?.status === 'COMPLETED').length, pausedCompletedBefore,
    'the existing paused finish has no selected route to publish');

  // Ordinary guidance keeps its original single confirmation even while an adopted detour is active.
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan(); await lock();
  await click('从当前位置重新规划绕行'); await deliverFix();
  await page.getByLabel('确认您实际所在的替代路段').selectOption('alternative');
  await click('确认此路段并查询绕行'); await click('使用这条绕行路线');
  await expect(page.locator('.journey-current h2')).toHaveText('合成绕行路');
  await click('结束导航');
  const ordinaryActiveEnd = page.getByRole('dialog', { name: '确认结束这次导航？', exact: true });
  await expect(ordinaryActiveEnd).toBeVisible(); await expect(endDialog).toHaveCount(0);
  const ordinaryCompletedBefore = requests.filter(request => request.body?.status === 'COMPLETED').length;
  await ordinaryActiveEnd.getByRole('button', { name: '确认结束导航', exact: true }).click();
  await expect(page).toHaveURL(/\/elder\/routes$/);
  await expect(panel).toHaveCount(0); await expect(ordinaryActiveEnd).toHaveCount(0); await expect(endDialog).toHaveCount(0);
  await expect.poll(() => requests.filter(request => request.body?.status === 'COMPLETED').length).toBe(ordinaryCompletedBefore + 1);
  assert.equal(await page.evaluate(() => document.getElementById('app').__vue_app__._instance.setupState.detourSession), null);

  // An old request remains inert after the App itself has unmounted.
  await page.addStyleTag({ content: 'html { font-size:100%; }' });
  await page.evaluate(() => { location.hash = '/elder/home'; }); await plan(); await lock();
  await pausedEnd.click(); await expect(keepJourney).toBeFocused();
  await page.evaluate(() => {
    const app = document.getElementById('app').__vue_app__, state = app._instance.setupState;
    window.__unmountedEnd = { request: state.detourEndRequest, confirm: state.confirmDetourEnd, state };
    app.unmount();
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const afterUnmount = requests.length;
  await page.evaluate(async () => {
    const { request, confirm } = window.__unmountedEnd;
    await confirm(request); await confirm(request);
  });
  assert.equal(requests.length, afterUnmount, 'an unmounted confirmation cannot send completion or other HTTP');
  assert.equal(await page.evaluate(() => window.__unmountedEnd.state.detourEndRequest), null);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: real guest App and synthetic owner at 320px/150%; both detour end triggers; keep default, Enter/Escape return focus and Tab trap; inert open/keep with active voice/watch and family publisher; stale session/path/account/unmount callbacks rejected; one confirmed finish and COMPLETED; ordinary end dialog preserved including active detour; existing obstruction, labels, hints and late fix/HTTP regressions; zero external requests/artifacts. No mobile hardware test.');
  await context.close();
} finally { await browser?.close(); await server.close(); }
