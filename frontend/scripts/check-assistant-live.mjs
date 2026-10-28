import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
const output = process.env.UI_OUTPUT_DIR || 'artifacts/mobile-ui';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes('/assistant/')) return route.continue();
    await route.fulfill({ json: path.endsWith('/pois') || path.endsWith('/segments') ? [] : { features: [], suggestions: [] } });
  });
  await page.goto(`${base}/#/elder/assistant`);
  await page.getByText('本地助手已就绪', { exact: true }).waitFor({ timeout: 10000 });
  const question = '请用两句话告诉我，怎么在助老地图查询轮椅出行路线？';
  await page.getByLabel('向出行助手提问').fill(question);
  const started = Date.now();
  const replyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assistant/chat', { timeout: 110000 });
  await page.getByRole('button', { name: '发送问题', exact: true }).click();
  const response = await replyResponse;
  assert.equal(response.status(), 200);
  const payload = await response.json();
  await page.locator('.chat-turn--assistant').waitFor();
  assert.equal(await page.locator('.chat-turn--assistant p').innerText(), payload.reply);
  assert.deepEqual(pageErrors, []);
  await page.screenshot({ path: `${output}/assistant-live-390.png`, fullPage: true });
  const result = { liveOllama: true, question, model: payload.model, reply: payload.reply, seconds: Math.round((Date.now()-started)/10)/100 };
  await writeFile(`${output}/assistant-live.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); }
