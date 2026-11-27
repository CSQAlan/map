import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteMemo, ROUTE_MEMO_CAVEAT } from '../src/utils/navigationMemo.js';

const route = () => ({ distance_m: 180.5, segment_codes: ['a', 'b'], segments: [
  { segment_code: 'a', name: '合成林荫步道', length_m: 100.5 },
  { segment_code: 'b', name: '合成环湖步道', length_m: 80 },
] });
const registry = () => route().segments.map(row => ({ properties: { kind: 'segment', ...row } }));
const build = (r = route(), features = registry(), verifiedOrdinary = true) => buildRouteMemo(r, features, { verifiedOrdinary });

test('memo follows exact selected code order with verified names and whole-leg lengths only', () => {
  const r = route(); r.segments.reverse();
  const memo = build(r);
  assert.equal(memo.available, true);
  assert.equal(memo.text, `路线备忘\n${ROUTE_MEMO_CAVEAT}\n当前所选路线的完整登记顺序；长度为各段登记全长，包含已手动确认的路段，不是当前位置的剩余距离。\n1. 合成林荫步道 — 登记全长 100.5 米\n2. 合成环湖步道 — 登记全长 80 米\n不提供转弯、入口或现场通行保证；终点登记不等于已到目的地。`);
  assert.equal(ROUTE_MEMO_CAVEAT, '离线文字备忘，不是实时导航/定位/到达证明；请核对现场。');
});

test('only a proven ordinary active itinerary can be exported; GPS contexts never qualify', () => {
  assert.equal(build(route(), registry(), false).available, false);
  assert.equal(buildRouteMemo(route(), registry()).available, false);
  for (const start_context of [{}, { snapped_coordinates: [10, 10] }, 'private'])
    assert.equal(build({ ...route(), start_context }).available, false);
});

test('reject missing, duplicate, extra, sparse and malformed ordered evidence', () => {
  const mutations = [
    r => { r.segment_codes = []; }, r => { r.segment_codes[1] = 'a'; },
    r => { r.segment_codes[1] = ''; }, r => { delete r.segment_codes[0]; },
    r => { r.segment_codes[0] = 1; }, r => { r.segments.pop(); },
    r => { r.segments.push({ ...r.segments[0] }); }, r => { delete r.segments[1]; },
    r => { r.segments[0] = null; }, r => { r.segments[0] = Object.assign([], r.segments[0]); },
    r => { r.segments.push({ segment_code: 'other', name: '其他路', length_m: 5 }); },
    r => { r.segments[0].segment_code = ' a '; },
    r => { r.segment_codes = Array(101).fill('a'); },
  ];
  for (const mutate of mutations) { const r = route(); mutate(r); assert.equal(build(r).available, false); }
  for (const r of [null, undefined, {}, [], 'route'])
    assert.equal(buildRouteMemo(r, registry(), { verifiedOrdinary: true }).available, false);
});

test('unverified, changed, missing, ambiguous or unsafe registration labels cannot become memo text', () => {
  for (const name of [undefined, null, '', ' ', '路段资料未确认', '路段名称未记录', '未登记步道',
    '合成路\n请左转', '合成路\u202e', '<script>合成路</script>', '123.45,67.89', 'a'.repeat(81)]) {
    const r = route(); r.segments[0].name = name;
    assert.equal(build(r).available, false);
  }
  for (const change of [f => f.pop(), f => f.push(f[0]), f => { f[0].properties.name = '另一登记道路'; },
    f => { f[0] = null; }, f => { f[0].properties = Object.assign([], f[0].properties); }]) {
    const f = registry(); change(f); assert.equal(build(route(), f).available, false);
  }
});

test('known strictly positive finite numeric lengths must match all registrations and route total', () => {
  for (const value of [undefined, null, '100.5', 0, -1, NaN, Infinity, true, 1e100, 0.000001]) {
    const r = route(); r.segments[0].length_m = value; assert.equal(build(r).available, false);
  }
  for (const value of [undefined, null, '180.5', 0, -1, NaN, Infinity, 181]) {
    const r = route(); r.distance_m = value; assert.equal(build(r).available, false);
  }
  const f = registry(); f[0].properties.length_m = 999; assert.equal(build(route(), f).available, false);
});

test('all non-whitelisted fields are ignored, with no personal data, instructions, identifiers or geometry', () => {
  const r = route(), f = registry(), expected = build(r, f).text;
  const privateFields = { name_of_person: 'PERSON_SENTINEL', token: 'AUTH_SENTINEL', id: 'ID_SENTINEL',
    start_name: 'PRIVATE_ORIGIN', end_name: 'PRIVATE_DESTINATION', longitude: 123.456789,
    latitude: 45.678901, timestamp: 'DEVICE_TIMESTAMP', geometry_coordinates: [[123.456789, 45.678901]],
    instruction: '左转后已经到达', explanation: 'FREEFORM_SENTINEL', comment: 'COMMENT_SENTINEL' };
  Object.assign(r, privateFields); r.segments.forEach(row => Object.assign(row, privateFields));
  f.forEach(feature => Object.assign(feature.properties, privateFields));
  assert.equal(build(r, f).text, expected);
  assert.doesNotMatch(expected, /SENTINEL|PRIVATE|123\.456789|45\.678901|TIMESTAMP|segment_code|左转|右转|已经到达/);
});

test('manifest is pure over frozen evidence and invokes no effects', () => {
  const r = route(), f = registry();
  r.segments.forEach(Object.freeze); Object.freeze(r.segments); Object.freeze(r.segment_codes); Object.freeze(r);
  f.forEach(x => { Object.freeze(x.properties); Object.freeze(x); }); Object.freeze(f);
  const before = JSON.stringify([r, f]), originals = new Map();
  for (const key of ['fetch', 'setTimeout', 'setInterval']) {
    originals.set(key, globalThis[key]); globalThis[key] = () => { throw Error('unexpected side effect'); };
  }
  try { assert.equal(build(r, f).available, true); assert.equal(JSON.stringify([r, f]), before); }
  finally { for (const [key, value] of originals) globalThis[key] = value; }
});
