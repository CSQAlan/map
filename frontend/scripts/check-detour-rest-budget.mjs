import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// SYNTHETIC: real app + browser forms, intercepted APIs, no real trip/account/GPS/vendor.
// Positive single-route DTOs from tests/detour-rest-budget.test.js (not a seed claim).
function route(prefix, lengths, stopIndices = []) {
  const codes = lengths.map((_, i) => `${prefix}-${i}`);
  const nodes = ['A', ...lengths.slice(1).map((_, i) => `${prefix}-node-${i + 1}`), 'T'];
  return { distance_m: Math.round(lengths.reduce((sum, n) => sum + n, 0) * 100) / 100,
    segment_codes: codes, segments: codes.map((segment_code, i) => ({ segment_code, name: `合成路段${segment_code}`, length_m: lengths[i] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: [...codes],
      node_codes: nodes, segment_lengths_m: [...lengths],
      stops: stopIndices.map(i => ({ node_index: i, node_code: nodes[i], name: `合成休息点${i}` })) } };
}

const trip = { start_name: '合成起点', end_name: '合成终点', mobility_type: 'WHEELCHAIR', strategy: 'BALANCED' };
const root = fileURLToPath(new URL('../', import.meta.url));
// Chrome/Playwright's disposable profiles must also stay inside this checkout.
for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = root;
let server, browser;
const contexts = new Set();
const audits = [];
const click = (page, name) => page.getByRole('button', { name, exact: true }).click();
const viteClient = 'export const createHotContext=()=>({accept(){},dispose(){},prune(){},on(){},send(){},invalidate(){},data:{}}); export function updateStyle(id,css){let s=document.getElementById(id);if(!s){s=document.createElement("style");s.id=id;document.head.append(s);}s.textContent=css;} export function removeStyle(id){document.getElementById(id)?.remove();}';

async function check(missingEvidence, base) {
  const audit = { synthetic: true, missingEvidence, api: [], external: [], unexpected: [], sockets: [], errors: [] };
  audits.push(audit);
  const context = await browser.newContext({ viewport: { width: 320, height: 800 },
    isMobile: true, hasTouch: true, serviceWorkers: 'block', permissions: [] });
  contexts.add(context);
  let releaseCandidate;
  const candidateGate = new Promise(resolve => { releaseCandidate = resolve; });
  let requestCount = 0;
  try {
    await context.addInitScript(() => {
      window.__detourBudgetAudit = { gps: 0, speech: 0 };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
        getCurrentPosition() { window.__detourBudgetAudit.gps++; throw Error('Synthetic check forbids GPS'); },
        watchPosition() { window.__detourBudgetAudit.gps++; throw Error('Synthetic check forbids GPS'); }, clearWatch() {},
      } });
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
        getVoices: () => [], cancel() {}, speak() { window.__detourBudgetAudit.speech++; },
      } });
    });
    await context.routeWebSocket('**/*', socket => { audit.sockets.push(socket.url()); socket.close(); });
    await context.route('**/*', async intercepted => {
      const request = intercepted.request(), url = new URL(request.url());
      requestCount++;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        audit.external.push(url.href); return intercepted.abort();
      }
      if (url.pathname.startsWith('/api/')) {
        const params = Object.fromEntries(url.searchParams);
        audit.api.push({ path: url.pathname, method: request.method(), params });
        if (request.method() !== 'GET') { audit.unexpected.push(url.href); return intercepted.abort(); }
        if (url.pathname === '/api/map-data/pois') return intercepted.fulfill({ json: [trip.start_name, trip.end_name].map(name => ({ name })) });
        if (url.pathname === '/api/pilot-areas/SHIDAYUAN') return intercepted.fulfill({ status: 503, json: { detail: 'Synthetic fallback map only' } });
        if (url.pathname === '/api/map-data/geojson') return intercepted.fulfill({ json: { features: [] } });
        if (url.pathname === '/api/diagnostics/segments') return intercepted.fulfill({ json: { suggestions: [] } });
        if (url.pathname === '/api/collect/segments') return intercepted.fulfill({ json: [] });
        if (url.pathname === '/api/routes/recommend') {
          const excluded = url.searchParams.get('exclude_segment_code');
          const dto = excluded ? route('detour', [170, 170], [1]) : route('direct', [260]);
          if (excluded) {
            await candidateGate;
            if (missingEvidence) delete dto.navigation_rest;
          }
          return intercepted.fulfill({ json: { ...trip, routes: [dto],
            ...(excluded ? { excluded_segment_code: excluded } : {}) } });
        }
        audit.unexpected.push(url.href); return intercepted.abort();
      }
      if (url.origin !== base) { audit.unexpected.push(url.href); return intercepted.abort(); }
      if (url.pathname === '/@vite/client') return intercepted.fulfill({ contentType: 'application/javascript', body: viteClient });
      if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(url.pathname)) return intercepted.fulfill({
        contentType: 'application/javascript', body: 'export async function loadAmap(){throw Error("SYNTHETIC: vendor disabled");}' });
      return intercepted.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => audit.errors.push(error.message));
    await page.goto(`${base}/#/login`);
    await click(page, '跳过登录，直接使用');
    await page.getByRole('button', { name: /使用轮椅/ }).click();
    await click(page, '下一步');
    await page.getByRole('dialog', { name: '再了解您一点' }).getByRole('button', { name: '暂时跳过', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const start = page.getByLabel('选择出发地点', { exact: true });
    await expect(start.locator(`option[value="${trip.start_name}"]`)).toHaveCount(1);
    await start.selectOption(trip.start_name);
    await page.getByLabel('选择目的地', { exact: true }).selectOption(trip.end_name);
    await click(page, '查询适合的路线');
    await expect(page.getByRole('heading', { name: '请选择适合您的路线', exact: true })).toBeVisible();
    const original = page.locator('.route-candidates-panel .route-card');
    await expect(original).toHaveCount(1);
    await expect(original.locator('.route-metrics')).toContainText('260 米');
    await expect(original.getByRole('button', { name: /已选择/ })).toHaveAttribute('aria-pressed', 'true');
    const recommend = () => audit.api.filter(row => row.path === '/api/routes/recommend');
    assert.equal(recommend().length, 1);
    assert.deepEqual(recommend()[0].params, trip, 'exact named original trip');
    const exclusion = page.getByRole('region', { name: '本次避开路段预览', exact: true });
    await page.getByLabel('从当前所选路线选择路段', { exact: true }).selectOption('direct-0');
    await click(page, '本次避开此路段');
    await expect.poll(() => recommend().length).toBe(2);
    await expect(page.getByRole('button', { name: '正在查询…', exact: true })).toBeDisabled();
    const budget = page.getByLabel('连续步行预算', { exact: true });
    await expect(budget).toHaveValue('');
    const beforeBudgetApi = audit.api.length;
    await budget.selectOption('200');
    await expect(budget).toHaveValue('200');
    assert.equal(audit.api.length, beforeBudgetApi, 'budget while pending sends no API request');
    releaseCandidate();
    const comparison = page.getByTestId('detour-rest-budget');
    await expect(comparison).toBeVisible();
    await expect(exclusion).toContainText('候选登记距离 340 米；原所选 260 米。');
    assert.deepEqual(recommend()[1].params, { ...trip, exclude_segment_code: 'direct-0' });
    if (missingEvidence) {
      await expect(comparison.getByRole('status')).toContainText('连续步行对比暂不可用');
      await expect(comparison).toContainText('无法判断最长连续步行距离');
      await expect(comparison.locator('dl')).toHaveCount(0);
      await expect(comparison).not.toContainText('按 200 米预算');
    } else {
      const values = comparison.locator('dd');
      await expect(values).toHaveText(['260 米', '170 米', '260 米 / 340 米']);
      await expect(comparison).toContainText('候选最长连续登记步行缩短 90 米');
      await expect(comparison).toContainText('按 200 米预算：原所选路线超过预算；绕行候选未超过预算');
      await expect(comparison.getByTestId('detour-first-over-limit')).toHaveCount(0);
    }
    await expect(comparison).toContainText('不保证有座位');
    await expect(exclusion).toContainText('确认前仅预览，不切换当前路线');
    // Re-evaluate via the visible select after the candidate has arrived, too.
    // Count ALL requests, not just route fetches, across settled budget changes.
    await page.waitForLoadState('networkidle');
    const before = { requests: requestCount, api: audit.api.length, url: page.url() };
    await budget.selectOption('100');
    if (!missingEvidence) await expect(comparison).toContainText('按 100 米预算：原所选路线超过预算；绕行候选超过预算');
    await budget.selectOption('200');
    if (!missingEvidence) await expect(comparison).toContainText('绕行候选未超过预算');
    else await expect(comparison.getByRole('status')).toContainText('连续步行对比暂不可用');
    await page.waitForTimeout(300);
    assert.deepEqual({ requests: requestCount, api: audit.api.length, url: page.url() }, before,
      'budget changes cause no fetch or automatic navigation');
    assert.equal(new URL(page.url()).hash, '#/elder/routes');
    await expect(original).toHaveCount(1);
    await expect(original.locator('.route-metrics')).toContainText('260 米');
    await expect(original).toContainText('合成路段direct-0');
    await expect(original.getByRole('button', { name: /已选择/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: '开始导航', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始绕行导航', exact: true })).toHaveCount(0);
    await expect(page.getByRole('region', { name: '本次绕行行程', exact: true })).toHaveCount(0);
    assert.equal(recommend().length, 2);
    assert.deepEqual(await page.evaluate(() => window.__detourBudgetAudit), { gps: 0, speech: 0 });
    for (const key of ['external', 'unexpected', 'sockets', 'errors']) assert.deepEqual(audit[key], [], key);
    console.log(`PASS SYNTHETIC mobile Chrome ${missingEvidence ? 'missing candidate evidence → unknown' : '260 m original / 340 m candidate; longest 260 / 170 m; 200 m budget met only by candidate'}; preview retained, no budget fetch/navigation, no real account/GPS/vendor/network.`);
  } finally {
    releaseCandidate();
    try { await context.close(); } finally { contexts.delete(context); }
  }
}

try {
  server = await createServer({ root, configFile: false, envDir: false,
    // Ignore inherited VITE_* as well as .env files; never load production config.
    envPrefix: 'ELDER_SYNTHETIC_UNUSED_', plugins: [vue()],
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] } });
  // Vite 8 treats server.listen({port:0}) as its default 5173. Bind its HTTP
  // server directly so the OS chooses a fresh port without probing used ports.
  await new Promise((resolve, reject) => {
    server.httpServer.once('error', reject);
    server.httpServer.listen(0, '127.0.0.1', resolve);
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  await check(false, base);
  await check(true, base);
  console.log('PASS detour rest budget: 2 synthetic browser scenarios; artifacts written: 0; real trips tested: 0.');
} catch (error) {
  console.error('SYNTHETIC detour rest budget audit:', JSON.stringify(audits));
  throw error;
} finally {
  try { await Promise.allSettled([...contexts].map(context => context.close())); }
  finally { try { await browser?.close(); } finally { await server?.close(); } }
}
