import test from 'node:test';
import assert from 'node:assert/strict';
import { createCurrentOrigin } from '../src/composables/useCurrentOrigin.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { mapFeaturesForOrigin } from '../src/services/routeOriginMap.js';
import { wgs84ToGcj02 } from '../src/services/navigationJourney.js';

const sample = () => ({ longitude: 106.2884, latitude: 29.614, accuracy: 5, timestamp: Date.now() });
const candidate = { segment_code: 'road', name: '入口步道', allowed: true };
const places = [{ value: '西门', label: '西门' }, { value: '荷塘', label: '荷塘' }];

test('GPS is not used before confirmation and cancellation rejects a late fix', async () => {
  let resolve;
  let accepted = 0;
  const workflow = createCurrentOrigin({ capture: () => new Promise(yes => { resolve = yes; }), lookup: async () => ({ candidates: [candidate] }), getMobility: () => 'CANE', onConfirm: () => accepted++ });
  const pending = workflow.start();
  workflow.cancel();
  resolve(sample());
  await pending;
  assert.equal(workflow.state.value, 'idle');
  assert.equal(accepted, 0);
  await Promise.resolve();
});

test('permission denied and poor accuracy keep manual planning available', async () => {
  let mode = 'denied';
  const workflow = createCurrentOrigin({ capture: async () => { if (mode === 'denied') throw { code: 1 }; return { ...sample(), accuracy: 80 }; }, lookup: async () => assert.fail('must not look up poor fix'), getMobility: () => 'CANE' });
  await workflow.start();
  assert.match(workflow.error.value, /权限/);
  mode = 'poor';
  await workflow.start();
  assert.match(workflow.error.value, /精度不足/);
});

test('candidate must be allowed and a fresh fix explicitly confirmed', async () => {
  let accepted = null;
  const workflow = createCurrentOrigin({ capture: async () => sample(), lookup: async () => ({ candidates: [candidate] }), getMobility: () => 'CANE', onConfirm: (fix, road) => { accepted = { fix, road }; } });
  await workflow.start();
  assert.equal(accepted, null);
  workflow.confirm();
  assert.equal(accepted, null, 'A road must be explicitly selected');
  workflow.selectedCode.value = candidate.segment_code;
  workflow.confirm();
  assert.equal(accepted.road.segment_code, 'road');
  assert.equal(workflow.state.value, 'confirmed');
});

test('beginning GPS acquisition invalidates a pending manual-start route', async () => {
  let finish;
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    fetcher: () => new Promise(resolve => { finish = resolve; }) });
  planner.startName.value = '西门';
  planner.endName.value = '荷塘';
  const pending = planner.planRoutes();
  assert.equal(planner.currentOrigin.value, null);
  planner.beginCurrentOrigin();
  finish({ ok: true, json: async () => ({ routes: [{ segment_codes: ['old-manual'] }] }) });
  assert.equal(await pending, false);
  assert.equal(planner.startName.value, '西门', 'Manual fallback remains available');
  assert.deepEqual(planner.routes.value, []);
  assert.equal(planner.loading.value, false);
});

test('coordinate route query omits POI name and preserves the clipped start context', async () => {
  let url;
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places, fetcher: async input => {
    url = new URL(input, 'http://test');
    return { ok: true, json: async () => ({ routes: [{ segment_codes: ['road'] }], start_context: { name: '入口步道' } }) };
  } });
  planner.endName.value = '荷塘';
  planner.setCurrentOrigin(sample(), candidate);
  assert.equal(await planner.planRoutes(), true);
  assert.equal(url.searchParams.has('start_name'), false);
  assert.equal(url.searchParams.get('start_segment_code'), 'road');
  assert.equal(planner.selectedRoute.value.start_context.name, '入口步道');
  planner.startName.value = '西门';
  assert.equal(planner.currentOrigin.value, null);
  assert.deepEqual(planner.routes.value, []);
});

test('profile change invalidates a confirmed GPS origin and stale fixes never query', async () => {
  let requests = 0;
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places, fetcher: async () => { requests++; } });
  planner.setCurrentOrigin(sample(), candidate);
  planner.mobilityType.value = 'CANE';
  assert.equal(planner.currentOrigin.value, null);
  assert.equal(planner.startName.value, '');
  planner.setCurrentOrigin({ ...sample(), timestamp: Date.now() - 61000 }, candidate);
  planner.endName.value = '荷塘';
  assert.equal(await planner.planRoutes(), false);
  assert.equal(requests, 0);
  assert.match(planner.errorMessage.value, /过期/);
});

test('origin map clips the first road in GCJ02 and preserves original evidence features', () => {
  const original = [{ geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4]] }, properties: { kind: 'segment', segment_code: 'road' } }];
  const point = [106.2884, 29.614];
  const result = mapFeaturesForOrigin(original, { start_context: { snapped_coordinates: point }, segments: [{ segment_code: 'road', geometry_coordinates: [point, [106.289, 29.615]] }] });
  assert.deepEqual(result[0].geometry.coordinates[0], wgs84ToGcj02(...point));
  assert.deepEqual(original[0].geometry.coordinates[0], [1, 2]);
  assert.equal(result[1].properties.name, '路线接入点');
});
