import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.UI_OUTPUT_DIR || 'artifacts/mobile-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
const results = [];
const errors = [];
const places = ['师大苑大学城西路入口', '师大苑荷塘水景休息区', '师大苑林下休闲步道'];
const mockRoute = { rank: 1, summary: '沿林下步道，平缓到达休息区', route_score: 86, distance_m: 420, estimated_minutes: 9, segment_codes: ['DEMO-1'], segments: [{ segment_code: 'DEMO-1', name: '林下休闲步道', length_m: 420, explanation: '界面测试示例路段', benefit_tags: ['平缓步道', '沿途休息'], risk_tags: [] }] };
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: width >= 768 ? 1024 : 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    let sentAssistantPayload = null;
    page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
    // Deterministic fixtures validate layout without a database, map key or GPU.
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/assistant/chat')) sentAssistantPayload = route.request().postDataJSON();
      const data = path.endsWith('/pois') ? places.map(name => ({ name }))
        : path.endsWith('/recommend') ? { routes: [mockRoute], avoided_segments: [] }
        : path.endsWith('/assistant/status') ? { available: true, model: 'qwen3.5:4b', message: '本地助手已就绪' }
        : path.endsWith('/assistant/chat') ? { reply: '请先在首页选择出发地点和目的地，再根据您的出行情况查询路线。现场通行条件请以实际情况为准。', model: 'qwen3.5:4b' }
        : path.endsWith('/sites') ? []
        : path.includes('/survey-records') ? { records: [], features: [], total: 0 }
        : path.endsWith('/segments') ? [] : { features: [], suggestions: [] };
      await route.fulfill({ json: data, headers: { 'access-control-allow-origin': '*' } });
    });
    for (const [name, path] of [['login', '/login'], ['home', '/elder/home'], ['assistant', '/elder/assistant'], ['conditions', '/elder/plan'], ['routes', '/elder/routes'], ['survey', '/elder/survey']]) {
      await page.goto(`${base}/#${path}`);
      await page.locator('h1').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (name === 'assistant' && width < 768) {
        const input = await page.locator('.assistant-input-box').boundingBox();
        const nav = await page.locator('.role-bottom-nav').boundingBox();
        assert.ok(input.y + input.height <= nav.y, 'Assistant input must remain above mobile navigation');
      }
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      if (dimensions.scroll > dimensions.client + 1) {
        await page.screenshot({ path: output + '/overflow-' + name + '-' + width + '.png', fullPage: true });
        console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].map(el => ({ tag: el.tagName, cls: el.className, x: el.getBoundingClientRect().x, right: el.getBoundingClientRect().right })).filter(el => el.right > innerWidth + 1 || el.x < -1)));
      }
      assert.ok(dimensions.scroll <= dimensions.client + 1, `${name} at ${width}px overflows: ${JSON.stringify(dimensions)}`);
      if (width === 390 || (width === 1440 && name === 'home')) await page.screenshot({ path: `${output}/${name}-${width}.png`, fullPage: true });
      results.push({ name, width, ...dimensions });
    }
    await page.goto(`${base}/#/elder/home`);
    await page.getByLabel('选择出发地点', { exact: true }).selectOption(places[0]);
    await page.getByLabel('选择目的地', { exact: true }).selectOption(places[1]);
    await page.getByRole('button', { name: '查询适合的路线' }).click();
    await page.getByRole('heading', { name: '请选择适合您的路线' }).waitFor();
    await page.getByText(mockRoute.summary, { exact: true }).waitFor();
    if (width === 390) await page.screenshot({ path: `${output}/planned-route-390.png`, fullPage: true });
    await page.getByRole('button', { name: '开始导航', exact: true }).click();
    await page.waitForURL('**/#/elder/navigation');
    assert.equal(await page.locator('.role-bottom-nav').count(), 0);
    await page.evaluate(() => { location.hash = '/elder/assistant'; });
    await page.locator('.assistant-context input').check();
    await page.getByLabel('向出行助手提问').fill('怎么查询路线？');
    await page.getByRole('button', { name: '发送问题', exact: true }).click();
    await page.locator('.chat-turn--assistant').waitFor();
    assert.equal(await page.locator('.chat-turn--assistant').count(), 1);
    assert.equal(sentAssistantPayload.context.start, places[0]);
    assert.equal(sentAssistantPayload.context.destination, places[1]);
    assert.equal(sentAssistantPayload.context.summary, mockRoute.summary);
    assert.equal('user_id' in sentAssistantPayload.context, false);
    if (width === 390) await page.screenshot({ path: `${output}/assistant-chat-390.png`, fullPage: true });
    if (width < 768) {
      await page.setViewportSize({ width, height: 560 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const input = await page.locator('.assistant-input-box').boundingBox();
      const nav = await page.locator('.role-bottom-nav').boundingBox();
      await page.screenshot({ path: output + '/assistant-short-' + width + '.png', fullPage: true });
      assert.ok(input.y + input.height <= nav.y, 'Short viewport input overlap: ' + JSON.stringify({ width, input, nav }));
    }
    await context.close();
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  await writeFile(`${output}/checks.json`, JSON.stringify({ fixtures: true, results, errors }, null, 2));
  console.log(`PASS: ${results.length} layout checks, 4 route/navigation flows and 4 assistant chat flows. Screenshots: ${output}`);
} finally { await browser.close(); }
