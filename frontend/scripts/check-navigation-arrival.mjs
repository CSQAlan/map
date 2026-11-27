import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

// Self-contained mock app: no backend, account, key, GPS or external network.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../artifacts/navigation-arrival/', import.meta.url));
const saveArtifacts = !process.argv.includes('--no-artifacts');
const server = await createServer({ root, configFile: false, envDir: false, plugins: [vue()],
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false, ws: false } });
await server.listen();
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
if (saveArtifacts) await mkdir(output, { recursive: true });
const checks = [];
const makeRoute = code => ({ rank: 1, distance_m: 360, estimated_minutes: 5,
  segment_codes: [0,1,2].map(i => `${code}_${i}`),
  segments: [0,1,2].map(i => ({segment_code:`${code}_${i}`, name:`合成路段${i+1}`, length_m:120,
    width_m:2, step_count:0, geometry_coordinates:[[106.3+i/1000,29.6],[106.301+i/1000,29.6]]})) });

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
  let heldCompletion = null, releaseCompletion;
  await context.route('**/*', async request => {
    const url = new URL(request.request().url());
    if (url.pathname.startsWith('/api/')) {
      requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams),
        method: request.request().method(), body: request.request().postDataJSON() });
      if (url.pathname.endsWith('/pois')) return request.fulfill({ json: ['A', 'B', 'C'].map(name => ({ name })) });
      if (url.pathname.includes('/pilot-areas/')) return request.fulfill({ status: 503, json: {} });
      if (url.pathname.endsWith('/geojson')) return request.fulfill({ json: { features: [] } });
      if (url.pathname.endsWith('/navigation') && request.request().postDataJSON()?.status === 'COMPLETED' && heldCompletion) {
        const wait = heldCompletion; heldCompletion = null; await wait;
        return request.fulfill({status:503,json:{}});
      }
      if (url.pathname.endsWith('/recommend')) {
        const code = url.searchParams.has('exclude_segment_code') ? 'DETOUR'
          : url.searchParams.get('start_name') === 'B' ? 'RETURN_ONLY' : 'OUT';
        return request.fulfill({ json: { ...Object.fromEntries(url.searchParams), routes: [makeRoute(code), makeRoute(code+'ALT')],
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
  return { page, requests, plan, start, finish, close,
    holdCompletion() { heldCompletion = new Promise(resolve => { releaseCompletion = resolve; }); },
    releaseCompletion() { releaseCompletion(); } };
}
const writes = requests => requests.filter(r => r.method !== 'GET');

try {
  for (const role of ['guest','elder']) for (const outcome of ['我已到达（本人确认）','结束但未确认到达']) {
    const app=await setup(role), {page,requests}=app;
    await app.plan(); await app.start();
    const trigger=page.getByRole('button',{name:'结束导航',exact:true});
    await trigger.click(); await expect(page.getByRole('button',{name:'继续导航',exact:true})).toBeFocused();
    await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
    await trigger.click(); await page.getByRole('button',{name:'关闭结束确认',exact:true}).click(); await expect(trigger).toBeFocused();
    await page.getByRole('button',{name:'查看路线方案',exact:true}).click();
    await expect(page.getByTestId('arrival-receipt')).toHaveCount(0);
    await app.start();
    await page.getByRole('button',{name:'已走完这段',exact:true}).click();
    await page.getByRole('button',{name:'上一段',exact:true}).click();
    await page.getByRole('button',{name:'已走完这段',exact:true}).click();
    await expect(page.getByTestId('manual-confirmed-count')).toContainText('手动标记确认了 1 段 / 共 3 段');
    await expect(page.getByTestId('manual-confirmed-count')).toContainText('当前正在走第 2 段');
    const before=writes(requests).length;
    await trigger.click();
    const dialog=page.getByRole('dialog');
    await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button',{name:'关闭结束确认',exact:true})).toBeFocused();
    await page.keyboard.press('Tab'); await expect(dialog.getByRole('button',{name:'继续导航',exact:true})).toBeFocused();
    await page.evaluate(() => {document.documentElement.style.fontSize='150%';});
    let size=await page.evaluate(()=>({s:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
    assert.ok(size.s<=size.c+1,JSON.stringify(size));
    await dialog.getByRole('button',{name:outcome,exact:true}).evaluate(button=>{button.click();button.click();});
    const receipt=page.getByTestId('arrival-receipt');
    await expect(receipt).toContainText(outcome); await expect(receipt).toContainText('手动标记确认了 1 段 / 共 3 段');
    await expect(page.getByTestId('return-journey')).toBeVisible();
    size=await page.evaluate(()=>({s:document.documentElement.scrollWidth,c:document.documentElement.clientWidth}));
    assert.ok(size.s<=size.c+1,JSON.stringify(size));
    if(role==='elder') {
      await expect.poll(()=>writes(requests).filter(r=>r.body?.status==='COMPLETED').length).toBe(1);
      const body=writes(requests).find(r=>r.body?.status==='COMPLETED').body;
      assert.equal(body.current_step,'用户已结束导航，是否到达请本人确认。');
      assert.deepEqual(Object.keys(body).sort(),['start_name','end_name','distance_m','remaining_m','estimated_minutes','current_step','route_summary','status','snapshot_revision'].sort());
    } else assert.equal(writes(requests).length,0);
    assert.ok(writes(requests).length<=before+1);
    if(saveArtifacts && role==='guest' && outcome.startsWith('我')) await page.screenshot({path:output+'/arrival-320-150.png',fullPage:true});
    await app.close(`${role}: ${outcome}, keyboard cancel/focus/trap, deduplicated 1/3, double-submit, return, 320/150, unchanged sync`);
  }
  for(const boundary of ['route','identity','leave','new','reload']) {
    const app=await setup(),{page}=app; await app.plan(); await app.start(); await app.finish('我已到达（本人确认）');
    await expect(page.getByTestId('arrival-receipt')).toContainText('0 段 / 共 3 段');
    if(boundary==='route') await page.evaluate(async()=>{(await import('/src/composables/useRoutePlanner.js')).useRoutePlanner().selectRoute(1);});
    if(boundary==='identity') await page.evaluate(async()=>{(await import('/src/composables/useAuthSession.js')).useAuthSession().enterGuestMode();});
    if(boundary==='leave') {await page.evaluate(()=>{location.hash='/elder/home';}); await expect(page.getByRole('button',{name:'查询适合的路线',exact:true})).toBeVisible(); await page.evaluate(()=>{location.hash='/elder/routes';});}
    if(boundary==='new') {await app.start();await page.getByRole('button',{name:'查看路线方案',exact:true}).click();}
    if(boundary==='reload') await page.reload();
    await expect(page.getByTestId('arrival-receipt'),boundary).toHaveCount(0);
    await app.close(`receipt cleared: ${boundary}; zero-segment arrival independent`);
  }
  const app=await setup(),{page}=app;await app.plan();await app.start();
  await page.getByRole('button',{name:'已走完这段',exact:true}).click();
  await page.getByRole('button',{name:'已走完这段',exact:true}).click();
  await page.getByRole('button',{name:'手动确认最后一段已走完',exact:true}).click();
  await app.finish();await expect(page.getByTestId('arrival-receipt')).toContainText('3 段 / 共 3 段');
  await expect(page.getByTestId('arrival-receipt')).toContainText('结束但未确认到达');
  await app.close('all manual segments confirmed does not infer arrival');
  const late=await setup('elder');await late.plan();await late.start();late.holdCompletion();
  await late.finish('我已到达（本人确认）');
  await late.start();await late.finish('结束但未确认到达');
  const latest=late.page.getByTestId('arrival-receipt');
  await expect(latest).toContainText('结束但未确认到达');
  late.releaseCompletion();
  await expect.poll(()=>writes(late.requests).filter(r=>r.body?.status==='COMPLETED').length).toBe(2);
  await expect(latest).toContainText('结束但未确认到达');
  await expect(late.page.locator('.route-options-list > .status-line').first()).not.toContainText('暂未同步');
  await late.close('late failed old completion cannot replace a newer receipt or status');
  console.log(`PASS ${checks.length} arrival receipt browser scenarios; all API mocked; GPS/speech/external=0.`);
} finally {await browser.close();await server.close();}
