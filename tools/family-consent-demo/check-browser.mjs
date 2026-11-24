// Existing local Playwright and installed Chrome only. Child server always cleaned up.
import { chromium } from '../../frontend/node_modules/@playwright/test/index.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const python = fileURLToPath(new URL('../../.conda/elder-map-py311/python.exe', import.meta.url));
const child = spawn(python, ['-B', fileURLToPath(new URL('server.py', import.meta.url)), '--port', '0'], {stdio:['ignore','pipe','pipe']});
let browser;
try {
  const base = await Promise.race([
    once(child.stdout, 'data').then(([data]) => data.toString().trim()),
    once(child, 'exit').then(([code]) => {throw Error(`Server exited ${code}`);}),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('Server startup timeout')), 10000); timer.unref(); }),
  ]);
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  browser = await chromium.launch({channel:'chrome', headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/*', route => route.request().url().startsWith(base + '/') ? route.continue() : route.abort());
  const elder = await context.newPage();
  const family = await context.newPage();
  const familyResponses = [];
  const invitationCodes = [];
  family.on('response', response => {
    if (response.url() === base + '/api/family') familyResponses.push(response.text());
  });
  await elder.goto(base + '/elder');
  await family.goto(base + '/family');
  await elder.getByRole('button', {name:'生成新演示邀请码'}).click();
  await elder.waitForFunction(() => /^[A-F0-9]{16}$/.test(document.querySelector('#code').textContent));
  const code = await elder.locator('#code').textContent();
  invitationCodes.push(code);
  await family.locator('#input').fill(code);
  await family.locator('#accept').click();
  await elder.locator('#confirm').click();
  await family.waitForFunction(() => document.querySelector('#pair').textContent === '已绑定测试角色');
  assert.equal(await family.locator('#shared').textContent(), '');
  await elder.locator('#grant').click();
  await family.waitForFunction(() => document.querySelector('#shared').textContent.includes('模拟共享已开启'));
  await family.locator('#revoke').click();
  await elder.waitForFunction(() => document.querySelector('#consent').textContent.includes('共享已撤销'));
  assert.equal(await family.locator('#shared').textContent(), '');
  assert.equal(await family.locator('#pair').textContent(), '已绑定测试角色');
  await family.locator('#accept').click();
  await family.waitForFunction(() => document.querySelector('#message').textContent.includes('操作未获允许'));
  // Renew, grant, then revoke from the elder view as well.
  await elder.locator('#issue').click();
  await elder.waitForFunction(old => /^[A-F0-9]{16}$/.test(document.querySelector('#code').textContent) && document.querySelector('#code').textContent !== old, code);
  const renewedCode = await elder.locator('#code').textContent();
  invitationCodes.push(renewedCode);
  await family.locator('#input').fill(renewedCode);
  await family.locator('#accept').click();
  await elder.locator('#confirm').click();
  await elder.locator('#grant').click();
  await family.waitForFunction(() => document.querySelector('#shared').textContent.includes('模拟共享已开启'));
  await elder.locator('#revoke').click();
  await family.waitForFunction(() => document.querySelector('#consent').textContent.includes('共享已撤销'));
  assert.equal(await family.locator('#shared').textContent(), '');
  // Regrant through a fresh invite, hold an old granted GET, then revoke.
  const previous = await elder.locator('#code').textContent();
  await elder.locator('#issue').click();
  await elder.waitForFunction(old => document.querySelector('#code').textContent !== old, previous);
  const thirdCode = await elder.locator('#code').textContent();
  invitationCodes.push(thirdCode);
  await family.locator('#input').fill(thirdCode);
  await family.locator('#accept').click();
  await elder.locator('#confirm').click();
  await elder.locator('#grant').click();
  await family.waitForFunction(() => document.querySelector('#shared').textContent.includes('模拟共享已开启'));
  let release;
  let captured;
  const ready = new Promise(resolve => { captured = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let holdNext = true;
  await family.route('**/api/family', async route => {
    if (route.request().method() === 'GET' && holdNext) {
      holdNext = false;
      const response = await route.fetch();
      captured();
      await held;
      await route.fulfill({response});
    } else await route.continue();
  });
  await ready;
  await family.locator('#revoke').click();
  await family.waitForFunction(() => document.querySelector('#consent').textContent.includes('共享已撤销'));
  release();
  await family.waitForTimeout(1000);
  assert.equal(await family.locator('#shared').textContent(), '');
  await family.unroute('**/api/family');
  await family.route('**/api/family', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 1100));
    await route.fulfill({response});
  });
  await family.reload();
  await family.waitForFunction(() => document.querySelector('#pair').textContent === '已绑定测试角色');
  await family.unroute('**/api/family');
  // Hold requests forever; page deadline must clear even without a rejection.
  await family.route('**/api/family', () => {});
  await family.waitForFunction(() => document.querySelector('#pair').textContent.includes('状态未确认'), null, {timeout:8000});
  assert.equal(await family.locator('#shared').textContent(), '');
  await family.unroute('**/api/family');
  await family.route('**/api/family', route => route.abort());
  await family.waitForFunction(() => document.querySelector('#pair').textContent.includes('状态未确认'));
  assert.equal(await family.locator('#shared').textContent(), '');
  assert.equal(await family.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const serialized = await Promise.all(familyResponses);
  assert.ok(serialized.length > 10);
  for (const raw of serialized) {
    for (const value of invitationCodes) assert.ok(!raw.includes(value), 'Family JSON leaked invitation value');
    for (const key of ['code', 'invitation_id', 'pair_id']) assert.ok(!(key in JSON.parse(raw)), `Family JSON exposed ${key}`);
  }
  console.log(`PASS: ${serialized.length} full family HTTP responses contain none of the 3 generated invite codes or code/ID aliases.`);
  console.log('PASS: Chrome two pages, pairing vs consent, both-role revoke, replay rejection, renewal, delayed stale GET after revoke, slow GET, hanging GET deadline, network-failure clearing, 390px no overflow. Synthetic state only.');
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; }
  console.log('Own demo server and browser cleaned up.');
}
