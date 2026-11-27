import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// All API/media/provider traffic is intercepted. These pixels are synthetic;
// neither the backend nor original project/media is opened by this script.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../artifacts/predeparture-first-leg/', import.meta.url));
const saveArtifacts = !process.argv.includes('--no-artifacts');
const demoSmoke = process.argv.includes('--demo-smoke');
const demo = process.argv.includes('--demo') || demoSmoke;
const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8WQAAAAASUVORK5CYII=', 'base64');
const row = (code, i) => ({ segment_code: code, name: `合成登记道路${code}`, length_m: 100,
  width_m: 2.5, slope_percent: 1, step_count: 0, bench_count: 1, rest_facility_score: 4,
  geometry_coordinates: [[106.3 + i / 1000, 29.6], [106.301 + i / 1000, 29.6]] });
const makeRoute = (prefix, rank = 1) => ({ rank, route_score: rank * 10, summary: `合成候选${prefix}`,
  distance_m: 200, estimated_minutes: 5, segment_codes: [`${prefix}_FIRST`, `${prefix}_NEXT`],
  // Deliberately reverse detail rows: only segment_codes establishes the first leg.
  segments: [row(`${prefix}_NEXT`, 1), row(`${prefix}_FIRST`, 0)] });
const photo = id => ({ photo_id: id, caption: `合成照片说明${id}`, risk_tags: [],
  thumbnail_url: `/media/evidence/thumb/${id}.webp`, display_url: `/media/evidence/display/${id}.webp` });
const features = () => [...makeRoute('A').segments, ...makeRoute('B').segments, row('UNRELATED', 2)].map(r => ({
  type: 'Feature', geometry: { type: 'LineString', coordinates: r.geometry_coordinates },
  properties: { kind: 'segment', ...r, evidence_photos: [photo(`${r.segment_code}_ONE`), photo(`${r.segment_code}_TWO`)] },
}));
const server = await createServer({ root, configFile: false, envDir: false, plugins: [vue()],
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
  optimizeDeps: { noDiscovery: true, include: [] } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
let browser;
const contexts = new Set(), checks = [], audits = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const opener = page => button(page, '出发前看首段实景');
const preview = page => page.getByTestId('predeparture-photo-preview');
const image = page => page.getByTestId('predeparture-photo-image');
const tick = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function mutate(page, code) {
  await page.evaluate(async code => {
    const planner = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
    const map = (await import('/src/composables/useMapData.js')).useMapData();
    const auth = (await import('/src/composables/useAuthSession.js')).useAuthSession();
    Function('planner', 'map', 'auth', code)(planner, map, auth);
  }, code);
  await tick(page);
}
async function stable(page) {
  return page.evaluate(async () => {
    const p = (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner();
    return JSON.parse(JSON.stringify({ routes: p.routes.value, selected: p.selectedRouteIndex.value,
      segment: p.selectedSegmentCode.value, profile: p.mobilityType.value, strategy: p.routeStrategy.value,
      start: p.startName.value, end: p.endName.value, currentOrigin: p.currentOrigin.value,
      rest: [p.restPreviewAvailable.value, p.restPreviewState.value, p.restPreview.value],
      exclusion: [p.exclusionState.value, p.exclusionPreview.value], detour: p.detour.session.value,
      action: p.actionStatus.value, audit: window.__predepartureAudit,
      local: { ...localStorage }, session: { ...sessionStorage } }));
  });
}
async function setup({ role = 'guest', kind = '', failure = '', echo = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: 320, height: 850 }, serviceWorkers: 'block', acceptDownloads: false });
  contexts.add(context); context.setDefaultTimeout(7000);
  const audit = { role, kind, failure, api: [], media: [], external: [], rejected: [], errors: [], downloads: 0 };
  audits.push(audit);
  const registry = features();
  const first = registry.find(f => f.properties.segment_code === 'A_FIRST');
  if (kind === 'missing') delete first.properties.evidence_photos;
  if (kind === 'invalid') first.properties.evidence_photos[0].display_url = 'https://untrusted.invalid/first.webp';
  if (kind === 'duplicate') registry.push(structuredClone(first));
  let holdId, heldPromise, releaseHeld, heldRouteQuery, releaseQuery;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const localApi = url.hostname === '127.0.0.1' && url.port === '8000';
    if (localApi && url.pathname.startsWith('/api/')) {
      audit.api.push({ path: url.pathname, method: request.method(), params: Object.fromEntries(url.searchParams), body: request.postDataJSON() });
      if (url.pathname.endsWith('/pois')) return route.fulfill({ json: ['A', 'B', 'C'].map(name => ({ name })) });
      if (url.pathname.includes('/pilot-areas/')) return route.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/geojson')) return route.fulfill({ json: { features: registry } });
      if (url.pathname.endsWith('/recommend')) {
        if (heldRouteQuery) { const wait = heldRouteQuery; heldRouteQuery = null; await wait; }
        return route.fulfill({ json: { ...Object.fromEntries(url.searchParams), routes: [makeRoute('A'), makeRoute('B', 2)],
          avoided_segments: [], ...echo } });
      }
      return route.fulfill({ json: url.pathname.endsWith('/sites') ? [] : {} });
    }
    const match = /^\/media\/evidence\/(display|thumb)\/([A-Z_]+)\.webp$/.exec(url.pathname);
    if (localApi && match && !url.search && request.method() === 'GET') {
      audit.media.push({ id: match[2], size: match[1], type: request.resourceType() });
      if (holdId === match[2]) { holdId = null; await heldPromise; }
      if (failure === 'offline') return route.abort('internetdisconnected');
      if (failure === 'http') return route.fulfill({ status: 503, contentType: 'text/plain', body: 'synthetic unavailable' });
      return route.fulfill({ contentType: 'image/png', headers: { 'cache-control': 'no-store' }, body: pixels });
    }
    if (url.origin !== base) { audit.external.push(url.href); return route.abort('blockedbyclient'); }
    if (url.pathname === '/src/services/amapLoader.js') return route.fulfill({ contentType: 'application/javascript',
      body: 'export async function loadAmap(){throw new Error("Synthetic map fallback");}' });
    if (url.pathname === '/' || /^\/(?:src|node_modules|@vite|@id|@fs)\//.test(url.pathname)) return route.continue();
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    audit.rejected.push(url.href); return route.abort('blockedbyclient');
  });
  await context.addInitScript(() => {
    window.__predepartureAudit = { captures: 0, watches: 0, clears: 0, speech: 0, wakes: 0 };
    Object.defineProperty(navigator, 'geolocation', { value: {
      getCurrentPosition() { window.__predepartureAudit.captures++; },
      watchPosition() { window.__predepartureAudit.watches++; return 1; },
      clearWatch() { window.__predepartureAudit.clears++; },
    } });
    Object.defineProperty(window, 'speechSynthesis', { value: {
      getVoices: () => [], speak() { window.__predepartureAudit.speech++; }, cancel() {},
    } });
    Object.defineProperty(navigator, 'wakeLock', { value: { request() {
      window.__predepartureAudit.wakes++; return Promise.resolve({ release() {} });
    } } });
  });
  const page = await context.newPage();
  page.on('pageerror', error => audit.errors.push(error.message)); page.on('download', () => audit.downloads++);
  await page.goto(`${base}/#/elder/home`);
  await expect(page.getByLabel('选择出发地点', { exact: true }).locator('option[value="A"]')).toHaveCount(1);
  await mutate(page, `auth.enterGuestMode(); ${role === 'elder' ? "auth.isGuest.value = false; auth.currentUser.value = { id: 'synthetic-elder', role: 'elder', profileComplete: true };" : ''}`);
  const plan = async () => {
    await page.getByLabel('选择出发地点', { exact: true }).selectOption('A');
    await page.getByLabel('选择目的地', { exact: true }).selectOption('B');
    await button(page, '查询适合的路线').click();
    await expect(page.getByRole('heading', { name: '请选择适合您的路线' })).toBeVisible();
  };
  return { page, audit, plan,
    holdPhoto(id) { holdId = id; heldPromise = new Promise(resolve => { releaseHeld = resolve; }); },
    releasePhoto() { releaseHeld?.(); },
    holdQuery() { heldRouteQuery = new Promise(resolve => { releaseQuery = resolve; }); },
    releaseQuery() { releaseQuery?.(); },
    async close(label) {
      releaseHeld?.(); releaseQuery?.();
      assert.deepEqual(audit.errors, []); assert.deepEqual(audit.external, []); assert.deepEqual(audit.rejected, []);
      assert.equal(audit.downloads, 0); checks.push(label);
      await context.close(); contexts.delete(context);
    } };
}
async function open(page) {
  await opener(page).focus(); await page.keyboard.press('Enter');
  await expect(preview(page)).toBeVisible(); await expect(button(page, '关闭首段实景')).toBeFocused();
  await expect(opener(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(preview(page)).toContainText('登记照片，只用于认路，不代表现状或当前位置');
  await expect(preview(page)).toContainText('照片朝向、出发方向及入口未确认');
}
async function closed(page) { await expect(preview(page)).toHaveCount(0); await expect(image(page)).toHaveCount(0); }
async function loaded(page, id) {
  await expect(image(page)).toHaveCount(1);
  await expect(image(page)).toHaveAttribute('src', `http://127.0.0.1:8000/media/evidence/display/${id}.webp`);
  await expect.poll(() => image(page).evaluate(n => n.complete && n.naturalWidth > 0)).toBe(true);
}
function noSharedOrGps(audit, state) {
  assert.equal(audit.api.filter(r => r.method !== 'GET').length, 0, 'preview sends no family/navigation writes');
  assert.deepEqual(state.audit, { captures: 0, watches: 0, clears: 0, speech: 0, wakes: 0 });
}
try {
  browser = await chromium.launch({ channel: 'chrome', headless: !demo || demoSmoke });
  if (demo) {
    const app = await setup({ kind: process.argv.includes('--missing') ? 'missing' : '' });
    await app.plan();
    await app.page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    console.log('Local synthetic demo ready at 320px/150% text. API and pixels are mocked; no original media. Close the demo window to stop.');
    const closedPage = app.page.waitForEvent('close', { timeout: 0 });
    if (demoSmoke) {
      await closed(app.page); assert.deepEqual(app.audit.media, []);
      noSharedOrGps(app.audit, await stable(app.page));
      assert.deepEqual(app.audit.errors, []); assert.deepEqual(app.audit.external, []);
      await app.page.close();
    }
    await closedPage;
  } else {
  for (const role of ['guest', 'elder']) {
    const app = await setup({ role }), { page, audit } = app;
    await app.plan(); await closed(page);
    await page.locator('.route-options-actions').scrollIntoViewIfNeeded(); await tick(page);
    assert.deepEqual(audit.media, [], 'initial route page does not request even a thumbnail');
    await expect(page.locator('img')).toHaveCount(0);
    await mutate(page, "planner.selectSegment('UNRELATED');");
    const before = await stable(page), calls = audit.api.length;
    await open(page); await loaded(page, 'A_FIRST_ONE');
    assert.deepEqual(audit.media, [{ id: 'A_FIRST_ONE', size: 'display', type: 'image' }]);
    assert.deepEqual(await stable(page), before, 'opening changes no route, metric, rest, GPS, storage or navigation state');
    assert.equal(audit.api.length, calls);
    await expect(preview(page)).toContainText('首段：合成登记道路A_FIRST');
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; }); await tick(page);
    const overflow = await preview(page).evaluate(n => [n, ...n.querySelectorAll('*')].filter(el => {
      const box = el.getBoundingClientRect(); return box.x < -1 || box.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 1;
    }).map(el => el.tagName));
    assert.deepEqual(overflow, [], 'preview fits 320px with 150% root font');
    const documentSize = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.ok(documentSize[0] <= documentSize[1] + 1, String(documentSize));
    assert.ok(await preview(page).locator('figcaption').evaluate(n => parseFloat(getComputedStyle(n).fontSize)) >= 24);
    for (const control of [opener(page), button(page, '关闭首段实景')]) {
      const box = await control.boundingBox(); assert.ok(box.width >= 48 && box.height >= 48);
    }
    const caption = preview(page).locator('figcaption');
    await caption.evaluate(n => n.scrollIntoView({ block: 'center' })); await tick(page);
    assert.ok(await caption.evaluate(n => {
      const box = n.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return n === hit || n.contains(hit);
    }), 'caption can be scrolled clear of the fixed bottom navigation');
    if (saveArtifacts && role === 'guest') {
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: `${output}/preview-320-150.png` });
    }
    await page.clock.install(); await page.clock.fastForward(60_000); assert.equal(audit.media.length, 1);
    await page.keyboard.press('Escape'); await closed(page); await expect(opener(page)).toBeFocused();
    await open(page); await loaded(page, 'A_FIRST_ONE'); await button(page, '关闭首段实景').click();
    await closed(page); await expect(opener(page)).toBeFocused();
    noSharedOrGps(audit, await stable(page));
    await app.close(`${role}: explicit-only single exact image, unchanged state/services, keyboard and 320/150`);
  }
  for (const kind of ['missing', 'invalid', 'duplicate']) {
    const app = await setup({ kind }), { page, audit } = app; await app.plan(); await open(page);
    await expect(image(page)).toHaveCount(0); await expect(preview(page)).toContainText('不会换用后续路段照片');
    await expect(preview(page)).not.toContainText('A_NEXT'); assert.deepEqual(audit.media, []);
    noSharedOrGps(audit, await stable(page)); await app.close(`${kind}: no later segment/photo substitution`);
  }
  for (const failure of ['http', 'offline']) {
    const app = await setup({ failure }), { page, audit } = app; await app.plan(); const before = await stable(page);
    await open(page); await expect(preview(page)).toContainText('首段登记照片加载失败');
    await expect(preview(page).locator('figcaption')).toHaveText('合成照片说明A_FIRST_ONE');
    await expect(image(page)).toHaveCount(0); assert.equal(audit.media.length, 1);
    await page.clock.install(); await page.clock.fastForward(60_000); assert.equal(audit.media.length, 1);
    assert.deepEqual(await stable(page), before); await app.close(`${failure}: truthful failure and caption, no retry`);
  }
  const late = await setup(), { page, audit } = late; await late.plan(); late.holdPhoto('A_FIRST_ONE');
  await open(page); await expect.poll(() => audit.media.length).toBe(1);
  await page.locator('.route-card-select').nth(1).click(); await closed(page);
  await open(page); await loaded(page, 'B_FIRST_ONE');
  late.releasePhoto(); await tick(page);
  await expect(preview(page)).toContainText('首段：合成登记道路B_FIRST'); await loaded(page, 'B_FIRST_ONE');
  assert.deepEqual(audit.media.map(m => m.id), ['A_FIRST_ONE', 'B_FIRST_ONE']);
  noSharedOrGps(audit, await stable(page)); await late.close('switch routes while image is pending; late old response cannot affect new image');

  for (const [label, code, canReopen] of [
    ['map replacement', 'map.mapFeatures.value = structuredClone(JSON.parse(JSON.stringify(map.mapFeatures.value)));', true],
    ['map mutation', "map.mapFeatures.value[0].properties.evidence_photos[0].caption = '合成新说明';", true],
    ['map loading', 'map.mapLoading.value = true;', false],
    ['start', "planner.startName.value = 'C';", false],
    ['end', "planner.endName.value = 'C';", false],
    ['profile', "planner.mobilityType.value = 'CANE';", false],
    ['strategy', "planner.routeStrategy.value = 'SAFEST';", false],
    ['same guest session', 'auth.enterGuestMode();', false],
    ['account', "auth.isGuest.value=false; auth.currentUser.value={id:'another',role:'elder',profileComplete:true};", false],
    ['unproven replacement', 'planner.routes.value = structuredClone(JSON.parse(JSON.stringify(planner.routes.value)));', false],
  ]) {
    const app = await setup(), { page, audit } = app; await app.plan(); await open(page); await loaded(page, 'A_FIRST_ONE');
    const count = audit.media.length; await mutate(page, code); await closed(page);
    assert.equal(audit.media.length, count);
    if (canReopen) { await open(page); await loaded(page, 'A_FIRST_ONE'); }
    else await expect(opener(page)).toHaveCount(0);
    noSharedOrGps(audit, await stable(page)); await app.close(`clear without loading a replacement: ${label}`);
  }
  const stale = await setup(); stale.holdQuery();
  const planning = stale.plan(); await expect.poll(() => stale.audit.api.filter(r => r.path.endsWith('/recommend')).length).toBe(1);
  await mutate(stale.page, 'auth.enterGuestMode();'); stale.releaseQuery(); await planning;
  await expect(opener(stale.page)).toHaveCount(0); assert.deepEqual(stale.audit.media, []);
  await stale.close('late query after a same-guest new session cannot authorize preview');

  const gallery = await setup(); await gallery.plan();
  const summary = gallery.page.locator('.predeparture-existing-gallery > summary');
  await summary.focus(); await gallery.page.keyboard.press('Enter');
  await expect(gallery.page.locator('.evidence-section')).toBeVisible();
  await expect(gallery.page.locator('.predeparture-existing-gallery')).toHaveAttribute('open', '');
  await summary.focus(); await gallery.page.keyboard.press('Enter');
  await expect(gallery.page.locator('.evidence-section')).toHaveCount(0);
  await closed(gallery.page);
  await gallery.close('original route gallery remains keyboard-accessible behind explicit expansion');

  for (const paused of [false, true]) {
    const app = await setup(); await app.plan(); await open(app.page); await loaded(app.page, 'A_FIRST_ONE');
    const count = app.audit.media.length;
    await mutate(app.page, `const candidate = JSON.parse(JSON.stringify(planner.routes.value[1]));
      candidate.segments = candidate.segment_codes.map(code => candidate.segments.find(row => row.segment_code === code));
      const ok = planner.detour.activate({ code: 'A_FIRST', name: '合成排除道路',
      createdAt: Date.now(), route: candidate, navigationContext: {
        startName: 'A', endName: 'B', mobilityType: 'WHEELCHAIR', strategy: 'BALANCED', scope: 'guest:guest:true' } });
      if (!ok) throw Error('synthetic detour activation failed'); ${paused ? 'planner.detour.pause();' : ''}`);
    await closed(app.page); await expect(opener(app.page)).toHaveCount(0);
    assert.equal(app.audit.media.length, count); noSharedOrGps(app.audit, await stable(app.page));
    await app.close(`${paused ? 'paused' : 'active'} detour has no ordinary first-leg preview`);
  }

  for (const echo of [{ start_name: 'wrong' }, { strategy: 'SAFEST' }, { start_context: { segment_code: 'A_FIRST' } }]) {
    const app = await setup({ echo }); await app.plan(); await expect(opener(app.page)).toHaveCount(0);
    assert.deepEqual(app.audit.media, []); await app.close(`no preview for mismatched/GPS response: ${JSON.stringify(echo)}`);
  }
  const leave = await setup(); await leave.plan(); await open(leave.page); await loaded(leave.page, 'A_FIRST_ONE');
  await mutate(leave.page, "location.hash='/elder/home';"); await closed(leave.page);
  await mutate(leave.page, "location.hash='/elder/routes';"); await closed(leave.page);
  await expect(opener(leave.page)).toHaveAttribute('aria-expanded', 'false');
  await open(leave.page); await leave.page.reload(); await closed(leave.page);
  await expect(opener(leave.page)).toHaveCount(0); await leave.close('leaving/back closes disclosure; reload cannot restore unqueried authority');

  const trip = await setup(); await trip.plan(); await open(trip.page); await loaded(trip.page, 'A_FIRST_ONE');
  await button(trip.page, '开始导航').click(); await closed(trip.page);
  await expect(trip.page.locator('.journey-counter')).toContainText('第 1 段');
  await button(trip.page, '看实景认路').click(); await expect(trip.page.getByTestId('navigation-photo-cue')).toBeVisible();
  await button(trip.page, '关闭实景').click();
  await button(trip.page, '已走完这段').click(); await expect(trip.page.locator('.journey-counter')).toContainText('第 2 段');
  await button(trip.page, '结束导航').click(); await button(trip.page, '我已到达（本人确认）').click();
  await expect(trip.page.getByTestId('arrival-receipt')).toContainText('手动标记确认了 1 段 / 共 2 段');
  await closed(trip.page); assert.equal(trip.audit.api.filter(r => r.method !== 'GET').length, 0);
  await trip.close('start closes preview; original in-trip photos, manual progress and arrival receipt still work');
  console.log(`PASS ${checks.length} predeparture first-leg browser scenarios. All API/media mocked; initial media=0; preview single checked URL; no preview GPS, sharing, speech, wake, storage or route changes. No backend/original media/external service.`);
  checks.forEach(check => console.log(`  ${check}`));
  }
} catch (error) {
  console.error('First-leg browser audit:', JSON.stringify({ completed: checks.length,
    recent: audits.slice(-3).map(({ api, ...audit }) => ({ ...audit, apiCalls: api.length })) })); throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close(); await server.close();
}
