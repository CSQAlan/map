import test from 'node:test';
import assert from 'node:assert/strict';
import { createSSRApp, effectScope, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { arrivalBoundaryText } from '../src/utils/arrivalBoundary.js';
import { createNearbyServices } from '../src/composables/useNearbyServices.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { createDetourJourney } from '../src/composables/useDetourJourney.js';

// Synthetic response annotations: not live API, GPS or field verification.
const boundary={version:1,kind:'LOTUS_ENTRY',node_code:'N_SY_LOTUS_ENTRY',last_segment_code:'edge',
  source:'SHIDAYUAN-core-endpoint-interpretation/2026-11-24/v1',connection_step_count:1,connection_ramp_recorded:false};
const candidate=()=>({rank:1,route_score:1,distance_m:100,estimated_minutes:2,summary:'合成路线',segment_codes:['edge'],
  segments:[{segment_code:'edge',name:'合成最后一段',length_m:100,geometry_coordinates:[[106,29],[106.001,29]],step_count:0}],arrival_boundary:{...boundary}});

test('stable server annotation not destination name; missing/incompatible annotations make no claim',()=>{
  assert.match(arrivalBoundaryText(candidate()),/只到荷塘入口，不到内侧平台或座椅/);
  assert.match(arrivalBoundaryText(candidate()),/1 级台阶，未登记坡道/);
  for(const patch of [null,{}, {...boundary,version:2},{...boundary,node_code:'other'},
    {...boundary,source:'unknown'},{...boundary,last_segment_code:'other'}, {...boundary,kind:'unknown'}])
    assert.equal(arrivalBoundaryText({...candidate(),arrival_boundary:patch}), '');
  assert.equal(arrivalBoundaryText({end_name:'师大苑荷塘水景休息区',segment_codes:['edge']}),'');
  for(const code of [null,undefined,'',12,false,' ']) {
    assert.equal(arrivalBoundaryText({...candidate(),segment_codes:[code],arrival_boundary:{...boundary,last_segment_code:code}}),'');
  }
  assert.match(arrivalBoundaryText({...candidate(),arrival_boundary:{...boundary,kind:'NETWORK_NODE',node_code:'other',source:'server-resolved-active-road-node/v1'}}),/暂未记录更具体入口或内部通行/);
  assert.doesNotMatch(arrivalBoundaryText({...candidate(),arrival_boundary:{...boundary,connection_step_count:null}}),/0 级|1 级|未登记坡道/);
});

test('nearby uses the same response without changing distance, choice or adding a query',async()=>{
  const scope=effectScope();let count=0;
  const state=scope.run(()=>createNearbyServices({origin:ref('start'),profile:ref('WHEELCHAIR'),enabled:ref(true),
    pois:ref([{name:'start',poi_type:'ENTRANCE'},{name:'任意显示别名',poi_type:'REST_AREA'}]),
    fetcher:async()=>{count++;return {ok:true,status:200,json:async()=>({start_name:'start',end_name:'任意显示别名',mobility_type:'WHEELCHAIR',routes:[candidate()]})};}}));
  try {await state.query();assert.equal(count,1);assert.equal(state.results.value[0].distance,100);
    assert.match(state.results.value[0].boundaryText,/只到荷塘入口/);assert.equal(state.canChoose('任意显示别名'),true);
  }finally{scope.stop();}
});

test('ordinary planning and explicit detour activation retain the candidate annotation unchanged',async()=>{
  const places=['start','end'].map(value=>({value,label:value}));
  const planner=createRoutePlanner({getStartOptions:()=>places,getEndOptions:()=>places,fetcher:async url=>{
    const detour=url.includes('exclude_segment_code=');
    const route=candidate();
    if(!detour){route.segment_codes=['original'];route.segments[0].segment_code='original';route.arrival_boundary.last_segment_code='original';}
    return {ok:true,json:async()=>({start_name:'start',end_name:'end',mobility_type:'WHEELCHAIR',strategy:'BALANCED',excluded_segment_code:detour?'original':null,routes:[route]})};
  }});
  planner.startName.value='start';planner.endName.value='end';await planner.planRoutes();
  const original=planner.selectedRoute.value;assert.match(arrivalBoundaryText(original),/只到荷塘入口/);
  await planner.previewExclusion('original');assert.equal(planner.selectedRoute.value,original);
  assert.equal(planner.useExclusionRoute(),true);assert.match(arrivalBoundaryText(planner.selectedRoute.value),/只到荷塘入口/);
  assert.equal(planner.selectedRoute.value.distance_m,100);
});

test('simulated current-origin detour replan keeps boundary through explicit confirmation and clears on pause',async()=>{
  const context={startName:'start',endName:'end',mobilityType:'WHEELCHAIR',strategy:'BALANCED',scope:'local'};
  const startContext={segment_code:'edge',name:'合成最后一段',distance_m:1,snapped_coordinates:[106,29]};
  const journey=createDetourJourney({getContext:()=>context,now:()=>1000,fetcher:async url=>({ok:true,json:async()=>
    url.includes('start-options')?{excluded_segment_code:'original',candidates:[{...startContext,allowed:true}]}:
      {excluded_segment_code:'original',end_name:'end',mobility_type:'WHEELCHAIR',strategy:'BALANCED',start_context:startContext,routes:[candidate()]}})});
  assert.equal(journey.activate({navigationContext:context,code:'original',name:'合成排除',createdAt:1000,route:candidate()}),true);
  assert.equal(await journey.replan(async()=>({longitude:106,latitude:29,accuracy:3,timestamp:1000})),true);
  assert.equal(await journey.confirmStart('edge'),true);
  assert.equal(journey.route.value,null);
  assert.match(arrivalBoundaryText(journey.pending.value),/只到荷塘入口/);
  assert.equal(journey.confirmRoute(),true);
  assert.match(arrivalBoundaryText(journey.route.value),/只到荷塘入口/);
  journey.pause();assert.equal(arrivalBoundaryText(journey.route.value),'');
});

test('route, navigation, detour and nearby text renders without any map implementation',async()=>{
  const stub={name:'arrival-no-components',enforce:'pre',resolveId(source){if(source.endsWith('.vue')&&!source.includes('/pages/'))return '\0arrival-stub';},load(id){if(id==='\0arrival-stub')return 'export default {render:()=>null}';}};
  const server=await createServer({configFile:false,envDir:false,plugins:[stub,vue()],server:{middlewareMode:true,watch:null,hmr:false,ws:false},optimizeDeps:{noDiscovery:true,include:[]}});
  try {
    for(const name of ['RouteOptionsPage','NavigationPage']) {
      const {default:Page}=await server.ssrLoadModule(`/src/pages/${name}.vue`);
      const html=await renderToString(createSSRApp(Page,{selectedRoute:candidate(),routes:[candidate()],apiBaseUrl:''}));
      assert.match(html,/只到荷塘入口，不到内侧平台或座椅/);
      assert.match(html,/1 级台阶/);
      const empty=await renderToString(createSSRApp(Page,{selectedRoute:{...candidate(),arrival_boundary:null},apiBaseUrl:''}));
      assert.doesNotMatch(empty,/只到荷塘入口/);
    }
    const {default:Detour}=await server.ssrLoadModule('/src/pages/DetourJourneyPanel.vue');
    assert.match(await renderToString(createSSRApp(Detour,{session:{name:'合成排除',endName:'别名'},phase:'confirm-route',pending:candidate()})),/只到荷塘入口/);
    const {default:Elder}=await server.ssrLoadModule('/src/pages/ElderPage.vue');
    assert.match(await renderToString(createSSRApp(Elder,{nearbyResults:[{name:'别名',state:'reachable',distance:100,boundaryText:arrivalBoundaryText(candidate())}]})),/只到荷塘入口/);
  }finally{await server.close();}
});
