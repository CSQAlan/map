import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import { routeBottleneck, mapFeaturesForBottleneck } from '../src/utils/routeBottleneck.js';
import { wgs84ToGcj02 } from '../src/services/navigationJourney.js';

const syntheticLine = [[106.301, 29.601], [106.302, 29.602]];
const detail = (code, width, geometry = syntheticLine) =>
  ({ segment_code: code, name: code, width_m: width, geometry_coordinates: geometry });
const route = (...segments) => ({ segment_codes: segments.map(s => s.segment_code), segments });
const current = route(detail('wide', 4), detail('current minimum', 2.5));
const reference = route(detail('reference minimum', 1.3), detail('wide', 4));

test('independently finds each route’s positive recorded minimum and preserves source geometry', () => {
  const a = routeBottleneck(current);
  const b = routeBottleneck(reference);
  assert.deepEqual([a.known, a.total, a.segment.code, a.segment.width], [2, 2, 'current minimum', 2.5]);
  assert.deepEqual([b.known, b.total, b.segment.code, b.segment.width], [2, 2, 'reference minimum', 1.3]);
  assert.deepEqual(a.segment.coordinates, syntheticLine.map(p => wgs84ToGcj02(...p)));
  assert.deepEqual(current.segments[1].geometry_coordinates, syntheticLine);
});

test('omitted detail, zero, string and an extra off-route row do not supply a width', () => {
  const data = { segment_codes: ['reported', 'missing', 'zero', 'text'],
    segments: [detail('reported', 2), detail('zero', 0), detail('text', '1'), detail('elsewhere', .3)] };
  const facts = routeBottleneck(data);
  assert.deepEqual([facts.known, facts.total, facts.segment.code], [1, 4, 'reported']);
  assert.deepEqual(routeBottleneck(route(detail('bad', null), detail('invalid', -1))),
    { known: 0, total: 2, segment: null });
});

test('duplicate detail records are ambiguous and do not override the next known width', () => {
  const data = { segment_codes: ['x', 'y'], segments: [detail('x', .9), detail('x', 3), detail('y', 3.5)] };
  assert.deepEqual([routeBottleneck(data).known, routeBottleneck(data).segment.code], [1, 'y']);
});

test('an unlocatable mathematical minimum is not replaced by a wider or same-width locatable row', () => {
  for (const invalid of [null, [[106, 29]], [[106,29], [106,29]], [[106,29], [300,29]], [[106,29],[106,'29']]]) {
    const report = routeBottleneck(route(detail('true min', .9, invalid), detail('tie', .9), detail('wider', 2)));
    assert.deepEqual([report.known, report.segment.code, report.segment.coordinates], [3, 'true min', null]);
  }
});

test('overlays use only the focused route geometry, reset to source, and preserve other features', () => {
  const old = { type:'Feature', geometry:{ type:'LineString', coordinates:[[0, 0], [1, 1]] },
    properties:{kind:'segment', segment_code:'current minimum', step_count: 2} };
  const shape = { type:'Feature', geometry:{ type:'Point', coordinates:[0, 0] }, properties:{ kind:'poi' } };
  const base = [old, shape];
  const a = routeBottleneck(current).segment;
  const b = routeBottleneck(reference).segment;
  const focused = mapFeaturesForBottleneck(base, a);
  assert.equal(focused[1], shape);
  assert.equal(focused[0].properties.step_count, 2);
  assert.deepEqual(focused[0].geometry.coordinates, a.coordinates);
  assert.deepEqual(old.geometry.coordinates, [[0, 0], [1, 1]]);
  const switched = mapFeaturesForBottleneck(base, b);
  assert.equal(switched[0], old);
  assert.equal(switched[2].properties.segment_code, b.code);
  assert.deepEqual(switched[2].geometry.coordinates, b.coordinates);
  assert.equal(mapFeaturesForBottleneck(base, { ...a, coordinates:null }), base);
  assert.equal(mapFeaturesForBottleneck(base, null), base);
});

test('route page states known coverage, differentiates reference, and with missing geometry does not offer a map target', async () => {
  const stubs = { name:'bottleneck-browser-stub', enforce:'pre',
    resolveId(source) { if (source.endsWith('/AmapRouteMap.vue') || source.endsWith('/EvidenceGallery.vue')) return '\0bottleneck-browser-stub'; },
    load(id) { if (id === '\0bottleneck-browser-stub') return 'export default { render: () => null }'; },
  };
  const server = await createServer({ configFile:false, envDir:false, plugins:[stubs, vue()],
    server:{ middlewareMode:true, watch:null }, optimizeDeps:{ noDiscovery:true, include:[] } });
  try {
    const { default: Page } = await server.ssrLoadModule('/src/pages/RouteOptionsPage.vue');
    const render = extra => renderToString(createSSRApp(Page, {
      apiBaseUrl:'', selectedRoute:current, walkingReference:reference, comparisonAvailable:true,
      comparisonState:'ready', ...extra,
    }));
    const layout = await render({});
    for (const label of ['路线最窄路段', '登记宽度 2/2 段', '1.3 米', '2.5 米',
      'locate-bottleneck-current', 'locate-bottleneck-reference', '不代表现场通行安全']) {
      assert.ok(layout.includes(label), label);
    }
    const unknown = await render({ selectedRoute: {
      segment_codes:['x','unreported'], segments:[detail('x',1,null)],
    }, comparisonAvailable:false });
    assert.match(unknown, /登记宽度 1\/2 段/);
    assert.match(unknown, /未登记路段可能更窄/);
    assert.match(unknown, /缺少该路段登记图形，无法定位/);
    assert.doesNotMatch(unknown, /locate-bottleneck-current|locate-bottleneck-reference/);
    assert.match(unknown, /开始导航/);
  } finally { await server.close(); }
});
