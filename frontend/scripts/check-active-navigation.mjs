import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdir, writeFile } from 'node:fs/promises';

// Isolated local component UI. Mock AMap SDK, speech and GPS; no backend/hardware.
const output='../artifacts/navigation-validation/browser';
await mkdir(output,{recursive:true});
const server=await createServer({configFile:false,envDir:false,plugins:[vue(),{name:'synthetic-navigation-fixture',configureServer(server){
  server.middlewares.use('/__navigation_fixture',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/scripts/fixtures/navigation-map-fixture.js"></script></body></html>');});
}}],server:{host:'127.0.0.1',port:0,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
await server.listen();
const base=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await chromium.launch({channel:process.env.UI_BROWSER||'chrome',headless:true});
const results=[];
try {
  for(const provider of ['amap-mock','fallback']) {
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.addInitScript(()=>{
      window.__maps=[];window.__roads=[];window.__watches=0;window.__cleared=0;window.__spoken=[];
      Object.defineProperty(navigator,'geolocation',{value:{watchPosition(success,error){window.__gps=success;window.__gpsError=error;window.__watches++;return 1;},clearWatch(){window.__cleared++;}}});
      Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},getVoices:()=>[],speak:u=>window.__spoken.push(u.text)}});
      window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
      class Overlay {constructor(options){this.options=options;this.handlers={};}setOptions(o){Object.assign(this.options,o);}on(name,callback){this.handlers[name]=callback;}setPosition(p){this.options.position=p;}setCenter(p){this.options.center=p;}setRadius(r){this.options.radius=r;}}
      class Map {constructor(){this.cameras=[];this.destroyed=false;window.__maps.push(this);}setLimitBounds(){}addControl(){}add(){}remove(){}setFitView(overlays){this.cameras.push({kind:'fit',codes:overlays.map(o=>o.options.extData?.segmentCode).filter(Boolean)});}setZoomAndCenter(zoom,point){this.cameras.push({kind:'position',point:[...point]});}destroy(){this.destroyed=true;}}
      class Polyline extends Overlay {constructor(options){super(options);window.__roads.push(this);}}
      window.__sdk={Map,Polyline,Polygon:Overlay,Marker:Overlay,Circle:Overlay,Bounds:Overlay,Scale:Overlay,ToolBar:Overlay};
    });
    const page=await context.newPage();const errors=[];const external=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(url.startsWith(base+'/src/services/amapLoader')) return route.fulfill({contentType:'application/javascript',body:'export const loadAmap=()=>Promise.resolve(window.__sdk);'});
      if(url.startsWith(base)) return route.continue();
      external.push(url);return route.abort();
    });
    await page.goto(base+'/__navigation_fixture'+(provider==='fallback'?'?fallback':''));
    await page.getByRole('heading',{name:'逐段地图导航',exact:true}).waitFor();
    await page.locator(provider==='fallback'?'.campus-map':'.amap-route-map').waitFor();
    assert.equal(await page.evaluate(()=>window.__watches),0);
    assert.equal(await page.evaluate(()=>window.__spoken.length),0);
    await page.getByRole('button',{name:'文字导航',exact:true}).click();
    assert.equal(await page.locator('#optional-navigation-map').count(),0);
    await page.getByRole('button',{name:'地图导航',exact:true}).click();
    await page.getByRole('button',{name:'开启我的位置',exact:true}).click();
    const fix=async(change={})=>page.evaluate(change=>{const timestamp=Math.max(Date.now(),(window.__lastFix||0)+1);window.__lastFix=timestamp;window.__gps({coords:{longitude:10.0005,latitude:10.0005,accuracy:10,...change.coords},timestamp:timestamp+(change.age||0)});},change);
    await fix();await page.getByTestId('map-follow-state').filter({hasText:'正在跟随'}).waitFor();
    // Regression: replaying a programmatic current focus on remount is not browsing.
    await page.getByRole('button',{name:'查看当前路段',exact:true}).click();
    await page.getByRole('button',{name:'关闭定位',exact:true}).click();
    await page.getByRole('button',{name:'开启我的位置',exact:true}).click();await fix();
    await page.getByRole('button',{name:'文字导航',exact:true}).click();
    await page.getByRole('button',{name:'地图导航',exact:true}).click();
    await page.getByTestId('map-follow-state').filter({hasText:'正在跟随'}).waitFor();
    if(provider==='amap-mock') {
      assert.deepEqual(await page.evaluate(()=>window.__maps.at(-1).cameras.at(-1).point),[10.0005,10.0005]);
      // Camera methods have no input events; a second fix remains in follow.
      await fix();assert.match(await page.getByTestId('map-follow-state').innerText(),/正在跟随/);
      await page.locator('.amap-route-map').dispatchEvent('pointerdown',{clientX:20,clientY:20});
      await page.locator('.amap-route-map').dispatchEvent('pointermove',{clientX:60,clientY:60});
      await page.getByTestId('map-follow-state').filter({hasText:'已停止跟随'}).waitFor();
      const count=await page.evaluate(()=>window.__maps.at(-1).cameras.length);
      await fix();assert.equal(await page.evaluate(()=>window.__maps.at(-1).cameras.length),count);
      await page.getByRole('button',{name:'回到当前位置并跟随',exact:true}).click();
      await page.getByTestId('map-follow-state').filter({hasText:'正在跟随'}).waitFor();
      await page.locator('.amap-route-map').dispatchEvent('wheel',{deltaY:-100});
      await page.getByTestId('map-follow-state').filter({hasText:'已停止跟随'}).waitFor();
      await page.getByRole('button',{name:'回到当前位置并跟随',exact:true}).click();
    } else assert.match(await page.locator('.fallback-map-note').first().innerText(),/固定示意图，不平移或缩放/);
    for(const change of [{coords:{accuracy:80}},{age:-16001},{coords:{longitude:11,latitude:11}}]) {
      const count=await page.evaluate(()=>window.__maps.at(-1)?.cameras.length||0);
      await fix(change);assert.equal(await page.getByRole('button',{name:'回到当前位置并跟随'}).isDisabled(),true);
      assert.equal(await page.evaluate(()=>window.__maps.at(-1)?.cameras.length||0),count);
    }
    assert.match(await page.locator('.journey-map-controls').innerText(),/覆盖范围/);
    await page.evaluate(()=>window.__gpsError({code:1}));
    assert.match(await page.locator('.journey-map-controls').innerText(),/定位权限未开启/);
    assert.equal(await page.evaluate(()=>window.__watches),2);
    assert.equal(await page.evaluate(()=>window.__cleared),2);
    await page.getByRole('button',{name:'已走完这段',exact:true}).click();
    assert.match(await page.locator('.journey-current h2').innerText(),/合成测试段乙/);
    const routeStates=async()=>provider==='fallback' ? page.locator('[data-route-state]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-route-state'))) : page.evaluate(()=>window.__roads.slice(-3).map(r=>({color:r.options.strokeColor,width:r.options.strokeWeight,dash:r.options.strokeDasharray})));
    if(provider==='fallback') assert.deepEqual(await routeStates(),['completed','current','upcoming']);
    else assert.deepEqual(await routeStates(),[{color:'#607d73',width:7,dash:[4,6]},{color:'#176b57',width:12,dash:[12,8]},{color:'#477eab',width:7,dash:[12,8]}]);
    const progressCount=await page.evaluate(()=>window.__navFixture.events.filter(e=>e.progress).length);
    await page.getByRole('button',{name:'查看全程',exact:true}).click();
    assert.match(await page.getByTestId('map-follow-state').innerText(),/浏览全程/);
    if(provider==='fallback') await page.locator('[data-route-state="upcoming"]').click();
    else await page.evaluate(()=>window.__roads.at(-1).handlers.click());
    assert.match(await page.getByTestId('map-follow-state').innerText(),/当前路段未改变/);
    assert.equal(await page.evaluate(()=>window.__navFixture.events.filter(e=>e.progress).length),progressCount);
    assert.match(await page.locator('.journey-current h2').innerText(),/合成测试段乙/);
    await page.getByRole('button',{name:'查看当前路段',exact:true}).click();
    await page.getByRole('button',{name:'上一段',exact:true}).click();
    if(provider==='fallback') assert.deepEqual(await routeStates(),['current','upcoming','upcoming']);
    else assert.equal((await routeStates())[0].width,12);
    assert.match(await page.getByRole('list',{name:'路线进度图例'}).innerText(),/短虚线.*手动确认完成/);
    await page.getByRole('button',{name:'开启语音提示',exact:true}).click();
    const beforePreview=await page.evaluate(()=>({progress:window.__navFixture.events.filter(e=>e.progress).length,speech:window.__spoken.length}));
    const currentText=await page.locator('.journey-current').innerText();
    const locationText=await page.locator('.journey-map-controls .journey-location').innerText();
    await page.getByRole('button',{name:'预览下一段',exact:true}).click();
    await page.getByRole('heading',{name:'下一登记路段：合成测试段乙',exact:true}).waitFor();
    assert.match(await page.locator('#next-segment-preview').innerText(),/3 级.*不能据此确认可通行/);
    assert.match(await page.locator('#next-segment-preview').innerText(),/合成登记风险/);
    assert.equal(await page.locator('.journey-current').innerText(),currentText);
    assert.equal(await page.locator('.journey-map-controls .journey-location').innerText(),locationText);
    assert.deepEqual(await page.evaluate(()=>({progress:window.__navFixture.events.filter(e=>e.progress).length,speech:window.__spoken.length})),beforePreview);
    if(provider==='amap-mock') assert.deepEqual(await page.evaluate(()=>window.__maps.at(-1).cameras.at(-1).codes),['b']);
    else assert.equal(await page.locator('.nav-inspection').getAttribute('aria-label'),'合成测试段乙：尚未确认完成，临时查看，不计进度');
    await page.getByRole('button',{name:'返回当前路段',exact:true}).click();
    assert.equal(await page.locator('#next-segment-preview').count(),0);
    await page.getByRole('button',{name:'开启我的位置',exact:true}).click();await fix();
    await page.getByRole('button',{name:'预览下一段',exact:true}).click();
    await page.getByRole('button',{name:'返回位置跟随',exact:true}).click();
    await page.getByTestId('map-follow-state').filter({hasText:'正在跟随'}).waitFor();
    await page.getByRole('button',{name:'预览下一段',exact:true}).click();
    await page.getByRole('button',{name:'已走完这段',exact:true}).click();
    assert.equal(await page.locator('#next-segment-preview').count(),0);
    await page.getByRole('button',{name:'预览下一段',exact:true}).click();
    assert.match(await page.locator('#next-segment-preview').innerText(),/台阶数量未记录|其他风险未记录/);
    await page.getByRole('button',{name:'已走完这段',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'预览下一段',exact:true}).isDisabled(),true);
    await page.getByRole('button',{name:'上一段',exact:true}).click();
    // Missing geometry still permits registered text preview, with no camera move.
    await page.evaluate(()=>{window.__navFixture.state.mapFeatures=window.__navFixture.features.filter(f=>f.properties.segment_code!=='c');});
    const camerasBefore=await page.evaluate(()=>window.__maps.at(-1)?.cameras.length||0);
    await page.getByRole('button',{name:'预览下一段',exact:true}).click();
    assert.match(await page.locator('#next-segment-preview').innerText(),/缺少支持的登记图形/);
    assert.equal(await page.evaluate(()=>window.__maps.at(-1)?.cameras.length||0),camerasBefore);
    const layouts=[];
    for(const width of [280,320,390,768,1440]) for(const scale of [100,200]) {
      await page.setViewportSize({width,height:844});
      await page.addStyleTag({content:`html {font-size:${scale}%}`});
      const clipped=await page.locator('.journey-page button, .journey-counter, .journey-mode-switch, .journey-progress, #next-segment-preview, .navigation-schematic-labels').evaluateAll(nodes=>nodes.flatMap(n=>{
        const b=n.getBoundingClientRect();const parent=n.parentElement.getBoundingClientRect();
        return b.x < -1 || b.right > innerWidth+1 || n.scrollWidth>n.clientWidth+1 || b.x<parent.x-1 || b.right>parent.right+1 ? [{text:n.textContent,box:{x:b.x,right:b.right},width:n.clientWidth,scroll:n.scrollWidth}] : [];
      }));
      assert.deepEqual(clipped,[],`${provider}: ${width}px ${scale}%`);
      if(provider==='fallback') assert.ok(await page.locator('.navigation-schematic-labels').evaluate(n=>parseFloat(getComputedStyle(n).fontSize)) >= 18*scale/100);
      layouts.push({width,textPercent:scale,clipped:0});
      if(width===320&&scale===200) await page.screenshot({path:`${output}/${provider}-320-text200.png`,fullPage:true});
    }
    await page.evaluate(()=>{window.__navFixture.state.mapFeatures=[...window.__navFixture.features,window.__navFixture.features[1]];});
    assert.match(await page.locator('.journey-map-controls').innerText(),/当前路段缺少支持的登记图形/);
    if(provider==='fallback') assert.equal(await page.locator('[data-route-state="current"]').count(),0);
    else assert.equal(await page.locator('.navigation-road-label').filter({hasText:'当前'}).count(),0);
    await page.evaluate(()=>{
      const fixture=window.__navFixture;
      fixture.state.selectedRoute={distance_m:30,segment_codes:['new'],segments:[{segment_code:'new',name:'合成替换路段',length_m:30}]};
      fixture.state.mapFeatures=[{properties:{kind:'segment',segment_code:'new',name:'合成替换路段'},geometry:{type:'LineString',coordinates:[[10,10],[10.001,10.001]]}}];
    });
    await page.getByRole('heading',{name:'合成替换路段',exact:true}).waitFor();
    assert.equal(await page.locator('#next-segment-preview').count(),0);
    assert.doesNotMatch(await page.locator('.journey-page').innerText(),/合成测试段/);
    assert.equal(await page.getByRole('button',{name:'开启语音提示',exact:true}).count(),1);
    await page.getByRole('button',{name:'开启我的位置',exact:true}).click();
    await page.evaluate(()=>{window.__navFixture.state.detourActive=true;});
    await fix({coords:{accuracy:80}});
    await page.getByRole('heading',{name:'绕行引导已暂停',exact:true}).waitFor();
    assert.equal(await page.locator('#optional-navigation-map').count(),0);
    assert.doesNotMatch(await page.locator('.journey-paused').innerText(),/合成替换路段/);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    results.push({provider,location:'simulated',checks:'default, switch, opt-in, follow, drag/wheel interrupt, recenter, poor/stale/outside/denied, single watcher, manual next/back, three progress states, inspection, next preview, no progress/rest/speech/location mutation, unknown/missing/final, replacement, detour suspension',layouts,errors,external});
    await page.screenshot({path:`${output}/${provider}-390.png`,fullPage:true});
    await context.close();
  }
  await writeFile(output+'/checks.json',JSON.stringify({fixture:true,hardware:false,realAMap:false,results},null,2));
  console.log('PASS: isolated active-navigation UI in AMap SDK MOCK and fixed fallback; synthetic GPS only; no external requests.');
} finally {await browser.close();await server.close();}
