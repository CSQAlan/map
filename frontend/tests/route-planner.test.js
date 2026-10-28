import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };
const { createRoutePlanner } = await import('../src/composables/useRoutePlanner.js');
const { createMapData } = await import('../src/composables/useMapData.js');

const places = [
  { label: '西门', value: '西门' },
  { label: '休息区', value: '休息区' },
];

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function pendingPlanner() {
  const requests = [];
  const planner = createRoutePlanner({
    getStartOptions: () => places,
    getEndOptions: () => places,
    fetcher: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  });
  planner.startName.value = '西门';
  planner.endName.value = '休息区';
  return { planner, requests };
}

function routeResponse(code) {
  return { ok: true, json: async () => ({ routes: [{ segment_codes: [code] }] }) };
}

test('late success cannot replace the latest route', async () => {
  const { planner, requests } = pendingPlanner();
  const old = planner.planRoutes();
  const latest = planner.planRoutes();
  requests[1].resolve(routeResponse('NEW'));
  assert.equal(await latest, true);
  const status = planner.actionStatus.value;
  requests[0].resolve(routeResponse('OLD'));
  assert.equal(await old, false);
  assert.equal(planner.selectedSegmentCode.value, 'NEW');
  assert.equal(planner.actionStatus.value, status);
});

for (const failure of ['network', 'http']) {
  test(`stale ${failure} failure cannot clear a newer success`, async () => {
    const { planner, requests } = pendingPlanner();
    const old = planner.planRoutes();
    const latest = planner.planRoutes();
    requests[1].resolve(routeResponse('NEW'));
    await latest;
    if (failure === 'network') requests[0].reject(new Error('old failure'));
    else requests[0].resolve({ ok: false, json: async () => ({ detail: { message: 'old failure', avoided_segments: ['OLD'] } }) });
    assert.equal(await old, false);
    assert.equal(planner.selectedSegmentCode.value, 'NEW');
    assert.equal(planner.routes.value.length, 1);
    assert.equal(planner.errorMessage.value, '');
    assert.deepEqual(planner.avoidedSegments.value, []);
  });
}

test('stale finally cannot stop the latest loading state', async () => {
  const { planner, requests } = pendingPlanner();
  const old = planner.planRoutes();
  const latest = planner.planRoutes();
  requests[0].resolve(routeResponse('OLD'));
  assert.equal(await old, false);
  assert.equal(planner.loading.value, true);
  assert.deepEqual(planner.routes.value, []);
  requests[1].resolve(routeResponse('NEW'));
  assert.equal(await latest, true);
  assert.equal(planner.loading.value, false);
});

for (const [field, value] of [['startName', '休息区'], ['endName', '西门'], ['mobilityType', 'CANE'], ['routeStrategy', 'SAFEST']]) {
  test(`editing ${field} clears a completed route immediately`, async () => {
    const { planner, requests } = pendingPlanner();
    const initial = planner.planRoutes();
    requests[0].resolve(routeResponse('INITIAL'));
    await initial;
    planner[field].value = value;
    assert.equal(planner.selectedRoute.value, null);
    assert.equal(planner.selectedSegmentCode.value, null);
    assert.equal(await planner.startNavigation(), false);
  });

  test(`editing ${field} immediately invalidates completed and pending routes`, async () => {
    const { planner, requests } = pendingPlanner();
    const initial = planner.planRoutes();
    requests[0].resolve(routeResponse('INITIAL'));
    await initial;
    const pending = planner.planRoutes();
    assert.equal(planner.selectedRoute.value, null);
    planner[field].value = value;
    assert.equal(planner.loading.value, false);
    assert.equal(planner.selectedSegmentCode.value, null);
    const status = planner.actionStatus.value;
    requests[1].resolve(routeResponse('STALE'));
    assert.equal(await pending, false);
    assert.equal(planner.selectedRoute.value, null);
    assert.equal(planner.actionStatus.value, status);
    assert.equal(await planner.startNavigation(), false);
  });
}

test('invalid new conditions supersede an outstanding valid request', async () => {
  const { planner, requests } = pendingPlanner();
  const old = planner.planRoutes();
  planner.endName.value = planner.startName.value;
  assert.equal(await planner.planRoutes(), false);
  const message = planner.errorMessage.value;
  assert.match(message, /不能相同/);
  requests[0].resolve(routeResponse('OLD'));
  assert.equal(await old, false);
  assert.equal(planner.errorMessage.value, message);
  assert.equal(planner.loading.value, false);
  assert.equal(planner.selectedRoute.value, null);
});

test('current failure retains risk explanations and clears the selected segment', async () => {
  const { planner, requests } = pendingPlanner();
  const initial = planner.planRoutes();
  requests[0].resolve(routeResponse('INITIAL'));
  await initial;
  const pending = planner.planRoutes();
  const risks = [{ segment_code: 'STEPS', reasons: ['存在台阶'] }];
  requests[1].resolve({ ok: false, json: async () => ({ detail: { message: '没有可通行路线', avoided_segments: risks } }) });
  assert.equal(await pending, false);
  assert.equal(planner.errorMessage.value, '没有可通行路线');
  assert.deepEqual(planner.avoidedSegments.value, risks);
  assert.equal(planner.selectedSegmentCode.value, null);
  assert.equal(planner.loading.value, false);
  assert.equal(planner.startName.value, '西门');
  assert.equal(planner.endName.value, '休息区');
});

test('replanning blocks navigation using the previous route', async () => {
  const { planner, requests } = pendingPlanner();
  const initial = planner.planRoutes();
  requests[0].resolve(routeResponse('INITIAL'));
  await initial;
  const pending = planner.planRoutes();
  assert.equal(await planner.startNavigation(), false);
  requests[1].resolve(routeResponse('NEW'));
  await pending;
});

test('empty input is rejected rather than fuzzy-matched to the first POI', async () => {
  const { planner, requests } = pendingPlanner();
  planner.startName.value = '   ';
  const result = planner.planRoutes();
  assert.equal(requests.length, 0);
  assert.equal(await result, false);
  assert.match(planner.errorMessage.value, /试点地点/);
});

test('normalizing input does not invalidate its own request', async () => {
  const { planner, requests } = pendingPlanner();
  planner.startName.value = ' 西门 ';
  const pending = planner.planRoutes();
  assert.equal(planner.startName.value, '西门');
  assert.equal(planner.loading.value, true);
  requests[0].resolve(routeResponse('NORMALIZED'));
  assert.equal(await pending, true);
});

test('a response superseded while decoding JSON cannot publish results', async () => {
  const { planner, requests } = pendingPlanner();
  const json = deferred();
  const decoding = deferred();
  const old = planner.planRoutes();
  requests[0].resolve({ ok: true, json: () => { decoding.resolve(); return json.promise; } });
  await decoding.promise;
  const latest = planner.planRoutes();
  requests[1].resolve(routeResponse('NEW'));
  await latest;
  json.resolve({ routes: [{ segment_codes: ['OLD'] }] });
  assert.equal(await old, false);
  assert.equal(planner.selectedSegmentCode.value, 'NEW');
});

test('route planning preserves the existing endpoint and query contract', async () => {
  let requestedUrl = '';
  const routeHistory = [];
  const planner = createRoutePlanner({
    apiBaseUrl: 'https://api.example.test',
    getStartOptions: () => places,
    getEndOptions: () => places,
    router: {
      push: async (path) => routeHistory.push(['push', path]),
      replace: async (path) => routeHistory.push(['replace', path]),
    },
    fetcher: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        json: async () => ({ routes: [{ rank: 1, segment_codes: ['S-1'] }], avoided_segments: [] }),
      };
    },
  });
  planner.startName.value = '西门';
  planner.endName.value = '休息区';
  planner.mobilityType.value = 'CANE';
  planner.routeStrategy.value = 'FLATTEST';

  assert.equal(await planner.planRoutes(), true);
  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.pathname, '/api/routes/recommend');
  assert.deepEqual([...parsedUrl.searchParams.entries()], [
    ['start_name', '西门'],
    ['end_name', '休息区'],
    ['mobility_type', 'CANE'],
    ['strategy', 'FLATTEST'],
  ]);
  planner.selectRoute(0);
  assert.equal(await planner.startNavigation(), true);
  await planner.returnToOptions();
  assert.deepEqual(routeHistory, [
    ['push', '/elder/navigation'],
    ['replace', '/elder/routes'],
  ]);
  assert.equal(planner.selectedRoute.value.segment_codes[0], 'S-1');
  assert.equal(planner.selectedSegmentCode.value, 'S-1');
});

test('a route request failure retains the selected form values', async () => {
  const planner = createRoutePlanner({
    getStartOptions: () => places,
    getEndOptions: () => places,
    fetcher: async () => ({ ok: false, json: async () => ({ detail: '路线暂不可用' }) }),
  });
  planner.startName.value = '西门';
  planner.endName.value = '休息区';

  assert.equal(await planner.planRoutes(), false);
  assert.equal(planner.startName.value, '西门');
  assert.equal(planner.endName.value, '休息区');
  assert.equal(planner.errorMessage.value, '路线暂不可用');
});

test('changing mobility preference clears route options computed for the previous profile', async () => {
  const planner = createRoutePlanner({
    getStartOptions: () => places,
    getEndOptions: () => places,
    fetcher: async () => ({ ok: true, json: async () => ({ routes: [{ rank: 1 }], avoided_segments: [] }) }),
  });
  planner.startName.value = '西门';
  planner.endName.value = '休息区';
  assert.equal(await planner.planRoutes(), true);
  planner.selectMobility('CANE');
  assert.equal(planner.routes.value.length, 0);
  assert.equal(planner.selectedRoute.value, null);
  assert.match(planner.actionStatus.value, /拐杖老人/);
});

test('map and diagnostic requests retain their existing paths and query parameters', async () => {
  const requestedUrls = [];
  const mapData = createMapData({
    apiBaseUrl: 'https://api.example.test',
    fetcher: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        json: async () => url.includes('/geojson')
          ? { features: [] }
          : url.includes('/diagnostics/')
            ? { suggestions: [] }
            : url.includes('/pois')
              ? [{ name: '西门' }]
              : {},
      };
    },
  });

  await mapData.loadPoiOptions();
  await mapData.loadPilotArea();
  await mapData.loadMapData();
  await mapData.loadDiagnostics();
  assert.deepEqual(requestedUrls, [
    'https://api.example.test/api/map-data/pois?area_code=SHIDAYUAN',
    'https://api.example.test/api/pilot-areas/SHIDAYUAN?coordinate_system=GCJ02',
    'https://api.example.test/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02',
    'https://api.example.test/api/diagnostics/segments?limit=5',
  ]);
});

test('built-in POI fallback keeps every known pilot-area destination available', async () => {
  const mapData = createMapData({ fetcher: async () => ({ ok: false, json: async () => ({}) }) });
  await mapData.loadPoiOptions();
  assert.equal(mapData.startOptions.value.length, 6);
  assert.deepEqual(
    mapData.endOptions.value.map((option) => option.value),
    mapData.startOptions.value.map((option) => option.value)
  );
});
