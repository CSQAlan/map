import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const browser=await chromium.launch({channel:process.env.UI_BROWSER || 'chrome',headless:true});
const base=process.env.UI_BASE_URL || 'http://127.0.0.1:5173';
try {
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{
  localStorage.setItem('elderMapUser',JSON.stringify({id:42,role:'elder',name:'合成地图检查',mobilityType:'SLOW_WALKER',profileComplete:true}));localStorage.setItem('mapLastLoginRole','elder');
  window.__maps=[];window.__roads=[];window.__loadCalls=0;window.__defer=false;window.__resolvers=[];
  class Overlay {constructor(options){this.options=options;}setOptions(options){Object.assign(this.options,options);}on(_name,callback){this.click=callback;}}
  class Map {constructor(container){if(!(container instanceof HTMLElement))throw new Error('map needs DOM ref');this.container=container;this.fits=0;this.destroyed=false;window.__maps.push(this);}setLimitBounds(){}addControl(){}add(){}remove(){}setFitView(){this.fits++;}destroy(){this.destroyed=true;}setZoomAndCenter(){}}
  class Polyline extends Overlay {constructor(options){super(options);window.__roads.push(this);}}
  window.__sdk={Map,Polyline,Polygon:Overlay,Marker:Overlay,Circle:Overlay,Bounds:Overlay,Scale:Overlay,ToolBar:Overlay};
 });
 await context.route('**/*', route => { const url=route.request().url(); return url.startsWith(base) || /^http:\/\/127\.0\.0\.1:8000\/api\//.test(url) ? route.continue() : route.abort(); });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/src/services/amapLoader.js*',route=>route.fulfill({contentType:'application/javascript',body:`export function loadAmap(){window.__loadCalls++; return window.__defer ? new Promise(resolve=>window.__resolvers.push(resolve)) : Promise.resolve(window.__sdk);}`}));
 const places=['合成地图起点','合成地图终点'];
 const segments=[{segment_code:'A',name:'步道一',length_m:100,risk_tags:[]},{segment_code:'B',name:'步道二',length_m:100,risk_tags:[]}];
 await page.route('http://127.0.0.1:8000/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const data=path.endsWith('/pois')?places.map(name=>({name})):path.includes('/pilot-areas/')?{center:[10.01,10.01],min_zoom:16,max_zoom:20,limit_bounds:{south_west:[10.00,10.00],north_east:[10.02,10.02]},boundary:{coordinates:[[[10.00,10.00],[10.02,10.00],[10.02,10.02],[10.00,10.00]]]}}:path.endsWith('/geojson')?{features:segments.map((s,i)=>({properties:{...s,kind:'segment',wheelchair_accessible:true},geometry:{type:'LineString',coordinates:[[10.01+i*.001,10.01],[10.011+i*.001,10.011]]}}))}:path.endsWith('/recommend')?{routes:[{distance_m:200,estimated_minutes:4,summary:'地图生命周期验证路线',segment_codes:['A','B'],segments}],avoided_segments:[]}:path.endsWith('/sites')?[]:{};
  await route.fulfill({json:data});
 });
 await page.goto(base+'/#/elder/home');
 await page.waitForLoadState('networkidle');
 await page.getByLabel('选择出发地点',{exact:true}).selectOption(places[0]);await page.getByLabel('选择目的地',{exact:true}).selectOption(places[1]);await page.getByRole('button',{name:'查询适合的路线'}).click();await page.getByRole('button',{name:'开始导航',exact:true}).click();
 await page.waitForFunction(()=>window.__maps.length>0 && window.__maps.at(-1).fits===1);
 const initial=await page.evaluate(()=>({maps:window.__maps.length,roads:window.__roads.length,fits:window.__maps.at(-1).fits}));
 await page.evaluate(()=>window.__roads.at(-1).click());await page.waitForFunction(()=>window.__roads.at(-1).options.strokeWeight===9);
 assert.equal(await page.locator('.journey-current h2').innerText(),'步道一');
 assert.equal(await page.evaluate(()=>window.__maps.at(-1).fits),initial.fits);assert.equal(await page.evaluate(()=>window.__roads.length),initial.roads);
 await page.getByRole('button',{name:'已走完这段'}).click();assert.equal(await page.locator('.journey-current h2').innerText(),'步道二');assert.equal(await page.evaluate(()=>window.__maps.at(-1).fits),initial.fits+1);
 await page.getByRole('button',{name:'查看当前路段'}).click();assert.equal(await page.evaluate(()=>window.__maps.at(-1).fits),initial.fits+2);
 await page.evaluate(()=>{window.__defer=true;location.hash='/elder/routes';});await page.waitForFunction(()=>window.__resolvers.length>0);
 const count=await page.evaluate(()=>window.__maps.length);await page.evaluate(()=>location.hash='/elder/assistant');await page.getByLabel('向出行助手提问').waitFor();
 await page.evaluate(()=>window.__resolvers.forEach(resolve=>resolve(window.__sdk)));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>window.__maps.length),count);assert.equal(await page.evaluate(()=>window.__maps.every(map=>map.destroyed)),true);assert.deepEqual(errors,[]);
 console.log('PASS: DOM map ref, one initial fit, selection styling without viewport reset/rebuild, explicit focus and deferred SDK unmount cleanup. SDK is mocked.');
}finally{await browser.close();}
