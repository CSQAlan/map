import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Real App + real receipt Set; self-contained HTTP/device mocks: no backend, account, key, GPS or external network.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../artifacts/navigation-undo/', import.meta.url));
const saveArtifacts = process.argv.includes('--artifacts');
const server = await createServer({ root, configFile: false, envDir: false, plugins: [{ name: 'undo-local-api', enforce: 'pre', resolveId(id) {
    if (/\/config\/api(?:\.js)?$/.test(id)) return '\0undo-local-api';
  }, load(id) {
    if (id === '\0undo-local-api') return 'export const API_BASE_URL=""; export const apiConfigurationError="";';
  } }, vue()],
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
if (saveArtifacts) await mkdir(output, { recursive: true });
const checks = [];
const makeRoute = code => ({ rank: 1, distance_m: 360, estimated_minutes: 5,
  segment_codes: [0,1,2].map(i => `${code}_${i}`),
  segments: [0,1,2].map(i => ({segment_code:`${code}_${i}`, name:['合成甲路','合成乙路','合成丙路'][i], length_m:120,
    width_m:2, step_count:0, geometry_coordinates:[[106.3+i/1000,29.6],[106.301+i/1000,29.6]]})) });

async function setup(role = 'guest') {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, serviceWorkers: 'block' });
  await context.addInitScript(() => {
    window.__returnAudit = { gps: 0, speech: 0 };
    window.__undoCallbacks = [];
    window.__undoStorage = 0;
    for (const key of ['setItem','removeItem','clear']) {
      const original = Storage.prototype[key];
      Storage.prototype[key] = function (...args) { window.__undoStorage++; return original.apply(this, args); };
    }
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
  await context.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (url.origin !== base) { external.push(url.href); return request.abort(); }
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams),
        method: request.request().method(), body: request.request().postDataJSON() });
      if (url.pathname.endsWith('/pois')) return request.fulfill({ json: ['A', 'B', 'C'].map(name => ({ name })) });
      if (url.pathname.includes('/pilot-areas/')) return request.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/geojson')) return request.fulfill({ json: { features: makeRoute('OUT').segments.map(row => ({
        type: 'Feature', properties: { kind: 'segment', ...row },
        geometry: { type: 'LineString', coordinates: row.geometry_coordinates } })) } });
      if (url.pathname.endsWith('/recommend')) {
        const code = url.searchParams.has('exclude_segment_code') ? 'DETOUR'
          : url.searchParams.get('start_name') === 'B' ? 'RETURN_ONLY' : 'OUT';
        return request.fulfill({ json: { ...Object.fromEntries(url.searchParams), routes: [makeRoute(code), makeRoute(code+'ALT')],
          excluded_segment_code: url.searchParams.get('exclude_segment_code'), avoided_segments: [] } });
      }
      return request.fulfill({ json: url.pathname.endsWith('/sites') ? [] : {} });
    }
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
  const finish = async (outcome = '结束但未确认到达') => {
    await page.getByRole('button', { name: '结束导航', exact: true }).click();
    await expect(page.getByTestId('return-journey')).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: outcome, exact: true }).click();
    await expect(page.getByRole('heading', { name: '请选择适合您的路线' })).toBeVisible();
  };
  const close = async label => {
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    assert.deepEqual(await page.evaluate(() => window.__returnAudit), { gps: 0, speech: 0 });
    checks.push(label); await context.close();
  };
  return { page, requests, plan, start, finish, close };
}
const writes = requests => requests.filter(r => r.method !== 'GET');

const button = (page, name) => page.getByRole('button', { name, exact: true });
const undo = page => button(page, '撤销刚才的确认');
const forward = page => button(page, '已走完这段');
async function count(page, current, confirmed) {
  await expect(page.getByTestId('manual-confirmed-count')).toContainText(`当前正在走第 ${current} 段；手动标记确认了 ${confirmed} 段 / 共 3 段`);
}
async function capture(page) {
  return undo(page).evaluate(element => {
    const callback = element.__vnode.props.onClick;
    if (typeof callback !== 'function') throw Error('Expected real Vue event handler');
    return window.__undoCallbacks.push(callback) - 1;
  });
}
const invoke = (page, index) => page.evaluate(async index => { await window.__undoCallbacks[index](); }, index);
async function layout(page) {
  const size = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  assert.ok(size.s <= size.c + 1, JSON.stringify(size));
  const bounds = await undo(page).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321 && bounds.height >= 48, JSON.stringify(bounds));
}
function auditWrites(requests, role) {
  if (role === 'guest') assert.equal(writes(requests).length, 0);
  for (const request of writes(requests)) {
    assert.match(request.path, /\/navigation$/);
    assert.deepEqual(Object.keys(request.body).sort(), ['start_name','end_name','distance_m','remaining_m',
      'estimated_minutes','current_step','route_summary','status','snapshot_revision'].sort());
    assert.ok(!/longitude|latitude|coordinates|confirmed|undo|outcome/.test(JSON.stringify(request.body)));
  }
}

try {
  for (const role of ['guest', 'elder']) {
    const app = await setup(role), { page, requests } = app;
    await app.plan(); await app.start(); await count(page, 1, 0);
    await page.evaluate(() => { document.documentElement.style.fontSize = '150%'; });
    await forward(page).click(); await count(page, 2, 1); await layout(page);
    const old = await capture(page), storage = await page.evaluate(() => window.__undoStorage);
    if (role === 'elder') await expect.poll(() => writes(requests).length).toBe(2);
    const before = writes(requests).length;
    await forward(page).focus(); await page.keyboard.press('Tab'); await expect(undo(page)).toBeFocused();
    if (saveArtifacts && role === 'guest') await page.screenshot({ path: output + '/before-320-150.png' });
    await page.keyboard.press('Space'); await count(page, 1, 0); await expect(forward(page)).toBeFocused();
    await invoke(page, old); await count(page, 1, 0);
    assert.equal(await page.evaluate(() => window.__undoStorage), storage);
    if (role === 'elder') await expect.poll(() => writes(requests).length).toBe(before + 1);
    else assert.equal(writes(requests).length, before);
    if (saveArtifacts && role === 'guest') await page.screenshot({ path: output + '/after-320-150.png' });
    await app.finish('我已到达（本人确认）');
    await expect(page.getByTestId('arrival-receipt')).toContainText('0 段 / 共 3 段');
    await expect(page.getByTestId('return-journey')).toBeVisible();
    await app.start(); await forward(page).click(); await count(page, 2, 1);
    await invoke(page, old); await count(page, 2, 1); // old session cannot erase new mark
    await undo(page).evaluate(element => { element.click(); element.click(); });
    await count(page, 1, 0); await expect(undo(page)).toHaveCount(0);
    await app.finish(); await expect(page.getByTestId('arrival-receipt')).toContainText('0 段 / 共 3 段');
    await expect(page.getByTestId('arrival-receipt')).toContainText('结束但未确认到达');
    auditWrites(requests, role);
    await app.close(`${role}: 1/3 -> 0/3, keyboard/focus, 320/150, double click, real end receipts, new session, unchanged sync fields`);
  }
  {
    const app = await setup('elder'), { page, requests } = app;
    await app.plan(); await app.start(); await forward(page).click(); await forward(page).click();
    await button(page, '手动确认最后一段已走完').click(); await count(page, 3, 3);
    const old = await capture(page);
    await expect.poll(() => writes(requests).length).toBe(3); // start + 2 ordinary progress steps
    const before = writes(requests).length;
    await undo(page).click(); await count(page, 3, 2);
    await button(page, '手动确认最后一段已走完').click();
    await invoke(page, old); await count(page, 3, 3);
    await undo(page).click(); await count(page, 3, 2);
    assert.equal(writes(requests).length, before); // last mark/undo do not publish index progress
    await app.finish(); await expect(page.getByTestId('arrival-receipt')).toContainText('2 段 / 共 3 段');
    auditWrites(requests, 'elder');
    await app.close('last segment: same step, 3/3 -> 2/3, stale same-index token rejected, no extra progress');
  }
  {
    const app = await setup(), { page } = app; await app.plan(); await app.start();
    await forward(page).click(); const old = await capture(page);
    await button(page, '上一段').click(); await count(page, 1, 1); await expect(undo(page)).toHaveCount(0);
    await forward(page).click(); await count(page, 2, 1); await expect(undo(page)).toHaveCount(0);
    await invoke(page, old); await count(page, 2, 1);
    await forward(page).click(); const newer = await capture(page);
    await invoke(page, old); await count(page, 3, 2);
    await undo(page).click(); await count(page, 2, 1);
    await forward(page).click(); await invoke(page, newer); await count(page, 3, 2);
    await button(page, '手动确认最后一段已走完').click();
    await button(page, '手动确认最后一段已走完').click(); await expect(undo(page)).toHaveCount(0);
    await app.finish(); await expect(page.getByTestId('arrival-receipt')).toContainText('3 段 / 共 3 段');
    await app.close('previous/repeated confirmation preserves old marks; old callbacks never undo newer steps');
  }
  for (const boundary of ['rest','end-cancel','obstruction','recovery','other-action','route','identity','leave','reload']) {
    const app = await setup(), { page } = app; await app.plan(); await app.start();
    await forward(page).click(); const old = await capture(page);
    if (boundary === 'rest') { await button(page, '累了，休息一下').click(); await button(page, '继续前行').click(); }
    if (boundary === 'end-cancel') { await button(page, '结束导航').click(); await page.keyboard.press('Escape'); }
    if (boundary === 'obstruction') { await button(page, '前方走不了').click(); await button(page, '取消，继续原行程').click(); }
    if (boundary === 'recovery') { await button(page, '我不确定走到哪').click(); await button(page, '关闭核对').click(); }
    if (boundary === 'other-action') await button(page, '文字导航').click();
    if (boundary === 'route') await page.evaluate(async () => { (await import('/src/composables/useRoutePlanner.js')).useRoutePlanner().selectRoute(1); });
    if (boundary === 'identity') await page.evaluate(async () => { (await import('/src/composables/useAuthSession.js')).useAuthSession().enterGuestMode(); });
    if (boundary === 'leave') { await button(page, '查看路线方案').click(); await app.start(); }
    if (boundary === 'reload') await page.reload();
    await expect(undo(page), boundary).toHaveCount(0);
    if (boundary !== 'reload') await invoke(page, old);
    await expect(undo(page), boundary).toHaveCount(0);
    if (['rest','end-cancel','obstruction','recovery','other-action'].includes(boundary)) await count(page, 2, 1);
    if (boundary === 'leave') await count(page, 2, 0); // original resumable manual index, new receipt session
    await app.close(`undo expired: ${boundary}`);
  }
  console.log(`PASS ${checks.length} manual undo real-App browser scenarios; all HTTP mocked; GPS/speech/external=0; no new sync fields.`);
} finally { await browser.close(); await server.close(); }
