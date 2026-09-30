import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };
const { createRoutePlanner } = await import('../src/composables/useRoutePlanner.js');
const { createMapData } = await import('../src/composables/useMapData.js');

const places = [
  { label: '西门', value: '西门' },
  { label: '休息区', value: '休息区' },
];

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
