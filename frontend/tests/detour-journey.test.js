import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { completeDetourRoute, createDetourJourney } from '../src/composables/useDetourJourney.js';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp, createRenderer, h, reactive, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { compileScript, parse } from '@vue/compiler-sfc';

// All positions, names, distances and route records below are synthetic.
const places = ['合成出发点', '合成目的地', '其他地点'].map(value => ({ value, label: value }));
const makeRoute = (code, distance = 100) => ({ distance_m: distance, rank: 1, estimated_minutes: 4,
  segment_codes: [code], segments: [{ segment_code: code, name: `测试${code}`, length_m: distance,
    geometry_coordinates: [[106,29],[106.001,29]], step_count: 0, width_m: 3, slope_percent: 1 }], summary: '合成路线' });
const response = payload => ({ ok: true, json: async () => payload });
const routePayload = (code = 'alternate', extra = {}) => ({ start_name: places[0].value, end_name: places[1].value,
  mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', excluded_segment_code: 'original', routes: [makeRoute(code, 130)], ...extra });
const candidates = extra => ({ excluded_segment_code: 'original', candidates: [{ segment_code: 'reentry', name: '测试替代接入段',
  allowed: true, distance_m: 1, snapped_coordinates: [106.0005,29] }], ...extra });
const gpsPayload = extra => {
  const route=makeRoute('reentry',130);
  route.segments[0].geometry_coordinates[0]=[106.0005,29];
  return routePayload('reentry', { routes:[route], start_context: { segment_code: 'reentry', name: '测试替代接入段', snapped_coordinates:[106.0005,29],distance_m:1 }, ...extra });
};
const sample = timestamp => ({ longitude: 106.0005, latitude: 29, accuracy: 3, timestamp: timestamp ?? Date.now() });
function deferred() { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function setup({ lookup = async () => response(candidates()), recommend = async () => response(gpsPayload()), preview = routePayload() } = {}) {
  const urls = [], navigations = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    router: { push: async p => navigations.push(p), replace: async p => navigations.push(p) },
    fetcher: async url => {
      urls.push(url);
      if (url.includes('/start-options?')) return lookup(url);
      if (url.includes('start_longitude=')) return recommend(url);
      if (url.includes('exclude_segment_code=')) return response(preview);
      return response(routePayload('original', { excluded_segment_code: null, routes: [makeRoute('original')] }));
    } });
  planner.startName.value = places[0].value; planner.endName.value = places[1].value;
  return { planner, urls, navigations };
}
async function activate(planner) {
  await planner.planRoutes(); await planner.previewExclusion('original');
  assert.equal(planner.useExclusionRoute(), true);
}

test('initial candidate needs explicit adoption, preserves original until then; no automatic navigation', async () => {
  const { planner, navigations } = setup();
  await planner.planRoutes();
  const original = planner.selectedRoute.value;
  await planner.previewExclusion('original');
  assert.equal(planner.selectedRoute.value, original);
  assert.equal(planner.detour.session.value, null);
  assert.deepEqual(navigations, []);
  assert.equal(planner.useExclusionRoute(), true);
  assert.equal(planner.detour.session.value.code, 'original');
  assert.equal(planner.detour.session.value.endName, places[1].value);
  assert.equal(planner.selectedRoute.value.segment_codes[0], 'alternate');
  assert.deepEqual(navigations, []);
  assert.equal(await planner.startNavigation(), true);
  assert.deepEqual(navigations, ['/elder/navigation']);
});

test('GPS two requests carry exactly the same exclusion and locked context; two explicit confirmations', async () => {
  const { planner, urls, navigations } = setup();
  await activate(planner);
  await planner.startNavigation();
  const before = urls.length;
  const task = planner.detour.replan(async () => sample());
  assert.equal(planner.selectedRoute.value, null, 'old route immediately removed from guidance');
  assert.equal(await planner.startNavigation(), false);
  assert.equal(await task, true);
  assert.equal(urls.length, before + 1, 'lookup alone never plans without confirmation');
  const lookup = new URL(urls.at(-1), 'http://synthetic.test').searchParams;
  assert.equal(lookup.get('exclude_segment_code'), 'original');
  assert.equal(lookup.get('mobility_type'), 'WHEELCHAIR');
  assert.equal(planner.detour.phase.value, 'confirm-start');
  assert.equal(await planner.detour.confirmStart('reentry'), true);
  const request = new URL(urls.at(-1), 'http://synthetic.test').searchParams;
  for (const [key,value] of Object.entries({ exclude_segment_code: 'original', end_name: places[1].value, mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', start_segment_code: 'reentry' })) assert.equal(request.get(key), value);
  assert.equal(request.has('start_name'), false, 'never use old named start');
  assert.equal(request.get('start_timestamp_ms'), lookup.get('timestamp_ms'));
  assert.equal(planner.selectedRoute.value, null);
  assert.equal(planner.detour.phase.value, 'confirm-route');
  assert.equal(navigations.length, 1, 'neither HTTP response auto-starts navigation');
  assert.equal(planner.detour.confirmRoute(), true);
  assert.equal(planner.selectedRoute.value.segment_codes[0], 'reentry');
  assert.equal(planner.detour.session.value.confirmedSegment, 'reentry');
  assert.ok(planner.detour.session.value.generation > 0);
  assert.equal(planner.detour.session.value.code, 'original');
});

for (const [name, failure] of [
  ['denied', async () => { throw Object.assign(new Error('定位拒绝'), { code:1 }); }],
  ['missing fix', async () => null],
  ['low precision', async () => ({ ...sample(), accuracy:31 })],
  ['expired', async () => sample(Date.now()-60001)],
  ['future', async () => sample(Date.now()+6000)],
]) test(`${name}: preserves exclusion, removes old guidance, never sends ordinary request`, async () => {
  const { planner, urls } = setup(); await activate(planner);
  const before = urls.length;
  assert.equal(await planner.detour.replan(failure), false);
  assert.equal(planner.detour.phase.value, 'paused');
  assert.equal(planner.selectedRoute.value, null);
  assert.equal(planner.detour.session.value.code, 'original');
  assert.equal(urls.length, before);
  assert.equal(await planner.startNavigation(), false);
});

for (const [name, lookup] of [
  ['network', async () => { throw new TypeError('offline'); }],
  ['ambiguity', async () => ({ ok:false, json:async () => ({ detail:{code:'AMBIGUOUS_EXCLUDED_LOCATION',message:'定位歧义，请重试'} }) })],
  ['unknown code', async () => ({ ok:false, json:async () => ({ detail:{message:'排除码已不可用'} }) })],
  ['wrong echo', async () => response(candidates({ excluded_segment_code:'other' }))],
  ['missing echo', async () => response(candidates({ excluded_segment_code:undefined }))],
  ['excluded candidate', async () => response(candidates({ candidates:[{ ...candidates().candidates[0],segment_code:'original' }] }))],
  ['duplicate candidates', async () => response(candidates({ candidates:[...candidates().candidates,...candidates().candidates] }))],
  ['empty candidates', async () => response(candidates({ candidates:[] }))],
]) test(`${name}: no fallback and no final request`, async () => {
  const { planner, urls } = setup({ lookup }); await activate(planner);
  const before = urls.length;
  assert.equal(await planner.detour.replan(async () => sample()), false);
  assert.equal(planner.detour.session.value.code, 'original');
  assert.equal(planner.detour.phase.value, 'paused');
  assert.equal(planner.selectedRoute.value, null);
  assert.equal(urls.length, before+1);
});

for (const [name, recommend] of [
  ['no route', async () => ({ ok:false,json:async () => ({detail:{code:'NO_ROUTE_WITH_EXCLUSION',message:'暂无同条件路线'}}) })],
  ['offline', async () => { throw new TypeError('offline'); }],
  ['wrong echo', async () => response(gpsPayload({excluded_segment_code:'other'}))],
  ['wrong destination', async () => response(gpsPayload({end_name:'elsewhere'}))],
  ['wrong profile', async () => response(gpsPayload({mobility_type:'INDEPENDENT'}))],
  ['wrong strategy', async () => response(gpsPayload({strategy:'SHORTEST'}))],
  ['wrong confirmed start', async () => response(gpsPayload({start_context:{segment_code:'elsewhere'}}))],
  ['wrong snapped start', async () => response(gpsPayload({start_context:{segment_code:'reentry',name:'bad',distance_m:1,snapped_coordinates:[106,29]}}))],
  ['excluded clipped alias', async () => response(gpsPayload({routes:[makeRoute('clipped:original')]}))],
  ['excluded segment', async () => response(gpsPayload({routes:[makeRoute('original')]}))],
  ['missing geometry', async () => response(gpsPayload({routes:[{...makeRoute('reentry'),segments:[{segment_code:'reentry',name:'bad',length_m:10}]}]}))],
]) test(`${name}: rejected final route stays paused`, async () => {
  const { planner } = setup({ recommend }); await activate(planner);
  await planner.detour.replan(async () => sample());
  assert.equal(await planner.detour.confirmStart('reentry'), false);
  assert.equal(planner.detour.session.value.code, 'original');
  assert.equal(planner.detour.phase.value, 'paused');
  assert.equal(planner.selectedRoute.value, null);
});

test('duplicate samples and unconfirmed starts are rejected; cancel restores only planning, never old navigation', async () => {
  const { planner, urls, navigations } = setup(); await activate(planner);
  const fix = sample();
  await planner.detour.replan(async () => fix);
  assert.equal(await planner.detour.confirmStart('unknown'), false);
  assert.equal(await planner.detour.replan(async () => fix), false);
  const count = urls.length;
  assert.equal(await planner.planRoutes(), false);
  assert.equal(urls.length, count);
  planner.cancelDetour();
  assert.equal(planner.detour.session.value, null);
  assert.equal(planner.selectedRoute.value, null);
  assert.deepEqual(navigations, []);
  assert.equal(await planner.planRoutes(), true);
  assert.ok(!urls.at(-1).includes('exclude_segment_code'));
  assert.equal(planner.selectedRoute.value.segment_codes[0], 'original');
  assert.deepEqual(navigations, []);
});

for (const field of ['startName','endName','mobilityType','routeStrategy','selection','leave','scope']) {
  test(`${field}: context changes invalidate pending work, do not cancel exclusion`, async () => {
    const wait = deferred();
    const { planner } = setup({ lookup: () => wait.promise }); await activate(planner);
    const task = planner.detour.replan(async () => sample());
    await new Promise(resolve => setImmediate(resolve));
    if (field === 'selection') planner.selectRoute(0);
    else if (field === 'leave') planner.detour.pause('已离页');
    else if (field === 'scope') { planner.configure({getJourneyScope:()=> 'changed-session'}); planner.detour.pause('会话变化'); }
    else planner[field].value = {startName:places[2].value,endName:places[2].value,mobilityType:'CANE',routeStrategy:'COMFORT'}[field];
    wait.resolve(response(candidates()));
    assert.equal(await task, false);
    assert.equal(planner.detour.session.value.code, 'original');
    assert.equal(planner.detour.phase.value, 'paused');
    assert.equal(planner.selectedRoute.value, null);
    assert.equal(await planner.startNavigation(), false);
  });
}

test('late lookup, delayed JSON and final success cannot resurrect after cancellation or a newer attempt', async () => {
  for (const stage of ['lookup','body','final']) {
    const wait = deferred();
    const { planner } = setup({ lookup: stage==='lookup' ? () => wait.promise : stage==='body' ? async () => ({ok:true,json:()=>wait.promise}) : undefined,
      recommend: stage==='final' ? () => wait.promise : undefined });
    await activate(planner);
    let task = planner.detour.replan(async () => sample());
    if (stage==='final') { await task; task=planner.detour.confirmStart('reentry'); }
    await new Promise(resolve => setImmediate(resolve));
    planner.cancelDetour();
    wait.resolve(stage==='body' ? candidates() : response(stage==='final' ? gpsPayload() : candidates()));
    assert.equal(await task,false);
    assert.equal(planner.detour.session.value,null);
    assert.equal(planner.selectedRoute.value,null);
  }
});

test('late old failure never pauses a newer successful candidate lookup', async () => {
  const wait=deferred(); let calls=0;
  const {planner}=setup({lookup:()=>++calls===1?wait.promise:response(candidates())});
  await activate(planner);
  const first=planner.detour.replan(async()=>sample());
  await new Promise(resolve=>setImmediate(resolve));
  await planner.detour.replan(async()=>sample(Date.now()+1));
  wait.reject(new Error('stale'));
  await first;
  assert.equal(planner.detour.phase.value,'confirm-start');
});

test('clock advancement expires confirmations; timeout pauses; refresh creates no persisted journey', async () => {
  let clock=100000;
  const context={startName:'S',endName:'T',mobilityType:'WHEELCHAIR',strategy:'BALANCED',scope:'synthetic'};
  const create=()=>createDetourJourney({getContext:()=>context,now:()=>clock,timeoutMs:5,fetcher:async()=>response(candidates())});
  const d=create();
  const proposal={code:'original',name:'测试排除',route:makeRoute('alternate'),navigationContext:context,createdAt:clock};
  assert.equal(d.activate(proposal),true);
  await d.replan(async()=>sample(clock));
  clock+=60001;
  assert.equal(await d.confirmStart('reentry'),false);
  assert.equal(d.phase.value,'paused');
  await d.replan(()=>new Promise(()=>{}));
  assert.equal(d.phase.value,'paused');
  assert.match(d.message.value,/超时/);
  assert.equal(create().session.value,null);
  assert.equal(completeDetourRoute(makeRoute('original__partial'),'original'),false);
});

test('page renders explicit confirmation and pause-only guidance; no ordinary route when paused', async () => {
  const stub={name:'detour-map-stub',enforce:'pre',resolveId(source){if(source.endsWith('/AmapRouteMap.vue')||source.endsWith('/EvidenceGallery.vue'))return '\0detour-stub';},load(id){if(id==='\0detour-stub')return 'export default { render: () => null }';}};
  const server=await createServer({configFile:false,envDir:false,plugins:[stub,vue()],server:{middlewareMode:true,watch:null},optimizeDeps:{noDiscovery:true,include:[]}});
  try {
    const {default:Panel}=await server.ssrLoadModule('/src/pages/DetourJourneyPanel.vue');
    const html=await renderToString(createSSRApp(Panel,{session:{name:'测试排除',endName:'测试终点'},phase:'confirm-route',pending:makeRoute('candidate'),message:'暂停',candidates:[]}));
    for(const text of ['测试排除','测试终点','使用这条绕行路线','取消本次绕行','旧路线、语音和地图引导已暂停'])assert.ok(html.includes(text),text);
    const {default:Nav}=await server.ssrLoadModule('/src/pages/NavigationPage.vue');
    const paused=await renderToString(createSSRApp(Nav,{guidancePaused:true,detourActive:true,selectedRoute:makeRoute('old-guidance')}));
    assert.match(paused,/绕行引导已暂停/);
    assert.doesNotMatch(paused,/old-guidance|开启语音|重播本段|amap-route-map/);
    // Mount the real speech/watch code with a synthetic renderer and synthesis.
    // No browser, geolocation call or external service is used.
    const previousSpeech=globalThis.speechSynthesis, previousUtterance=globalThis.SpeechSynthesisUtterance;
    const spoken=[]; let canceled=0;
    globalThis.speechSynthesis={getVoices:()=>[],speak:u=>spoken.push(u.text),cancel:()=>{canceled++;}};
    globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
    const createNode=(type,text='')=>({type,text,children:[],parent:null,props:{}});
    const renderer=createRenderer({
      createElement:createNode,createText:text=>createNode('#text',text),createComment:text=>createNode('#comment',text),
      setText:(node,text)=>{node.text=text;},setElementText:(node,text)=>{node.text=text;node.children=[];},
      patchProp:(node,key,old,value)=>{node.props[key]=value;},
      insert(node,parent,anchor){if(node.parent){node.parent.children=node.parent.children.filter(x=>x!==node);}node.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,node);},
      remove(node){if(node.parent)node.parent.children=node.parent.children.filter(x=>x!==node);},
      parentNode:node=>node.parent,nextSibling:node=>node.parent?.children[node.parent.children.indexOf(node)+1]??null,
    });
    const navURL=new URL('../src/pages/NavigationPage.vue',import.meta.url);
    const navSource=await readFile(navURL,'utf8');
    let script=compileScript(parse(navSource).descriptor,{id:'detour-navigation-watch-test'}).content;
    script=script.replace(/import (\w+) from '([^']+\.vue)';/g, (_,name)=>`const ${name}={render:()=>null};`)
      .replace(/from '([^']+)'/g, (_,specifier)=>`from '${specifier==='vue'?import.meta.resolve('vue'):new URL(specifier,navURL).href}'`);
    const {default:ClientNav}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
    ClientNav.render=()=>null;
    const state=reactive({route:makeRoute('voice-route'),blocked:false});
    let navInstance;
    const mounted=renderer.createApp({render:()=>h(ClientNav,{ref:value=>{navInstance=value;},selectedRoute:state.route,guidancePaused:state.blocked,detourActive:true})});
    const root=createNode('root');
    const flatten=node=>[node,...node.children.flatMap(flatten)];
    try {
      mounted.mount(root);
      const {toggleVoice,replay}=navInstance.$.setupState;
      assert.equal(typeof toggleVoice,'function');
      toggleVoice();
      assert.equal(spoken.length,1);
      assert.match(spoken[0],/voice-route/);
      const before=canceled;
      state.route=null;state.blocked=true;
      await nextTick();
      assert.ok(canceled>before,'pause cancels actual speech synthesis');
      toggleVoice();replay();
      assert.equal(spoken.length,1,'queued old controls cannot restart speech');
      assert.ok(!flatten(root).some(node=>node.text==='开启语音提示'));
    } finally {
      mounted.unmount();globalThis.speechSynthesis=previousSpeech;globalThis.SpeechSynthesisUtterance=previousUtterance;
    }
    const nav=await readFile(new URL('../src/pages/NavigationPage.vue',import.meta.url),'utf8');
    assert.match(nav,/stopLocation\(\); requestCamera\('current'\)/);
    assert.match(nav,/flush: 'sync'/);
    const controller=await readFile(new URL('../src/composables/useDetourJourney.js',import.meta.url),'utf8');
    assert.doesNotMatch(controller,/localStorage|sessionStorage/);
    const app=await readFile(new URL('../src/App.vue',import.meta.url),'utf8');
    assert.match(app,/detourSession && \['recommend', 'elder'\].includes\(activeMode\)/);
    const page=await readFile(new URL('../src/pages/RouteOptionsPage.vue',import.meta.url),'utf8');
    assert.match(page,/@select="!detourActive && emit\('select-route', index\)"/);
  } finally {await server.close();}
});
