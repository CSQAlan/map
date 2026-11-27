import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navigationRest } from '../src/utils/navigationRest.js';
import { navigationRestWaypoint, restWaypointLabel } from '../src/utils/navigationRestWaypoint.js';
import { wgs84ToGcj02 } from '../src/services/navigationJourney.js';

function fixture() {
  const codes = ['before', 'after', 'last'];
  const route = { distance_m: 60, segment_codes: codes,
    segments: codes.map(segment_code => ({ segment_code, length_m: 20 })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1',
      segment_codes: [...codes], node_codes: ['start', 'rest', 'second', 'end'],
      segment_lengths_m: [20, 20, 20], stops: [
        { node_index: 1, node_code: 'rest', name: '合成休息点' },
        { node_index: 2, node_code: 'second', name: '合成第二休息点' },
      ] } };
  const points = [[106, 29], [106.001, 29], [106.002, 29], [106.003, 29]];
  const features = codes.map((segment_code, i) => ({ type: 'Feature', properties: { kind: 'segment', segment_code },
    geometry: { type: 'LineString', coordinates: points.slice(i, i + 2) } }));
  return { route, features };
}
const resolve = (r, f, i = 0, options = {}) => navigationRestWaypoint(r, i, navigationRest(r, i, options), f, options);

test('exact common endpoint in every line orientation, detached output, no input mutation', () => {
  for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
    const { route, features } = fixture();
    if (reverseA) features[0].geometry.coordinates.reverse();
    if (reverseB) features[1].geometry.coordinates.reverse();
    const before = JSON.stringify({ route, features });
    const marker = resolve(route, features);
    assert.deepEqual(marker, { nodeCode: 'rest', name: '合成休息点', point: [106.001, 29] });
    assert.match(restWaypointLabel(marker), /登记路网节点，非座椅位置，未确认实时到达/);
    marker.point[0] = 0;
    assert.equal(JSON.stringify({ route, features }), before);
  }
});

const invalid = [
  ['missing before', f => f.shift()],
  ['missing after', f => f.splice(1, 1)],
  ['duplicate', f => f.push(structuredClone(f[0]))],
  ['invalid duplicate', f => f.push({ ...f[1], geometry: null })],
  ['wrong exact code', f => f[0].properties.segment_code = ' before'],
  ['name-only match', f => { f[0].properties.name = 'before'; delete f[0].properties.segment_code; }],
  ['unsupported geometry', f => f[0].geometry.type = 'MultiLineString'],
  ['missing geometry', f => f[1].geometry = null],
  ['missing coordinates', f => delete f[0].geometry.coordinates],
  ['coordinate object', f => f[0].geometry.coordinates = { length: 2 }],
  ['single point', f => f[0].geometry.coordinates.pop()],
  ['closed before', f => f[0].geometry.coordinates.push(f[0].geometry.coordinates[0])],
  ['closed after', f => f[1].geometry.coordinates.push(f[1].geometry.coordinates[0])],
  ['both endpoints shared', f => f[1].geometry.coordinates = [...f[0].geometry.coordinates].reverse()],
  ['near endpoint', f => f[1].geometry.coordinates[0] = [106.0010000001, 29]],
  ['interior intersection only', f => f[1].geometry.coordinates = [[106.0005, 28.99], [106.0005, 29.01]]],
  ['endpoint to interior only', f => f[1].geometry.coordinates = [[106.002, 29], [106.001, 29], [106.003, 29]]],
  ['three-coordinate endpoint', f => f[0].geometry.coordinates[1] = [106.001, 29, 0]],
  ['invalid interior', f => f[0].geometry.coordinates.splice(1, 0, [NaN, 29])],
  ['three-coordinate interior', f => f[0].geometry.coordinates.splice(1, 0, [106.0005, 29, 0])],
  ['string coordinate', f => f[0].geometry.coordinates[0] = ['106', 29]],
  ['out of bounds', f => f[0].geometry.coordinates[0] = [181, 29]],
  ['infinite', f => f[0].geometry.coordinates[0] = [Infinity, 29]],
  ['null point', f => f[1].geometry.coordinates[1] = null],
  ['sparse line', f => delete f[0].geometry.coordinates[0]],
];
for (const [name, mutate] of invalid) test(`${name} keeps text without a precise marker`, () => {
  const { route, features } = fixture(); mutate(features);
  assert.equal(navigationRest(route, 0).state, 'upcoming');
  assert.equal(resolve(route, features), null);
});

test('mixed evidence: only consecutive registered segments count, unrelated malformed roads cannot erase valid evidence', () => {
  const { route, features } = fixture();
  features.push(null, { properties: { kind: 'segment', segment_code: 'unrelated' }, geometry: { type: 'LineString', coordinates: {} } });
  features.push({ properties: { kind: 'poi', segment_code: 'before', name: '合成休息点' }, geometry: { type: 'Point', coordinates: [0, 0] } });
  assert.deepEqual(resolve(route, features).point, [106.001, 29]);
  features[1].geometry = null;
  route.segments[1].geometry_coordinates = [[106.001, 29], [106.002, 29]];
  assert.equal(resolve(route, features), null, 'DTO geometry and nonconsecutive roads cannot repair missing registration');
});

test('revalidates current route rather than trusting supplied result or stale node identity', () => {
  for (const mutate of [r => r.navigation_rest.node_codes.reverse(), r => r.navigation_rest.node_codes[2] = 'rest',
    r => r.navigation_rest.segment_codes.reverse(), r => r.navigation_rest.source = 'preview',
    r => r.segments.reverse(), r => r.distance_m++, r => r.navigation_rest.stops[0].node_index = 2]) {
    const { route, features } = fixture(); const rest = navigationRest(route, 0); mutate(route);
    assert.equal(navigationRestWaypoint(route, 0, rest, features), null);
  }
  const { route, features } = fixture();
  const rest = navigationRest(route, 0);
  assert.equal(navigationRestWaypoint(route, 1, rest, features), null);
  assert.equal(navigationRestWaypoint(route, 0, { ...rest, nodeCode: 'other' }, features), null);
  for (const value of [null, {}, []]) assert.equal(resolve(route, value), null);
  for (const options of [{ paused: true }, { active: false }]) {
    assert.equal(navigationRestWaypoint(route, 0, rest, features, options), null);
    assert.equal(resolve(route, features, 0, options), null);
  }
  assert.equal(navigationRestWaypoint(null, 0, rest, features), null);
  assert.equal(navigationRestWaypoint(route, 0, { state: 'hidden' }, features), null);
});

test('manual progress replaces passed stop, then removes marker; destination is never an intermediate marker', () => {
  const { route, features } = fixture();
  assert.equal(resolve(route, features, 0).nodeCode, 'rest');
  assert.equal(resolve(route, features, 1).nodeCode, 'second');
  assert.equal(resolve(route, features, 2), null);
  assert.equal(resolve(route, features, 0).nodeCode, 'rest');
  route.navigation_rest.stops = [{ node_index: 3, node_code: 'end', name: '终点登记休息点' }];
  assert.equal(resolve(route, features), null);
});

test('actual seed roads at lotus entry use registered core_nodes endpoints in GCJ02, never platform or seat position', async () => {
  const seed = async file => JSON.parse(await readFile(new URL(`../../backend/app/db/seed_data/${file}`, import.meta.url), 'utf8'));
  const [roads, nodes, pois] = await Promise.all(['core_segments.json', 'core_nodes.json', 'core_pois.json'].map(seed));
  const codes = ['S_SY_MAIN_TO_LOTUS', 'S_SY_LOTUS_ENTRY_TO_PLATFORM'];
  const segments = codes.map(code => roads.find(row => row.segment_code === code));
  const chain = [segments[0].start_node_code, ...segments.map(row => row.end_node_code)];
  assert.equal(segments[0].end_node_code, segments[1].start_node_code);
  const restPoi = pois.find(poi => poi.poi_type === 'REST_AREA' && poi.linked_node_code === chain[1]);
  assert.ok(restPoi);
  const route = { distance_m: segments.reduce((sum, row) => sum + row.length_m, 0), segment_codes: codes, segments,
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: codes,
      node_codes: chain, segment_lengths_m: segments.map(row => row.length_m),
      stops: [{ node_index: 1, node_code: chain[1], name: restPoi.name }] } };
  const point = code => { const node = nodes.find(row => row.node_code === code); assert.ok(node); return wgs84ToGcj02(node.lon, node.lat); };
  // Public seed registrations have endpoint nodes rather than stored polylines.
  const features = segments.map(row => ({ properties: { kind: 'segment', segment_code: row.segment_code },
    geometry: { type: 'LineString', coordinates: [point(row.start_node_code), point(row.end_node_code)] } }));
  const marker = resolve(route, features);
  assert.equal(marker.nodeCode, 'N_SY_LOTUS_ENTRY');
  assert.deepEqual(marker.point, point('N_SY_LOTUS_ENTRY'));
  assert.notDeepEqual(marker.point, point('N_SY_LOTUS_PLATFORM'));
  assert.equal(resolve(route, features, 1), null);
});
