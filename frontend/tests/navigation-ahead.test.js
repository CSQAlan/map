import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { navigationStairs, buildAheadSummary } from '../src/utils/navigationAhead.js';
import { navigationRest } from '../src/utils/navigationRest.js';

// Synthetic route registrations: geometry never establishes stair or rest evidence.
function route() {
  const codes = ['first', 'middle', 'target', 'last'];
  return { distance_m: 200, segment_codes: codes, segments: codes.map((segment_code, i) => ({
    segment_code, name: `合成路段${i + 1}`, length_m: [100, 50, 30, 20][i],
    step_count: [0, 0, 7, 4][i],
  })) };
}
function restRoute() {
  const r = route();
  r.navigation_rest = { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1',
    segment_codes: [...r.segment_codes], node_codes: ['A', 'B', 'C', 'D', 'E'],
    segment_lengths_m: [100, 50, 30, 20],
    stops: [{ node_code: 'C', node_index: 2, name: '合成中途休息点' },
      { node_code: 'E', node_index: 4, name: '合成终点休息点' }] };
  return r;
}

const unmarked = '前方未标注台阶，不能确认无台阶，请核对现场';
test('legacy zeros and mixed unknowns use the same unmarked warning without claiming measured zero', () => {
  for (const values of [[0, 0, 0, 0], [0, undefined, 0, null], [undefined, null, '0', -1]]) {
    const r = route(); r.segments.forEach((row, i) => { row.step_count = values[i]; });
    const hint = navigationStairs(r, 0);
    assert.equal(hint.state, values.every(value => value === 0) ? 'none' : 'unknown');
    assert.equal(hint.count, null); assert.equal(hint.distance, null);
    assert.ok(hint.text.includes(unmarked));
    const summary = buildAheadSummary(hint, { state: 'unknown' });
    assert.ok(summary.startsWith(hint.text), 'screen and one-shot speech share the validated stair wording');
    assert.doesNotMatch(hint.text + summary, /均为 0|登记 0 级|没有台阶|无障碍|可以通行/);
    if (hint.state === 'unknown') assert.match(hint.text, /缺失或无效/);
  }
});

test('earlier legacy zeros qualify the first known positive, including exact count and segment-entry distance', () => {
  const r = route(), before = JSON.stringify(r);
  const hint = navigationStairs(r, 0);
  assert.equal(hint.qualified, true); assert.equal(hint.count, 7); assert.equal(hint.distance, 150);
  assert.match(hint.text, /已登记最先/); assert.match(hint.text, /前面路段.*不能确认无台阶/);
  const summary = buildAheadSummary(hint, { state: 'unknown' });
  assert.ok(summary.startsWith(hint.text));
  assert.match(summary, /不是距实际台阶位置的距离/);
  assert.equal(navigationStairs(r, 2).qualified, false, 'current positive remains a known registration');
  assert.equal(JSON.stringify(r), before);
});

test('empty stair summaries require strict helper shape and ignore supplied prose', () => {
  const r = route(); r.segments.forEach(row => { row.step_count = 0; });
  const none = navigationStairs(r, 0);
  assert.ok(buildAheadSummary({ ...none, text: '所有路段已实测无台阶' }, null).startsWith(unmarked));
  for (const state of ['none', 'unknown']) for (const change of [
    { code: 'first' }, { name: '伪记录' }, { count: 0 }, { index: 0 }, { distance: 0 }, { qualified: true },
  ]) {
    const summary = buildAheadSummary({ ...none, state, ...change }, null);
    assert.match(summary, /台阶.*证据不足/); assert.ok(!summary.includes(unmarked));
  }
});

test('ordered route identities find the first registered positive count across every future leg', () => {
  const r = route();
  r.segments.reverse();
  const hint = navigationStairs(r, 0);
  assert.deepEqual({ state: hint.state, code: hint.code, name: hint.name, count: hint.count,
    index: hint.index, distance: hint.distance, qualified: hint.qualified }, {
    state: 'ahead', code: 'target', name: '合成路段3', count: 7, index: 2, distance: 150, qualified: true,
  });
  assert.match(hint.text, /第 3 段.*合成路段3.*7 级台阶/);
  assert.match(hint.text, /进入该路段前.*150 米/);
  assert.match(hint.text, /当前整段/);
  assert.match(hint.text, /不是.*台阶.*距离/);
  assert.doesNotMatch(hint.text, /180 米|200 米|还有 150 米到台阶/);
});

test('manual progress and backtracking update identity; current stairs never invent a point distance', () => {
  const r = route();
  assert.equal(navigationStairs(r, 0).distance, 150);
  assert.equal(navigationStairs(r, 1).distance, 50);
  const current = navigationStairs(r, 2);
  assert.equal(current.state, 'current'); assert.equal(current.distance, null);
  assert.equal(current.code, 'target'); assert.match(current.text, /合成路段3.*本段登记 7 级台阶/);
  assert.doesNotMatch(current.text, /米|即将|走到/);
  assert.equal(navigationStairs(r, 3).code, 'last');
  assert.equal(navigationStairs(r, 1).distance, 50);
  assert.equal(navigationStairs(r, 0).distance, 150);
});

test('missing geometry, malformed geometry and lookalike names never alter registration evidence', () => {
  const r = route();
  for (const row of r.segments) { row.name = '同名路段'; row.geometry_coordinates = ['invalid']; }
  r.segments.reverse();
  const hint = navigationStairs(r, 0);
  assert.equal(hint.code, 'target'); assert.equal(hint.count, 7); assert.equal(hint.distance, 150);
  delete r.segments[1].name;
  assert.equal(navigationStairs(r, 0).name, '路段名称未记录');
  assert.equal(navigationStairs(r, 0).state, 'ahead');
});

test('unknown records before the first positive qualify its ordering without suppressing it', () => {
  const r = route(); delete r.segments[0].step_count;
  const hint = navigationStairs(r, 0);
  assert.equal(hint.state, 'ahead'); assert.equal(hint.qualified, true);
  assert.equal(hint.count, 7); assert.equal(hint.distance, 150);
  assert.match(hint.text, /已登记最先/); assert.match(hint.text, /前面.*未确认/);
  assert.equal(navigationStairs(r, 1).qualified, true, 'the remaining zero also cannot confirm a clear leg');
  assert.equal(navigationStairs(r, 2).qualified, false, 'passed unknown records cannot qualify current stairs');
  r.segments[0].step_count = 0; delete r.segments[3].step_count;
  assert.equal(navigationStairs(r, 0).qualified, true, 'earlier zeros still qualify the known stair segment');
  assert.equal(navigationStairs(r, 2).qualified, false, 'unknown after the first positive cannot change its order');
});

const invalidCounts = [undefined, null, '', '0', '7', -1, 1.5, NaN, Infinity, -Infinity,
  Number.MAX_SAFE_INTEGER + 1, true, false, {}, []];
for (const value of invalidCounts) test(`step count ${String(value)} is unknown, never verified zero`, () => {
  const r = route(); r.segments.forEach(row => { row.step_count = 0; });
  r.segments[1].step_count = value;
  assert.equal(navigationStairs(r, 0).state, 'unknown');
  assert.equal(navigationStairs(r, 1).state, 'unknown');
  assert.equal(navigationStairs(r, 2).state, 'none', 'passed invalid count is ignored');
  r.segments[2].step_count = 7;
  assert.equal(navigationStairs(r, 0).qualified, true);
});

test('only safe integer numeric counts qualify, including safe integer bounds', () => {
  const r = route(); r.segments.forEach(row => { row.step_count = 0; });
  const none = navigationStairs(r, 0);
  assert.equal(none.state, 'none'); assert.equal(none.distance, null);
  assert.equal(none.text, `${unmarked}。`);
  r.segments[3].step_count = Number.MAX_SAFE_INTEGER;
  assert.equal(navigationStairs(r, 0).count, Number.MAX_SAFE_INTEGER);
  assert.equal(navigationStairs(r, 3).state, 'current');
});

test('missing and duplicate matching rows are unknown even when their count appears to be zero', () => {
  const r = route(); r.segments.forEach(row => { row.step_count = 0; });
  r.segments.splice(1, 1);
  assert.equal(navigationStairs(r, 0).state, 'unknown');
  assert.equal(navigationStairs(r, 2).state, 'none');
  r.segments.push({ segment_code: 'middle', step_count: 0, length_m: 50 });
  r.segments.push({ segment_code: 'middle', step_count: 0, length_m: 50 });
  assert.equal(navigationStairs(r, 0).state, 'unknown');
  r.segments.find(row => row.segment_code === 'target').step_count = 7;
  const hint = navigationStairs(r, 0);
  assert.equal(hint.state, 'ahead'); assert.equal(hint.qualified, true); assert.equal(hint.distance, null);
});

test('a different row cannot supply stairs by position, name or geometry', () => {
  const r = route(); r.segments[0].step_count = 0;
  r.segments[2].segment_code = 'unrelated';
  r.segments[3].step_count = 0;
  assert.equal(navigationStairs(r, 0).state, 'unknown');
  assert.equal(navigationStairs(r, 2).state, 'unknown');
});

const invalidCodes = [undefined, null, [], ['first', '', 'target'], ['first', ' ', 'target'],
  ['first', null, 'target'], ['first', 4, 'target'], ['first', 'first', 'target'],
  ['first', , 'target']];
for (const codes of invalidCodes) test(`invalid ordered route codes ${JSON.stringify(codes)} are conservative`, () => {
  const r = route(); r.segment_codes = codes;
  const hint = navigationStairs(r, 0);
  assert.equal(hint.state, 'unknown'); assert.equal(hint.distance, null); assert.equal(hint.count, null);
});
for (const index of [-1, 4, 0.5, '0', null, undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER])
  test(`invalid manual index ${String(index)} is unknown`, () => {
    assert.equal(navigationStairs(route(), index).state, 'unknown');
  });

const badDistanceProof = [
  ['missing route total', r => { delete r.distance_m; }],
  ['null route total', r => { r.distance_m = null; }],
  ['string route total', r => { r.distance_m = '200'; }],
  ['zero route total', r => { r.distance_m = 0; }],
  ['negative route total', r => { r.distance_m = -200; }],
  ['NaN route total', r => { r.distance_m = NaN; }],
  ['infinite route total', r => { r.distance_m = Infinity; }],
  ['total mismatch', r => { r.distance_m = 201; }],
  ['missing current length', r => { delete r.segments[0].length_m; }],
  ['missing target length', r => { delete r.segments[2].length_m; }],
  ['missing later length', r => { delete r.segments[3].length_m; }],
  ['invalid passed length', r => { r.segments[0].length_m = -100; }],
  ['string length', r => { r.segments[1].length_m = '50'; }],
  ['zero length', r => { r.segments[1].length_m = 0; }],
  ['negative length', r => { r.segments[1].length_m = -1; }],
  ['null length', r => { r.segments[1].length_m = null; }],
  ['NaN length', r => { r.segments[1].length_m = NaN; }],
  ['infinite length', r => { r.segments[1].length_m = Infinity; }],
  ['sum overflow', r => { r.segments.forEach(row => { row.length_m = Number.MAX_VALUE; }); }],
  ['missing row', r => { r.segments.shift(); }],
  ['duplicate row', r => { r.segments.push({ ...r.segments[0] }); }],
  ['extra unrelated row', r => { r.segments.push({ segment_code: 'other', length_m: 99, step_count: 0 }); }],
];
for (const [label, mutate] of badDistanceProof) test(`${label} suppresses only unproved distance`, () => {
  const r = route(); mutate(r);
  const hint = navigationStairs(r, 1);
  assert.equal(hint.state, 'ahead'); assert.equal(hint.code, 'target'); assert.equal(hint.count, 7);
  assert.equal(hint.distance, null); assert.match(hint.text, /7 级台阶/);
  assert.doesNotMatch(hint.text, /约 .*米/); assert.match(hint.text, /路程.*未确认/);
});

test('distance comparison follows DTO hundredths and rounds only the final sum', () => {
  const r = route();
  r.segments.forEach((row, i) => { row.length_m = [100.125, 50.125, 30.125, 20.125][i]; });
  r.distance_m = 200.5;
  assert.equal(navigationStairs(r, 0).distance, 150.25);
  r.distance_m = 200.51;
  assert.equal(navigationStairs(r, 0).distance, null);
});

test('missing row arrays remain unknown; passed rows cannot become the current record', () => {
  const r = route(); r.segments = null;
  assert.equal(navigationStairs(r, 0).state, 'unknown');
  r.segments = [{ segment_code: 'first', step_count: 9, length_m: 100 }];
  assert.equal(navigationStairs(r, 1).state, 'unknown');
});

test('hidden states erase stale route fields immediately', () => {
  for (const options of [{ paused: true }, { active: false }, { paused: true, active: false }])
    assert.deepEqual(navigationStairs(route(), 0, options), { state: 'hidden' });
  assert.deepEqual(navigationStairs(null, 0), { state: 'hidden' });
  assert.deepEqual(navigationStairs(undefined, 0), { state: 'hidden' });
});

test('summary uses helper evidence and distinguishes leg entry estimate from registered rest route estimate', () => {
  const r = restRoute();
  const summary = buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0));
  assert.match(summary, /第 3 段.*7 级/); assert.match(summary, /进入该路段前.*登记路程.*150 米/);
  assert.match(summary, /合成中途休息点.*登记路程.*150 米/);
  assert.match(summary, /不是实时距离/); assert.doesNotMatch(summary, /即将|放心|可通行|无障碍/);
  assert.doesNotMatch(summary, /合成终点休息点/, 'a destination is not an upcoming intermediate rest point');
});

test('summary preserves missing stair evidence and absence of marked intermediate rest points', () => {
  const r = restRoute(); delete r.segments[0].step_count;
  r.navigation_rest.stops = [];
  let summary = buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0));
  assert.match(summary, /已登记最先/); assert.match(summary, /前面.*未确认/);
  assert.match(summary, /未标注中途休息点/);
  r.segments.forEach(row => { delete row.step_count; });
  summary = buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0));
  assert.match(summary, /台阶资料缺失或无效/); assert.ok(summary.includes(unmarked));
  assert.doesNotMatch(summary, /0 级|没有台阶/);
  r.segments.forEach(row => { row.step_count = 0; });
  summary = buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0));
  assert.ok(summary.startsWith(`${unmarked}。`));
  delete r.navigation_rest;
  assert.match(buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0)), /休息点.*证据不足/);
});

test('current summary has no stair distance; invalid distances keep the registered stair count', () => {
  const r = restRoute();
  assert.match(buildAheadSummary(navigationStairs(r, 2), navigationRest(r, 2)), /本段登记 7 级台阶/);
  r.distance_m = '200';
  const summary = buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0));
  assert.match(summary, /7 级/); assert.match(summary, /进入该路段前登记路程暂未确认/);
  assert.match(summary, /休息点.*证据不足/); assert.doesNotMatch(summary, /150 米/);
});

test('summary preserves valid rest helper estimates rounded to zero hundredths', () => {
  const r = restRoute();
  r.segments.forEach(row => { row.length_m = 0.001; row.step_count = 0; });
  r.distance_m = 0.004;
  r.navigation_rest.segment_lengths_m = r.segments.map(row => row.length_m);
  const rest = navigationRest(r, 0);
  assert.equal(rest.state, 'upcoming'); assert.equal(rest.distance, 0);
  const summary = buildAheadSummary(navigationStairs(r, 0), rest);
  assert.match(summary, /合成中途休息点.*估算登记路程约 0 米/);
  assert.match(summary, /不是实时距离/); assert.doesNotMatch(summary, /休息点登记证据不足/);
});

test('summary rejects arbitrary raw route, invalid helper objects and unsafe numbers', () => {
  const good = navigationStairs(route(), 0);
  const badStairs = [null, route(), { state: 'ahead' }, { ...good, count: '7' },
    { ...good, count: -7 }, { ...good, count: 1.1 }, { ...good, name: '' },
    { ...good, distance: NaN }, { ...good, index: -1 }, { ...good, qualified: 'false' }];
  for (const input of badStairs) {
    const summary = buildAheadSummary(input, { state: 'unknown' });
    assert.match(summary, /台阶.*证据不足/); assert.doesNotMatch(summary, /7 级|150 米/);
  }
  const invalidRests = [null, route(), { state: 'upcoming', name: '不可靠点', distance: 100 },
    { state: 'upcoming', name: '不可靠点', distance: '100', nodeCode: 'B' },
    { state: 'upcoming', name: '不可靠点', distance: NaN, nodeCode: 'B' },
    { state: 'upcoming', name: '', distance: 100, nodeCode: 'B' }];
  for (const input of invalidRests) {
    const summary = buildAheadSummary(good, input);
    assert.match(summary, /休息点.*证据不足/); assert.doesNotMatch(summary, /不可靠点|100 米/);
  }
});

test('either hidden helper hides the combined summary and no automatic side effects are used', () => {
  assert.equal(buildAheadSummary({ state: 'hidden' }, { state: 'unknown' }), '');
  assert.equal(buildAheadSummary(navigationStairs(route(), 0), { state: 'hidden' }), '');
  const r = restRoute(), priorFetch = globalThis.fetch, priorSpeech = globalThis.speechSynthesis,
    priorTimer = globalThis.setTimeout;
  const unexpected = () => { throw new Error('display helpers must not create side effects'); };
  globalThis.fetch = unexpected; globalThis.speechSynthesis = { speak: unexpected };
  globalThis.setTimeout = unexpected;
  try {
    const before = JSON.stringify(r);
    assert.match(buildAheadSummary(navigationStairs(r, 0), navigationRest(r, 0)), /7 级/);
    assert.equal(JSON.stringify(r), before, 'helper must not mutate route evidence');
  } finally { globalThis.fetch = priorFetch; globalThis.speechSynthesis = priorSpeech; globalThis.setTimeout = priorTimer; }
});

test('real directed seed chain records 184m to known stair leg entry without certifying earlier zeros', async () => {
  const seed = JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json', import.meta.url), 'utf8'));
  function seeded(codes) {
    const rows = codes.map(code => {
      const matches = seed.filter(row => row.segment_code === code);
      assert.equal(matches.length, 1, `unique seed registration ${code}`);
      return matches[0];
    });
    for (let i = 1; i < rows.length; i++)
      assert.equal(rows[i - 1].end_node_code, rows[i].start_node_code, 'connected directed seed legs');
    return { segment_codes: codes, segments: rows, distance_m: rows.reduce((sum, row) => sum + row.length_m, 0) };
  }
  const garden = seeded(['S_SY_GATE_TO_GARDEN_SPLIT', 'S_SY_GARDEN_SPLIT_TO_REST',
    'S_SY_GARDEN_REST_TO_BRIDGE', 'S_SY_BRIDGE_TO_LOTUS']);
  assert.deepEqual(garden.segments.map(row => row.length_m), [184, 86, 78, 96]);
  assert.deepEqual(garden.segments.map(row => row.step_count), [0, 1, 1, 1]);
  assert.equal(garden.distance_m, 444);
  assert.equal(navigationStairs(garden, 0).distance, 184);
  assert.equal(navigationStairs(garden, 0).code, 'S_SY_GARDEN_SPLIT_TO_REST');
  assert.equal(navigationStairs(garden, 0).qualified, true);
  assert.match(navigationStairs(garden, 0).text, /前面路段.*不能确认无台阶/);
  assert.match(navigationStairs(garden, 0).text, /不是距实际台阶位置的距离/);
  assert.equal(navigationStairs(garden, 1).state, 'current');
  assert.equal(navigationStairs(garden, 1).count, 1);
  assert.equal(navigationStairs(garden, 1).distance, null);
  const main = seeded(['S_SY_GATE_TO_MAIN', 'S_SY_MAIN_TO_LOTUS']);
  assert.equal(main.distance_m, 246);
  for (const index of [0, 1]) {
    const hint = navigationStairs(main, index);
    assert.equal(hint.state, 'none'); assert.equal(hint.text, `${unmarked}。`);
  }
});
