import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { registeredRoadConditions, routeBottleneck } from '../src/utils/routeBottleneck.js';
import { createSSRApp, createRenderer, h, reactive, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const detail = (code, width, steps, name = code) => ({ segment_code:code, name, width_m:width, step_count:steps,
  geometry_coordinates:[[106,29],[106.001,29]] });
const route = (...segments) => ({ segment_codes:segments.map(row=>row.segment_code), segments });

test('strict positive width and nonnegative integer stairs are independently covered', () => {
  const rows = [detail('zero-width',0,0), detail('good',2,3), detail('text','1','0'),detail('bad',NaN,-1),detail('fraction',true,1.5)];
  const result = registeredRoadConditions(route(...rows));
  assert.deepEqual([result.width.known,result.width.total,result.width.segment.width],[1,5,2]);
  assert.deepEqual([result.steps.known,result.steps.total,result.steps.count],[2,5,null]);
  assert.deepEqual(result.steps.segments,[{code:'good',name:'good',count:3}]);
});

test('actual zero is known; missing null booleans infinite and unsafe numbers are not zero', () => {
  for (const value of [undefined,null,false,'0',Infinity,NaN,-1,1.2,Number.MAX_SAFE_INTEGER+1]) {
    const result=registeredRoadConditions(route(detail('x',1,value)));
    assert.deepEqual([result.steps.known,result.steps.total,result.steps.count],[0,1,null]);
  }
  const result=registeredRoadConditions(route(detail('a',1,0),detail('b',2,0)));
  assert.deepEqual(result.steps,{known:2,total:2,count:0,segments:[]});
});

test('missing rows, duplicate details, duplicate declared IDs and invalid codes stay unknown', () => {
  const a=detail('a',1,2), b=detail('b',2,0);
  for (const segments of [[b],[a,a,b],[a,a,a,b]]) {
    const result=registeredRoadConditions({segment_codes:['a','b','missing'],segments:[...segments,detail('off-route',.1,90)]});
    assert.deepEqual([result.width.known,result.width.total,result.width.segment?.code],[1,3,'b']);
    assert.deepEqual([result.steps.known,result.steps.total,result.steps.count],[1,3,null]);
    assert.deepEqual(result.steps.segments,[]);
  }
  const malformed=registeredRoadConditions({segment_codes:['a','a','b',null,''],segments:[a,b]});
  assert.deepEqual([malformed.width.known,malformed.width.total],[1,5]);
  assert.deepEqual([malformed.steps.known,malformed.steps.total,malformed.steps.count],[1,5,null]);
});

test('missing declaration never infers route from detail rows; overflowing totals are not reported', () => {
  for (const data of [null,{}, {segments:[detail('a',1,2)]}, {segment_codes:[],segments:[detail('a',1,2)]}]) {
    const result=registeredRoadConditions(data);
    assert.deepEqual(result.width,{known:0,total:0,segment:null});
    assert.equal(result.steps.count,null);
  }
  const result=registeredRoadConditions(route(detail('a',1,Number.MAX_SAFE_INTEGER),detail('b',1,1)));
  assert.equal(result.steps.known,2);
  assert.equal(result.steps.count,null);
});

test('missing names and geometry do not fabricate a named stair segment or map line', () => {
  const row=detail('recorded-code',1,2,null); row.geometry_coordinates=null;
  const result=registeredRoadConditions(route(row));
  assert.equal(result.width.segment.coordinates,null);
  assert.match(result.width.segment.name,/名称未记录/);
  assert.deepEqual(result.steps.segments,[{code:'recorded-code',name:null,count:2}]);
});

test('read-only real seed widths/stairs by actual declared route codes', async () => {
  const seed=JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json',import.meta.url),'utf8'));
  const collect=codes=>({segment_codes:codes,segments:codes.map(code=>seed.find(row=>row.segment_code===code))});
  const current=collect(['S_SY_GATE_TO_MAIN','S_SY_MAIN_TO_BUILDING_B']);
  const reference=collect(['S_SY_CRACKED_PAVEMENT','S_SY_CRACK_TO_BUILDING_B']);
  // Use only IDs that actually exist in this seed; no DB or guessed geometry.
  assert.ok(current.segments.every(Boolean));
  assert.ok(reference.segments.every(Boolean));
  const a=registeredRoadConditions(current), b=registeredRoadConditions(reference);
  assert.equal(a.width.segment.width,2.5);
  assert.equal(a.steps.count,0);
  assert.equal(b.width.segment.width,1.3);
  assert.equal(b.steps.count,0);
  assert.equal(a.width.segment.coordinates,null,'seed has no route response geometry: no invented line');
  assert.equal(reference.segments.reduce((sum,row)=>sum+row.length_m,0),166);
  const garden=registeredRoadConditions(collect(['S_SY_GATE_TO_GARDEN_SPLIT','S_SY_GARDEN_SPLIT_TO_REST','S_SY_GARDEN_REST_TO_BRIDGE','S_SY_BRIDGE_TO_LOTUS']));
  assert.equal(garden.steps.count,3);
  assert.equal(garden.steps.segments.length,3);
});

test('without rendering either map, text distinguishes each route, partial data and explicit zero', async () => {
  const stub={name:'no-map-road-conditions',enforce:'pre',resolveId(source){if(/\/(AmapRouteMap|FallbackRouteMap|EvidenceGallery)\.vue$/.test(source))return '\0road-no-map';},load(id){if(id==='\0road-no-map')return 'export default { render: () => null }';}};
  const server=await createServer({configFile:false,envDir:false,plugins:[stub,vue()],server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
  try {
    const {default:Page}=await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const current={segment_codes:['wide','unknown'],segments:[{...detail('wide',2.5,3,'合成当前台阶'),geometry_coordinates:null}]};
    const reference=route({...detail('narrow',1.3,0,'合成参考窄路'),geometry_coordinates:null});
    const render=extra=>renderToString(createSSRApp(Page,{apiBaseUrl:'',selectedRoute:current,comparisonAvailable:true,comparisonState:'ready',walkingReference:reference,...extra}));
    const html=await render({});
    const currentText=html.match(/data-testid="road-conditions-current"[\s\S]*?<\/article>/)[0];
    const referenceText=html.match(/data-testid="road-conditions-reference"[\s\S]*?<\/article>/)[0];
    for(const text of ['当前所选路线','2.5 米','登记宽度 1/2 段','台阶记录 1/2 段','全程台阶总数未确认','合成当前台阶：登记 3 级','不将已知小计当作全程总数']) assert.ok(currentText.includes(text),text);
    assert.doesNotMatch(currentText,/登记全程台阶：3|合成参考窄路|1.3 米/);
    for(const text of ['普通步行参考','1.3 米','台阶记录 1/1 段','登记全程台阶：0 级','登记无台阶','不可用于当前辅助设备导航'])assert.ok(referenceText.includes(text),text);
    assert.doesNotMatch(referenceText,/合成当前台阶|2.5 米/);
    assert.doesNotMatch(html,/locate-bottleneck-current|locate-bottleneck-reference/);
    assert.match(html,/不保证实地路况/);
    assert.match(await render({selectedRoute:route(detail('tiny',.001,0)),comparisonAvailable:false}),/不足 0.01 米/);
    for(const comparisonState of ['idle','loading','error','empty']) {
      assert.doesNotMatch(await render({comparisonState}),/data-testid="road-conditions-reference"/);
    }
    assert.doesNotMatch(await render({selectedRoute:null}),/data-testid="road-conditions-current"/);
  } finally {await server.close();}
});

test('real page computed facts switch immediately; old nextTick focus cannot restore after route change/clear', async () => {
  const url=new URL('../src/pages/RouteOptionsPage.vue',import.meta.url);
  let script=compileScript(parse(await readFile(url,'utf8')).descriptor,{id:'road-conditions-state'}).content;
  script=script.replace(/import (\w+) from '([^']+\.vue)';/g,(_,name)=>`const ${name}={render:()=>null};`)
    .replace(/from '([^']+)'/g,(_,specifier)=>`from '${specifier==='vue'?import.meta.resolve('vue'):new URL(specifier,url).href}'`);
  const {default:Page}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
  Page.render=()=>null;
  const previousWindow=globalThis.window;
  globalThis.window={matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){}};
  const renderer=createRenderer({createElement:()=>({}),createComment:()=>({}),createText:()=>({}),setText(){},setElementText(){},patchProp(){},insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null});
  const initial=route(detail('a',2.5,3)), reference=route(detail('r',1.3,0));
  const state=reactive({apiBaseUrl:'',selectedRoute:initial,walkingReference:reference,comparisonAvailable:true,comparisonState:'ready'});
  let vm;
  const app=renderer.createApp({render:()=>h(Page,{...state,ref:value=>{vm=value;}})});
  try {
    app.mount({}); const page=vm.$.setupState;
    assert.equal(page.bottlenecks[0].steps.count,3);
    await page.locateBottleneck('reference');
    assert.equal(page.focusedKind,'reference');
    const pending=page.locateBottleneck('current');
    state.selectedRoute=route(detail('new',4,0));
    await nextTick(); await pending;
    assert.equal(page.focusedKind,null);
    assert.equal(page.bottlenecks[0].facts.segment.code,'new');
    assert.equal(page.bottlenecks[0].steps.count,0);
    assert.equal(page.bottlenecks[1].facts.segment.code,'r');
    await page.locateBottleneck('current');
    state.selectedRoute.segments[0].width_m=5;
    await nextTick();
    assert.equal(page.focusedKind,null,'in-place route detail updates also clear old focus');
    assert.equal(page.bottlenecks[0].facts.segment.width,5);
    state.comparisonState='loading'; state.walkingReference=null;
    await nextTick();
    assert.equal(page.bottlenecks.length,1);
    state.selectedRoute=null;
    await nextTick();
    assert.equal(page.bottlenecks[0].facts.segment,null);
    assert.equal(page.focusedSegment,null);
    assert.equal(routeBottleneck(initial).segment.code,'a','input unchanged');
  } finally {app.unmount();globalThis.window=previousWindow;}
});
