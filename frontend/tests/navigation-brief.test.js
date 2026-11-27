import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrentStepBrief } from '../src/utils/navigationBrief.js';

function route() {
  return { segment_codes: ['first', 'middle', 'last'], distance_m: 300,
    segments: [
      { segment_code: 'first', name: '合成路段一', length_m: 120.5, step_count: 0 },
      { segment_code: 'middle', name: '合成路段二', length_m: 80, step_count: 7 },
      { segment_code: 'last', name: '合成路段三', length_m: 99.5, step_count: 4 },
    ] };
}

test('brief follows ordered identity with current name, whole-leg length, stairs and field check', () => {
  const r = route();
  r.segments.reverse();
  assert.equal(buildCurrentStepBrief(r, 0), '第 1 段：合成路段一。本段登记全长 120.5 米。本段台阶数量未确认。请核对现场。');
  assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：合成路段二。本段登记全长 80 米。本段登记 7 级台阶。请核对现场。');
  assert.equal(buildCurrentStepBrief(r, 2), '第 3 段：合成路段三。本段登记全长 99.5 米。本段登记 4 级台阶。请核对现场。');
  assert.equal(buildCurrentStepBrief(r, 0), '第 1 段：合成路段一。本段登记全长 120.5 米。本段台阶数量未确认。请核对现场。');
});

test('current length needs no route total or other leg evidence and never becomes remaining distance', () => {
  const r = route();
  delete r.distance_m;
  r.segments = [r.segments[1]];
  const expected = '第 2 段：合成路段二。本段登记全长 80 米。本段登记 7 级台阶。请核对现场。';
  assert.equal(buildCurrentStepBrief(r, 1), expected);
  for (const total of [0, -1, 9999, '300', NaN, Infinity, null]) {
    r.distance_m = total;
    assert.equal(buildCurrentStepBrief(r, 1), expected);
  }
  assert.doesNotMatch(expected, /剩余|还有|距离|估算|即将|到达|左转|右转|直行|实时/);
});

test('missing current registration cannot fall back to position, a matching name or geometry', () => {
  const r = route();
  r.segments[1] = { segment_code: 'unrelated', name: '合成路段二', length_m: 80,
    step_count: 7, geometry_coordinates: [[0, 0], [1, 1]] };
  r.navigationRows = [{ segment_code: 'middle', name: '路段资料未确认' }];
  assert.equal(buildCurrentStepBrief(r, 1), '');
  assert.equal(buildCurrentStepBrief(r, 0), '第 1 段：合成路段一。本段登记全长 120.5 米。本段台阶数量未确认。请核对现场。');
  r.segments = [{ segment_code: ' middle ', name: '合成路段二', step_count: 7 }];
  assert.equal(buildCurrentStepBrief(r, 1), '', 'code matching cannot trim or otherwise coerce identity');
});

test('current code must have exactly one matching object row', () => {
  const invalidArrays = [undefined, null, {}, 'rows', []];
  for (const segments of invalidArrays) {
    const r = route(); r.segments = segments;
    assert.equal(buildCurrentStepBrief(r, 1), '');
  }
  const r = route();
  r.segments.push({ ...r.segments[1] });
  assert.equal(buildCurrentStepBrief(r, 1), '');
  const arrayRow = [];
  arrayRow.segment_code = 'middle'; arrayRow.name = '数组伪记录'; arrayRow.step_count = 7;
  r.segments = [null, undefined, 'middle', 1, arrayRow];
  assert.equal(buildCurrentStepBrief(r, 1), '');
  r.segments.push({ segment_code: 'middle', name: '记录', step_count: 7 });
  assert.equal(buildCurrentStepBrief(r, 1), '', 'a malformed duplicate must not erase ambiguous identity');
  const functionRow = () => {};
  functionRow.segment_code = 'middle';
  r.segments = [functionRow];
  assert.equal(buildCurrentStepBrief(r, 1), '');
});

test('a valid current row does not depend on unrelated malformed registrations', () => {
  const r = route();
  r.segments.push(null, 7, {}, { segment_code: 'other', name: '无关记录' }, { ...r.segments[2] });
  assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：合成路段二。本段登记全长 80 米。本段登记 7 级台阶。请核对现场。');
});

test('all ordered codes must be nonempty unique strings without sparse slots', () => {
  const inheritedSparse = ['first', , 'last'];
  Object.setPrototypeOf(inheritedSparse, Object.assign(Object.create(Array.prototype), { 1: 'middle' }));
  const invalidCodes = [undefined, null, '', {}, [], ['first', '', 'last'], ['first', ' ', 'last'],
    ['first', null, 'last'], ['first', undefined, 'last'], ['first', 7, 'last'],
    ['first', true, 'last'], ['first', new String('middle'), 'last'],
    ['first', 'middle', 'first'], ['first', , 'last'], inheritedSparse];
  for (const codes of invalidCodes) {
    const r = route(); r.segment_codes = codes;
    assert.equal(buildCurrentStepBrief(r, 0), '', `invalid code list ${String(codes)}`);
  }
});

test('index must be an in-range integer and absent routes cannot prove a step', () => {
  for (const index of [undefined, null, -1, 3, 0.5, '0', true, false, NaN, Infinity,
    -Infinity, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, {}, []])
    assert.equal(buildCurrentStepBrief(route(), index), '');
  for (const r of [undefined, null, {}, [], 0, 'route']) assert.equal(buildCurrentStepBrief(r, 0), '');
});

test('only finite strictly positive numeric current lengths are included', () => {
  const invalidLengths = [undefined, null, '', '80', 0, -0, -1, NaN, Infinity, -Infinity,
    true, false, {}, [], { valueOf() { throw new Error('must not coerce lengths'); } }];
  for (const value of invalidLengths) {
    const r = route(); r.segments[1].length_m = value;
    assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：合成路段二。本段登记 7 级台阶。请核对现场。');
  }
  for (const value of [0.001, 80, Number.MIN_VALUE, Number.MAX_VALUE]) {
    const r = route(); r.segments[1].length_m = value;
    assert.equal(buildCurrentStepBrief(r, 1), `第 2 段：合成路段二。本段登记全长 ${value} 米。本段登记 7 级台阶。请核对现场。`);
  }
});

test('stairs report only safe positive integers; DTO zero and invalid counts are not evidence', () => {
  const invalidCounts = [0, -0, undefined, null, '', '0', '7', -1, 0.5, NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, true, false, {}, [],
    { valueOf() { throw new Error('must not coerce counts'); } }];
  for (const value of invalidCounts) {
    const r = route(); r.segments[1].step_count = value;
    assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：合成路段二。本段登记全长 80 米。本段台阶数量未确认。请核对现场。');
  }
  for (const value of [1, Number.MAX_SAFE_INTEGER]) {
    const r = route(); r.segments[1].step_count = value;
    assert.equal(buildCurrentStepBrief(r, 1), `第 2 段：合成路段二。本段登记全长 80 米。本段登记 ${value} 级台阶。请核对现场。`);
  }
});

test('missing names use a registration label and unknown length and stairs remain independent', () => {
  const missingNames = [undefined, null, '', ' \n\t ', 0, 7, false, {}, [], '*#`'];
  for (const name of missingNames) {
    const r = route(); r.segments[1] = { segment_code: 'middle', name };
    assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：路段名称未记录。本段台阶数量未确认。请核对现场。');
  }
});

test('registered names have the same sanitized bounded text for display and speech', () => {
  const r = route();
  r.segments[1].name = ' \n*合成#路段`\t二\u0000 ';
  assert.equal(buildCurrentStepBrief(r, 1), '第 2 段：合成路段 二。本段登记全长 80 米。本段登记 7 级台阶。请核对现场。');
  r.segments[1].name = '😀'.repeat(4000) + '*#`';
  const text = buildCurrentStepBrief(r, 1);
  assert.equal(text, `第 2 段：${'😀'.repeat(160)}。本段登记全长 80 米。本段登记 7 级台阶。请核对现场。`);
  assert.equal(text.replace(/[*#`]/g, '').slice(0, 3500).trim(), text);
  assert.ok(text.length < 3500);
  assert.match(text, /请核对现场。$/, 'bounded names cannot truncate the final boundary');
});

test('preview, explanation, risk and geometry cannot supply or change brief facts', () => {
  const r = route();
  const expected = buildCurrentStepBrief(r, 1);
  Object.assign(r, { explanation: '马上左转，已到达', risk_notice: '无台阶',
    preview_text: '还有 999 米，放心通行', navigation_instruction: '右转',
    geometry_coordinates: [[0, 0], [1, 1]] });
  Object.assign(r.segments[1], { explanation: '已到达', risk_notice: '还有 999 米',
    instruction: '左转', geometry_coordinates: ['invalid'] });
  assert.equal(buildCurrentStepBrief(r, 1), expected);
  assert.doesNotMatch(expected, /马上|左转|右转|直行|到达|999|放心|无台阶|可通行/);
});

test('brief is pure: frozen registrations are unchanged and no network, timer or speech is invoked', () => {
  const r = route();
  const before = JSON.stringify(r);
  r.segments.forEach(Object.freeze); Object.freeze(r.segments); Object.freeze(r.segment_codes); Object.freeze(r);
  const prior = { fetch: globalThis.fetch, speechSynthesis: globalThis.speechSynthesis,
    setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval };
  const unexpected = () => { throw new Error('brief builder must not create effects'); };
  globalThis.fetch = unexpected; globalThis.speechSynthesis = { speak: unexpected, cancel: unexpected };
  globalThis.setTimeout = unexpected; globalThis.setInterval = unexpected;
  try {
    const text = buildCurrentStepBrief(r, 1);
    assert.equal(text, buildCurrentStepBrief(r, 1));
    assert.equal(JSON.stringify(r), before);
  } finally {
    Object.assign(globalThis, prior);
  }
});
