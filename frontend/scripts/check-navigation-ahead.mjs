import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { wgs84ToGcj02 } from '../src/services/navigationJourney.js';

// All places, road registrations, speech and GPS below are synthetic and local.
const frontend = fileURLToPath(new URL('../', import.meta.url));
const screenshots = fileURLToPath(new URL('../../artifacts/navigation-ahead/', import.meta.url));
const saveArtifacts = !process.argv.includes('--no-artifacts');
const places = ['师大苑大学城西路入口', '师大苑荷塘水景休息区'];
const points = [[106.305,29.601],[106.3055,29.601],[106.306,29.601],[106.3068,29.601],[106.307,29.601]]
  .map(point => wgs84ToGcj02(...point));
const area = { center:points[1], min_zoom:16, max_zoom:20,
  limit_bounds:{south_west:[106.29,29.59],north_east:[106.33,29.62]},
  boundary:{coordinates:[[[106.29,29.59],[106.33,29.59],[106.33,29.62],[106.29,29.62],[106.29,29.59]]]}};

function fixture({ fourLegs = false, missingTotal = false, missingSteps = false, geometry = 'valid', evidence = 'positive', width = 1.8 } = {}) {
  const codes = fourLegs ? ['A','B','C','D'] : ['A','B','C'];
  const segments = codes.map((segment_code,i) => ({ segment_code,
    name:['合成入口步道','合成中间步道','合成台阶路段','合成台阶后步道'][i],
    length_m:[73.63,86,174,40][i], step_count:[0,0,7,0][i], width_m:width,
    risk_tags:[], wheelchair_accessible:i!==2 }));
  if (missingSteps) delete segments[0].step_count;
  if (evidence === 'zero') segments.forEach(row => { row.step_count = 0; });
  if (evidence === 'mixed') segments.forEach((row,i) => { row.step_count = i === 1 ? null : 0; });
  if (evidence === 'missing') segments.forEach(row => { delete row.step_count; delete row.width_m; });
  if (evidence === 'invalid') segments.forEach((row,i) => { row.step_count = ['0',-1,1.5][i]; });
  const data = { rank:1, distance_m:fourLegs ? 373.63 : 333.63, estimated_minutes:9,
    summary:'本地合成验收路线', segment_codes:codes, segments,
    navigation_rest:{version:1,source:'ACTIVE_REST_AREA_LINKED_NODES/v1',segment_codes:codes,
      node_codes:fourLegs ? ['source','one','rest','three','end'] : ['source','one','rest','end'],
      segment_lengths_m:segments.map(row=>row.length_m),
      stops:[{node_index:2,node_code:'rest',name:'合成中途座椅'}]}};
  if (missingTotal) delete data.distance_m;
  const features = segments.map((row,i) => ({type:'Feature',properties:{...row,kind:'segment'},
    geometry:{type:'LineString',coordinates:[points[i],points[i+1]]}}));
  if (geometry === 'invalid') features[2].geometry = {type:'LineString',coordinates:[[null,29],[106,29]]};
  if (geometry === 'ambiguous') features.push(structuredClone(features[2]));
  return {data,features};
}

function installMocks() {
  const audit = window.__aheadAudit = {cameras:[],instances:[],overlays:[],watchCount:0,clearCount:0,
    serial:0,spoken:[],cancels:0};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[{lang:'zh-CN',localService:true}],
    speak:utterance=>audit.spoken.push(utterance.text),cancel:()=>audit.cancels++}});
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text=text; } };
  Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
    watchPosition(ok,bad) {audit.watchCount++;audit.ok=ok;audit.bad=bad;return audit.watchCount;},
    clearWatch() {audit.clearCount++;}}});
  class Emitter {
    constructor(options={}) {this.options=options;this.handlers={};}
    on(name,fn) {(this.handlers[name] ||= new Set()).add(fn);}
    off(name,fn) {this.handlers[name]?.delete(fn);}
  }
  class Overlay extends Emitter {
    setOptions(options) {Object.assign(this.options,options);}
    setPosition(point) {this.options.position=point;}
    setRadius(radius) {this.options.radius=radius;}
    setCenter(point) {this.options.center=point;}
    setPath(path) {this.options.path=path;}
  }
  class Polyline extends Overlay {constructor(options) {super(options);audit.overlays.push(this);}}
  class Map extends Emitter {
    constructor(element) {super();this.element=element;this.items=[];this.zoom=17;audit.instances.push(this);}
    setLimitBounds() {} addControl() {} resize() {}
    add(items) {this.items.push(...[items].flat());}
    remove(items) {this.items=this.items.filter(item=>![items].flat().includes(item));}
    getZoom() {return this.zoom;}
    setFitView(items) {audit.cameras.push({op:'fit',codes:[items].flat().map(item=>item.options.extData?.segmentCode).filter(Boolean)});}
    setZoomAndCenter(zoom,point) {this.zoom=zoom;audit.cameras.push({op:'center',point});}
    setCenter(point) {audit.cameras.push({op:'center',point});}
    panTo(point) {this.setCenter(point);}
    destroy() {this.destroyed=true;}
  }
  window.__aheadAmap = {Map,Polyline,Polygon:Overlay,Circle:Overlay,Marker:Overlay,Bounds:Overlay,Scale:Overlay,ToolBar:Overlay};
}

const server = await createServer({root:frontend,configFile:false,envDir:false,plugins:[vue()],
  server:{host:'127.0.0.1',port:0,watch:null,hmr:false,ws:false},
  optimizeDeps:{noDiscovery:true,include:[]}});
let browser;
const contexts = new Set();
const audits = [];
const button = (page,name) => page.getByRole('button',{name,exact:true});
const tick = page => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const spoken = page => page.evaluate(()=>window.__aheadAudit.spoken.length);
const centers = page => page.evaluate(()=>window.__aheadAudit.cameras.filter(item=>item.op==='center').length);
const cancelled = page => page.evaluate(()=>window.__aheadAudit.cancels);
const stair = page => page.getByTestId('navigation-stairs');
const focusStairs = page => page.getByRole('button',{name:'查看台阶所在登记路段',exact:true,includeHidden:true});
const hear = page => button(page,'听前方情况');

async function setup(mode,options={}) {
  const context = await browser.newContext({viewport:{width:320,height:740},serviceWorkers:'block'});
  contexts.add(context);
  context.setDefaultTimeout(10000);
  const audit = {mode,options,external:[],errors:[],writes:[]};
  audits.push(audit);
  const {data,features} = fixture(options);
  // Install the single strict network boundary before creating or navigating a page.
  await context.route('**/*',async route => {
    const request=route.request(), target=new URL(request.url());
    if (!['http:','https:'].includes(target.protocol)
        || !['127.0.0.1','localhost','[::1]','::1'].includes(target.hostname)) {
      audit.external.push(request.url());
      return route.abort('blockedbyclient');
    }
    if (/^\/src\/services\/amapLoader(?:\.js)?$/.test(target.pathname)) {
      return route.fulfill({contentType:'application/javascript',body:mode==='fallback'
        ? 'export async function loadAmap(){throw new Error("local forced fallback");}'
        : 'export async function loadAmap(){return window.__aheadAmap;}'});
    }
    if (target.pathname.startsWith('/api/')) {
      if (!['GET','HEAD','OPTIONS'].includes(request.method())) audit.writes.push({method:request.method(),path:target.pathname});
      const path=target.pathname;
      const value=path.endsWith('/pois') ? places.map(name=>({name}))
        : path.includes('/pilot-areas/') ? area : path.endsWith('/geojson') ? {features}
          : path.endsWith('/recommend') ? {routes:[data],avoided_segments:[]}
            : path.endsWith('/sites') ? [] : {suggestions:[]};
      return route.fulfill({json:value,headers:{'access-control-allow-origin':'*'}});
    }
    return route.continue();
  });
  await context.addInitScript(installMocks);
  const page=await context.newPage();
  page.on('pageerror',error=>audit.errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/#/elder/home`);
  await page.getByLabel('选择出发地点',{exact:true}).selectOption(places[0]);
  await page.getByLabel('选择目的地',{exact:true}).selectOption(places[1]);
  await button(page,'查询适合的路线').click();
  await button(page,'开始导航').click();
  await stair(page).waitFor();
  await (mode==='sdk' ? page.locator('.amap-route-map') : page.locator('.navigation-schematic svg')).waitFor();
  await tick(page);
  assert.equal(await spoken(page),0,'navigation must never start speech');
  return {page,audit,async close(){await context.close();contexts.delete(context);}};
}

async function sample(page,longitude=106.3052,accuracy=6) {
  await page.evaluate(([longitude,accuracy])=>{const a=window.__aheadAudit;
    if(!a.ok)throw new Error('GPS mock was not enabled');
    a.ok({coords:{longitude,latitude:29.601,accuracy},timestamp:Date.now()+(++a.serial)});
  },[longitude,accuracy]);
  await tick(page);
}
async function state(page,audit) {
  return {current:await page.locator('.journey-current h2').innerText(),
    remaining:await page.getByTestId('manual-remaining').innerText(),
    rest:await page.getByTestId('navigation-rest-message').innerText(),
    stairs:await stair(page).textContent(),writes:audit.writes.length,
    watchCount:await page.evaluate(()=>window.__aheadAudit.watchCount)};
}
async function layout(page,mode) {
  if (!await stair(page).evaluate(node=>node.open)) await stair(page).locator('summary').click();
  const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
  assert.ok(sizes.scroll<=sizes.client+1,`${mode} overflows 320px: ${JSON.stringify(sizes)}`);
  for (const control of [focusStairs(page),hear(page)]) {
    const box=await control.boundingBox();
    assert.ok(box && box.width>=48 && box.height>=48,`${mode} new action must be at least 48px`);
  }
}
async function checkHighlight(page,mode) {
  if (mode==='fallback') {
    const target=page.locator('svg .nav-inspection');
    await expect(target).toHaveCount(1);
    await expect(target).toHaveAttribute('aria-label',/合成台阶路段.*临时查看/);
    await expect(page.locator('svg [aria-current="step"]')).toHaveAttribute('aria-label',/合成入口步道/);
  } else {
    const result=await page.evaluate(()=>{const a=window.__aheadAudit,m=a.instances.findLast(map=>!map.destroyed);
      return {last:a.cameras.at(-1),color:m.items.find(item=>item.options.extData?.segmentCode==='C')?.options.strokeColor};});
    assert.deepEqual(result.last,{op:'fit',codes:['C']},'fit the registered target segment only');
    assert.equal(result.color,'#c26413','target gets the inspection highlight');
  }
}

try {
  await server.listen();
  browser=await chromium.launch({channel:'chrome',headless:true});
  if (saveArtifacts) await mkdir(screenshots,{recursive:true});
  for (const mode of ['sdk','fallback']) {
    const run=await setup(mode), {page,audit}=run;
    await expect(stair(page)).toContainText('前方登记台阶');
    await expect(stair(page)).toContainText('第 3 段');
    await expect(stair(page)).toContainText('7 级');
    await expect(stair(page)).toContainText('159.63 米');
    await expect(stair(page)).toContainText('不是距实际台阶位置的距离');
    await expect(stair(page)).toContainText('已登记最先');
    await expect(stair(page)).toContainText('前面路段台阶资料未确认，不能确认无台阶');
    await expect(page.locator('.journey-current')).toContainText('登记路宽：1.8 米；现场可用宽度未确认');
    await layout(page,mode);
    await page.evaluate(()=>document.documentElement.style.fontSize='150%');
    await tick(page);
    await layout(page,`${mode} enlarged map`);
    if (saveArtifacts) await page.screenshot({path:`${screenshots}/${mode}-map-enlarged320.png`,fullPage:true});
    await button(page,'开启我的位置').click();
    await sample(page);
    const recovery=page.getByTestId('navigation-recovery');
    await expect(recovery).toHaveCount(0);
    const beforeRecovery=await state(page,audit);
    await sample(page,106.30525,80);
    await expect(recovery).toContainText('定位精度较低');
    await recovery.getByRole('button',{name:'查看本段登记地图',exact:true}).click();
    await recovery.getByRole('button',{name:'按本段文字继续',exact:true}).click();
    await expect(page.locator('#optional-navigation-map')).toHaveCount(0);
    assert.deepEqual(await state(page,audit),beforeRecovery,'recovery map/text actions preserve segment, stairs, rest, distance, writes and watches');
    assert.equal(await spoken(page),0,'recovery does not speak');
    await button(page,'累了，休息一下').click();
    await expect(hear(page)).toBeDisabled();
    await expect(recovery).toHaveCount(0);
    await expect(stair(page)).toHaveCount(0);
    await button(page,'继续前行').click();
    assert.deepEqual(await state(page,audit),beforeRecovery,'rest resumes the same manual segment');
    await expect(recovery).toBeVisible();
    await sample(page,106.3052);
    await expect(recovery).toHaveCount(0);
    await button(page,'地图导航').click();
    await page.locator('#optional-navigation-map').waitFor();
    await button(page,'回到当前位置并跟随').click();
    await tick(page);
    const before=await state(page,audit);
    if (!await stair(page).evaluate(node=>node.open)) await stair(page).locator('summary').click();
    await focusStairs(page).click();
    await tick(page);
    await checkHighlight(page,mode);
    assert.deepEqual(await state(page,audit),before,'inspection must not advance progress or change rest, distance, writes or watches');
    const count=await centers(page);
    await sample(page,106.3053);
    assert.equal(await centers(page),count,'a later GPS sample must not restore following');
    await expect(page.getByTestId('map-follow-state')).toContainText('正在查看含台阶的登记路段');
    await button(page,'文字导航').click();
    await expect(page.locator('#optional-navigation-map')).toHaveCount(0);
    await layout(page,`${mode} enlarged text`);
    if (saveArtifacts) await page.screenshot({path:`${screenshots}/${mode}-text-enlarged320.png`,fullPage:true});
    if (!await stair(page).evaluate(node=>node.open)) await stair(page).locator('summary').click();
    await focusStairs(page).click();
    await page.locator('#optional-navigation-map').waitFor();
    await tick(page);
    await checkHighlight(page,mode);
    assert.deepEqual(await state(page,audit),before,'text-to-map inspection preserves navigation state');
    await hear(page).click();
    await expect(page.getByTestId('navigation-ahead-summary')).toContainText('合成台阶路段');
    await expect(page.getByTestId('navigation-ahead-summary')).toContainText('合成中途座椅');
    const stairFact = await stair(page).locator('.journey-stair-fact').innerText();
    assert.ok((await page.getByTestId('navigation-ahead-summary').innerText()).startsWith(stairFact));
    assert.equal(await page.evaluate(()=>window.__aheadAudit.spoken.at(-1)),
      await page.getByTestId('navigation-ahead-summary').innerText());
    assert.equal(await spoken(page),1,'one click speaks exactly once');
    await expect(button(page,'开启语音提示')).toHaveAttribute('aria-pressed','false');
    await button(page,'停止播报').click();
    assert.equal(await spoken(page),1);
    await button(page,'已走完这段').click();
    await expect(stair(page)).toContainText('86 米');
    assert.equal(await spoken(page),1,'manual advance must not enable automatic speech');
    await button(page,'已走完这段').click();
    await expect(stair(page)).toHaveAttribute('data-state','current');
    await expect(stair(page)).toContainText('本段登记 7 级台阶');
    assert.doesNotMatch(await stair(page).innerText(),/\d+(?:\.\d+)?\s*米/,'current stairs have no fabricated distance');
    assert.equal(await spoken(page),1);
    await hear(page).click();
    let cancellation=await cancelled(page);
    await button(page,'累了，休息一下').click();
    await expect(hear(page)).toBeDisabled();
    await expect(stair(page)).toHaveCount(0);
    await expect(page.getByTestId('navigation-ahead-summary')).toHaveCount(0);
    assert.ok(await cancelled(page)>cancellation,'rest cancels active speech');
    const pausedSpeech=await spoken(page);
    await sample(page,106.3054);
    assert.equal(await spoken(page),pausedSpeech,'no hidden speech while resting');
    await button(page,'继续前行').click();
    await hear(page).click();
    cancellation=await cancelled(page);
    await button(page,'结束导航').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(hear(page)).toBeDisabled();
    await expect(stair(page)).toHaveCount(0);
    assert.ok(await cancelled(page)>cancellation,'exit confirmation cancels speech');
    await button(page,'结束但未确认到达').click();
    await expect(stair(page)).toHaveCount(0);
    assert.equal(await spoken(page),pausedSpeech+1,'resume and exit never play hidden speech');
    await run.close();
  }
  for (const options of [{missingTotal:true},{missingSteps:true},{geometry:'invalid'},{geometry:'ambiguous'}]) {
    const run=await setup('fallback',options), {page}=run;
    await expect(stair(page)).toContainText('7 级');
    if (options.missingTotal) {
      await expect(stair(page)).toContainText('登记路程暂未确认');
      assert.doesNotMatch(await stair(page).innerText(),/159\.63\s*米/);
      await hear(page).click();
      await expect(page.getByTestId('navigation-ahead-summary')).toContainText('登记路程暂未确认');
    }
    if (options.missingSteps) {
      await expect(stair(page)).toContainText('已登记最先');
      await expect(stair(page)).toContainText('前面路段台阶资料未确认');
    }
    if (options.geometry) {
      await expect(focusStairs(page)).toBeDisabled();
      await expect(stair(page)).toContainText('登记图形缺失、无效或有歧义');
      await expect(stair(page)).toContainText('159.63 米');
    }
    assert.equal(await spoken(page),options.missingTotal ? 1 : 0);
    await run.close();
  }
  const passed=await setup('fallback',{fourLegs:true});
  for (let i=0;i<3;i++) await button(passed.page,'已走完这段').click();
  await expect(passed.page.locator('.journey-current h2')).toHaveText('合成台阶后步道');
  await expect(stair(passed.page)).toHaveAttribute('data-state','none');
  await expect(focusStairs(passed.page)).toHaveCount(0);
  await hear(passed.page).click();
  await expect(passed.page.getByTestId('navigation-ahead-summary')).toContainText('前方未标注台阶，不能确认无台阶，请核对现场');
  await passed.close();
  const unmarked = '前方未标注台阶，不能确认无台阶，请核对现场';
  for (const mode of ['sdk','fallback']) for (const options of [
    {evidence:'zero',width:1.50}, {evidence:'mixed',width:1.50},
    {evidence:'missing',width:null}, {evidence:'invalid',width:0},
    {evidence:'zero',width:'1.50'}, {evidence:'zero',width:1.8},
  ]) {
    const run=await setup(mode,options), {page,audit}=run;
    await expect(stair(page)).toHaveAttribute('data-state',options.evidence === 'zero' ? 'none' : 'unknown');
    assert.equal(await stair(page).evaluate(node=>node.tagName),'P','unconfirmed evidence is plain visible text');
    await expect(stair(page)).toContainText(unmarked);
    await expect(focusStairs(page)).toHaveCount(0);
    const current=page.locator('.journey-current');
    await expect(current).toContainText(options.evidence === 'missing' || options.evidence === 'invalid'
      ? '台阶数量未记录或资料无效' : '本段台阶数量未确认');
    if (options.width === 1.50) {
      await expect(current).toContainText('登记路宽：1.5 米（可能为默认值）；现场可用宽度未确认');
    } else if (options.width === 1.8) {
      await expect(current).toContainText('登记路宽：1.8 米；现场可用宽度未确认');
      assert.doesNotMatch(await current.innerText(),/登记路宽：[^。]*默认值/);
    } else await expect(current).toContainText('有效正路宽未记录');
    const before=await state(page,audit);
    const fact=await stair(page).innerText();
    await hear(page).click();
    const summary=await page.getByTestId('navigation-ahead-summary').innerText();
    assert.ok(summary.startsWith(fact));
    assert.equal(await page.evaluate(()=>window.__aheadAudit.spoken.at(-1)),summary);
    assert.equal(await spoken(page),1);
    assert.doesNotMatch(summary,/均为 0|登记 0 级|没有台阶|可以通行/);
    await expect(button(page,'开启语音提示')).toHaveAttribute('aria-pressed','false');
    assert.deepEqual(await state(page,audit),before,'one-shot speech preserves route, progress and GPS state');
    await button(page,'慢一点，只听这一段').click();
    const brief=await page.getByTestId('navigation-current-brief-text').innerText();
    assert.match(brief,/本段台阶数量未确认/); assert.doesNotMatch(brief,/0 级/);
    assert.equal(await page.evaluate(()=>window.__aheadAudit.spoken.at(-1)),brief);
    assert.equal(await spoken(page),2);
    await page.evaluate(()=>document.documentElement.style.fontSize='150%');
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    assert.ok(sizes.scroll<=sizes.client+1,`${mode} ${options.evidence} evidence overflows`);
    await button(page,'已走完这段').click();
    await expect(page.locator('.journey-current h2')).toHaveText('合成中间步道');
    await expect(page.getByTestId('manual-remaining')).toContainText('260 米');
    assert.equal(await spoken(page),2,'manual advance never enables speech');
    assert.equal(await page.evaluate(()=>window.__aheadAudit.watchCount),0);
    assert.deepEqual(audit.writes,[]);
    await run.close();
  }
  for (const audit of audits) {
    assert.deepEqual(audit.external,[],`external requests attempted: ${JSON.stringify(audit)}`);
    assert.deepEqual(audit.errors,[],`page errors: ${JSON.stringify(audit)}`);
  }
  console.log('PASS navigation ahead: ordered positive stairs, qualified entry distances, legacy zero/mixed/missing/invalid evidence, default/registered/invalid widths, matching local one-shot speech, read-only SDK/SVG inspection, pause/exit, 320px and 150% text.');
  if (saveArtifacts) console.log(`Screenshots: ${screenshots}`);
} catch (error) {
  console.error('Navigation ahead browser audit:',JSON.stringify(audits));
  throw error;
} finally {
  for (const context of contexts) await context.close();
  await browser?.close();
  await server.close();
}
