import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { walkingBudgetFacts } from '../src/utils/walkingBudget.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp,createRenderer,h,reactive,nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { parse,compileScript } from '@vue/compiler-sfc';

// Synthetic fixtures unless explicitly read from repository seed below.
const preview=(lengths=[100,100],extra={})=>({stop_name:'合成中途休息点',stop_after_segment_index:0,
  baseline_distance_m:250,distance_m:lengths.reduce((s,v)=>s+v,0),baseline_steps:0,steps:0,
  segment_codes:['a','b'],segment_names:['第一段','第二段'],matches_baseline:false,segment_lengths_m:lengths,...extra});

test('budget equality is met; threshold and improvement are independent; equal baseline is not shortening',()=>{
  assert.equal(walkingBudgetFacts(preview(),100).meetsBudget,true);
  assert.equal(walkingBudgetFacts(preview([101,99]),100).meetsBudget,false);
  assert.equal(walkingBudgetFacts(preview([100,100],{baseline_distance_m:100}),100).continuousDifference,0);
  const worse=walkingBudgetFacts(preview([270,174],{baseline_distance_m:246}),300);
  assert.equal(worse.meetsBudget,true);assert.equal(worse.continuousDifference,24);assert.equal(worse.totalDifference,198);
  assert.equal(walkingBudgetFacts(preview([270,174],{baseline_distance_m:246}),200).meetsBudget,false);
  assert.equal(walkingBudgetFacts(preview(),'').meetsBudget,null);
});

test('missing, zero, contradictory, duplicate or incomplete leg data never reconstructs a budget',()=>{
  for(const patch of [{segment_lengths_m:undefined},{segment_lengths_m:null},{segment_lengths_m:[0,200]},
    {segment_lengths_m:[200]},{segment_lengths_m:['100',100]},{segment_lengths_m:[false,100]},
    {segment_lengths_m:[NaN,100]},{distance_m:201},{stop_after_segment_index:1},
    {segment_codes:['a','a']},{segment_names:['only one']},{baseline_distance_m:null},
    {matches_baseline:true}]) assert.equal(walkingBudgetFacts(preview(undefined,patch),200),null,JSON.stringify(patch));
});

test('real seed ordered lengths support270+174 without any inferred line or GPS',async()=>{
  const seed=JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json',import.meta.url),'utf8'));
  const codes=['S_SY_GATE_TO_GARDEN_SPLIT','S_SY_GARDEN_SPLIT_TO_REST','S_SY_GARDEN_REST_TO_BRIDGE','S_SY_BRIDGE_TO_LOTUS'];
  const rows=codes.map(code=>seed.find(row=>row.segment_code===code));
  assert.ok(rows.every(Boolean));
  const p=preview(rows.map(row=>row.length_m),{stop_after_segment_index:1,segment_codes:codes,segment_names:rows.map(row=>row.name),baseline_distance_m:246});
  assert.deepEqual(walkingBudgetFacts(p,300),{first:270,second:174,longest:270,total:444,baseline:246,meetsBudget:true,continuousDifference:24,totalDifference:198});
});

test('stale preview replies do not restore budget facts or replace normal navigation',async()=>{
  let resolve;const wait=new Promise(r=>{resolve=r;});
  const places=['S','T'].map(value=>({value,label:value}));
  const ordinary={distance_m:250,segment_codes:['ordinary'],segments:[]};
  const planner=createRoutePlanner({getStartOptions:()=>places,getEndOptions:()=>places,fetcher:async url=>url.includes('prefer_rest')?wait:{ok:true,json:async()=>({routes:[ordinary]})}});
  planner.startName.value='S';planner.endName.value='T';planner.mobilityType.value='SLOW_WALKER';
  await planner.planRoutes();const old=planner.selectedRoute.value;
  const task=planner.previewRestRoute();
  planner.routeStrategy.value='COMFORT';
  resolve({ok:true,json:async()=>({routes:[ordinary],rest_preview:preview()})});
  assert.equal(await task,false);assert.equal(planner.restPreview.value,null);
  assert.equal(walkingBudgetFacts(planner.restPreview.value,200),null);
  await planner.planRoutes();assert.equal(await planner.startNavigation(),true);
  assert.deepEqual(planner.selectedRoute.value.segment_codes,old.segment_codes);
});

test('budget requires same-response default distance and exact current trip metadata',async()=>{
  for(const patch of [{},{start_name:'wrong'},{end_name:'wrong'},{mobility_type:'INDEPENDENT'},{strategy:'COMFORT'},
    {routes:[{distance_m:999}]},{strategy:undefined}]) {
    const places=['S','T'].map(value=>({value,label:value}));
    const payload={start_name:'S',end_name:'T',mobility_type:'SLOW_WALKER',strategy:'BALANCED',
      routes:[{distance_m:250}],rest_preview:preview(),...patch};
    const planner=createRoutePlanner({getStartOptions:()=>places,getEndOptions:()=>places,
      fetcher:async()=>({ok:true,json:async()=>payload})});
    planner.startName.value='S';planner.endName.value='T';planner.mobilityType.value='SLOW_WALKER';
    await planner.planRoutes();const original=planner.selectedRoute.value;
    assert.equal(await planner.previewRestRoute(),true,'legacy preview remains independent');
    const facts=walkingBudgetFacts(planner.restPreview.value,100);
    assert.equal(Boolean(facts),Object.keys(patch).length===0);
    assert.equal(planner.selectedRoute.value,original);
    assert.equal(await planner.startNavigation(),true);
  }
});

test('budget UI reports legs, equality, unconfirmed and bounded empty without navigation changes',async()=>{
  const stub={name:'budget-no-map',enforce:'pre',resolveId(source){if(/\/(AmapRouteMap|FallbackRouteMap|EvidenceGallery)\.vue$/.test(source))return '\0budget-map';},load(id){if(id==='\0budget-map')return 'export default {render:()=>null}';}};
  const server=await createServer({configFile:false,envDir:false,plugins:[stub,vue()],server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
  try{
    const {default:Page}=await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render=p=>renderToString(createSSRApp(Page,{apiBaseUrl:'',restPreviewAvailable:true,restPreviewState:'ready',restPreview:p}));
    const html=await render(preview([270,174],{baseline_distance_m:246}));
    for(const text of ['连续步行预算','270 米','174 米','444 米','246 米连续走完','长 24 米','连续步行距离没有改善','尚未设置预算','不保证有座位'])assert.ok(html.includes(text),text);
    assert.match(await render(preview([100,100],{baseline_distance_m:100})),/连续距离相同，没有缩短/);
    assert.match(await render(preview([0,100])),/两腿连续步行距离暂未确认/);
    const empty=await renderToString(createSSRApp(Page,{apiBaseUrl:'',restPreviewAvailable:true,restPreviewState:'empty'}));
    assert.match(empty,/本次搜索候选中未找到/);assert.doesNotMatch(empty,/data-testid="walking-budget"/);
  }finally{await server.close();}
});

test('budget switches compute current candidate only, reset when context invalidates and never emit a request',async()=>{
  const url=new URL('../src/pages/RouteOptionsPage.vue',import.meta.url);
  let script=compileScript(parse(await readFile(url,'utf8')).descriptor,{id:'walking-budget-state'}).content;
  script=script.replace(/import (\w+) from '([^']+\.vue)';/g,(_,name)=>`const ${name}={render:()=>null};`)
    .replace(/from '([^']+)'/g,(_,specifier)=>`from '${specifier==='vue'?import.meta.resolve('vue'):new URL(specifier,url).href}'`);
  const {default:Page}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);Page.render=()=>null;
  const oldWindow=globalThis.window;globalThis.window={matchMedia:()=>({matches:false}),addEventListener(){},removeEventListener(){}};
  const renderer=createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),setText(){},setElementText(){},patchProp(){},insert(){},remove(){},parentNode:()=>null,nextSibling:()=>null});
  const state=reactive({restPreviewAvailable:true,restPreviewState:'ready',restPreview:preview([270,174],{baseline_distance_m:246})});
  let vm;const events=[];
  const app=renderer.createApp({render:()=>h(Page,{apiBaseUrl:'',...state,ref:value=>{vm=value;},onPreviewRest:()=>events.push('request')})});
  try{
    app.mount({});const page=vm.$.setupState;
    assert.equal(page.continuousBudget,'');page.continuousBudget=200;
    assert.equal(page.budgetFacts.meetsBudget,false);page.continuousBudget=300;
    assert.equal(page.budgetFacts.meetsBudget,true);assert.deepEqual(events,[]);
    state.restPreview=preview();await nextTick();
    assert.equal(page.budgetFacts.longest,100);
    state.restPreviewAvailable=false;state.restPreview=null;await nextTick();
    assert.equal(page.continuousBudget,'');assert.equal(page.budgetFacts,null);
    assert.deepEqual(events,[]);
  }finally{app.unmount();globalThis.window=oldWindow;}
});
