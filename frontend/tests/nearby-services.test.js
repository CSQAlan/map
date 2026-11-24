import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, ref } from 'vue';
import { createNearbyServices } from '../src/composables/useNearbyServices.js';
import { createMapData } from '../src/composables/useMapData.js';

const start = '师大苑大学城西路入口';
const commercial = '师大苑外部商业街人行道';
const garden = '师大苑林下休闲步道';
const rest = '师大苑荷塘水景休息区';
const directory = [
  {name:start,poi_type:'ENTRANCE'}, {name:'师大苑楼栋组团A',poi_type:'BUILDING_GROUP'},
  {name:rest,poi_type:'REST_AREA'}, {name:garden,poi_type:'REST_AREA'},
  {name:commercial,poi_type:'SERVICE_ACCESS'},
];
const get = url => new URL(url, 'http://test.local').searchParams;
const response = (status, body) => ({ status, ok: status === 200, json: async () => body });
const noPath = {detail:{message:'现有路网中没有符合当前出行条件的可达路线。',avoided_segments:[]}};
function found(url, distance) {
  const data = get(url);
  return response(200, {start_name:data.get('start_name'),end_name:data.get('end_name'),
    mobility_type:data.get('mobility_type'),routes:[{distance_m:distance,segment_codes:['synthetic-edge']}]});
}
function use(fetcher, settings = {}) {
  const scope = effectScope();
  const values = {origin:ref(start),profile:ref('WHEELCHAIR'),pois:ref(directory),enabled:ref(true)};
  const state = scope.run(() => createNearbyServices({...values,fetcher,...settings}));
  return {scope,state,...values};
}

test('official POI metadata is retained apart from legacy dropdown fallback', async () => {
  let ok = false;
  const map = createMapData({fetcher:async () => ok ? response(200, directory) : response(503, {})});
  const warn = console.warn;
  console.warn = () => {};
  try {
    await map.loadPoiOptions();
    assert.equal(map.officialPois.value, null);
    assert.ok(map.startOptions.value.some(x => x.value === start));
    ok = true;
    await map.loadPoiOptions();
    assert.equal(map.officialPois.value.find(x => x.name === commercial).poi_type, 'SERVICE_ACCESS');
  } finally { console.warn = warn; }
});

test('named wheelchair query sorts 58m then 246m, with defined no-path and explicit choose only', async () => {
  const queries = [];
  const w = use(async url => {
    const query = get(url);
    queries.push(query);
    const end = query.get('end_name');
    return end === garden ? response(404,noPath) : found(url,end === commercial ? 58 : 246);
  });
  try {
    await w.state.query();
    assert.deepEqual(w.state.results.value.map(r => [r.name,r.state,r.distance]), [
      [commercial,'reachable',58],[rest,'reachable',246],[garden,'unreachable',undefined],
    ]);
    assert.equal(queries.length,3);
    assert.ok(queries.every(q => q.get('area_code')==='SHIDAYUAN' && q.get('start_name')===start
      && q.get('mobility_type')==='WHEELCHAIR' && !q.has('start_latitude')));
    assert.equal(w.state.canChoose(commercial),true);
    assert.equal(w.state.canChoose(garden),false);
  } finally { w.scope.stop(); }
});

test('a missing POI, an invalid origin, a connection error and malformed success are unknown', async () => {
  for (const answer of [
    response(404,{detail:'POI not found'}),
    response(422,{detail:'unsupported'}),
    response(404,{detail:{message:'现有路网中没有符合当前出行条件的可达路线。'}}),
    response(200,{routes:[]}),
    null,
  ]) {
    const w=use(async () => {if(!answer) throw new Error('offline'); return answer;});
    try {
      await w.state.query();
      assert.equal(w.state.results.value.length,3);
      assert.ok(w.state.results.value.every(x => x.state==='unknown'));
      assert.equal(w.state.canChoose(rest),false);
    } finally {w.scope.stop();}
  }
});

test('invalid start, GPS mode and unavailable list do not query; a real chosen service is excluded as its own destination', async () => {
  const urls=[];
  const w=use(async url => {urls.push(url);return found(url,58);});
  try {
    w.origin.value='试点以外';
    await w.state.query();
    assert.equal(urls.length,0);
    w.enabled.value=false;
    w.origin.value=start;
    await w.state.query();
    assert.equal(urls.length,0);
    w.enabled.value=true;
    w.pois.value=null;
    await w.state.query();
    assert.equal(urls.length,0);
    w.pois.value=directory;
    w.origin.value=commercial;
    await w.state.query();
    assert.ok(urls.every(url => get(url).get('end_name')!==commercial));
  } finally {w.scope.stop();}
});

test('profile and origin changes drop late results and block old selections', async () => {
  for (const field of ['origin','profile','enabled']) {
    const pending=[];
    const w=use(url => new Promise(resolve => pending.push(() => resolve(found(url,58)))));
    try {
      const request=w.state.query();
      assert.equal(pending.length,3);
      w[field].value=field==='origin'?rest:field==='profile'?'INDEPENDENT':false;
      await request;
      pending.forEach(resolve => resolve());
      await Promise.resolve();
      assert.equal(w.state.status.value,'idle');
      assert.deepEqual(w.state.results.value,[]);
      assert.equal(w.state.canChoose(commercial),false);
    } finally {w.scope.stop();}
  }
});

test('repeat query owns state, hung fetch times out as unknown, and cap counts unique real services', async () => {
  const w=use(() => new Promise(()=>{}), {timeoutMs:15});
  try {
    w.pois.value=[...directory,{name:commercial,poi_type:'SERVICE_ACCESS'},{name:'测试额外服务',poi_type:'REST_AREA'}];
    const old=w.state.query();
    await w.state.query();
    await old;
    assert.equal(w.state.results.value.length,3);
    assert.ok(w.state.results.value.every(x=>x.state==='unknown'));
    assert.equal(w.state.canChoose(rest),false);
  } finally {w.scope.stop();}
});
