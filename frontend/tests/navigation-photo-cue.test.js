import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigationPhotoCue } from '../src/utils/navigationPhotoCue.js';

// Synthetic public registrations only. No real media, device or live service.
const base = 'https://api.example.test/app';
const photo = (id = 'synthetic-photo-a') => ({ photo_id: id, caption: '合成路段的登记照片',
  risk_tags: ['合成路面提示'], thumbnail_url: `/media/evidence/thumb/${id}.webp`,
  display_url: `/media/evidence/display/${id}.webp` });
const route = () => ({ segment_codes: ['a', 'b', 'c'], segments: [
  { segment_code: 'a', name: '合成林荫步道' },
  { segment_code: 'b', name: '合成环湖步道' },
  { segment_code: 'c', name: '合成出口步道' },
] });
const registry = () => route().segments.map((row, index) => ({ properties: {
  kind: 'segment', ...row, evidence_photos: [photo(`synthetic-photo-${index}`)],
} }));
const build = (r = route(), f = registry(), index = 0, options = {}) =>
  buildNavigationPhotoCue(r, f, index, { verifiedOrdinary: true, apiBaseUrl: base, ...options });

test('only ordered manually selected current and next registered steps are returned', () => {
  const r = route(), f = registry(); r.segments.reverse(); f.reverse();
  const cue = build(r, f, 1);
  assert.deepEqual(cue, { available: true, reason: '', steps: [
    { kind: 'current', index: 1, segmentCode: 'b', name: '合成环湖步道', photos: [
      { photoId: 'synthetic-photo-1', caption: '合成路段的登记照片',
        url: `${base}/media/evidence/display/synthetic-photo-1.webp` },
    ] },
    { kind: 'next', index: 2, segmentCode: 'c', name: '合成出口步道', photos: [
      { photoId: 'synthetic-photo-2', caption: '合成路段的登记照片',
        url: `${base}/media/evidence/display/synthetic-photo-2.webp` },
    ] },
  ] });
  assert.deepEqual(build(r, f, 2).steps.map(step => [step.kind, step.index]), [['current', 2]]);
});

test('proven ordinary context and a valid explicit manual index are required', () => {
  assert.equal(buildNavigationPhotoCue(route(), registry(), 0).available, false);
  for (const verifiedOrdinary of [false, undefined, null, 1, 'true'])
    assert.equal(build(route(), registry(), 0, { verifiedOrdinary }).available, false);
  for (const start_context of [{}, 'context', false, 0])
    assert.equal(build({ ...route(), start_context }).available, false);
  for (const index of [undefined, null, -1, 3, 0.5, NaN, Infinity, '0']) {
    const result = buildNavigationPhotoCue(route(), registry(), index,
      { verifiedOrdinary: true, apiBaseUrl: base });
    assert.equal(result.available, false); assert.deepEqual(result.steps, []);
  }
});

test('the entire route identity and exact registration names must be unambiguous', () => {
  const changes = [
    r => { r.segment_codes = []; }, r => { r.segment_codes[2] = 'a'; },
    r => { r.segment_codes[2] = 'missing'; }, r => { delete r.segment_codes[2]; },
    r => { r.segment_codes[2] = ''; }, r => { r.segment_codes[2] = ' c '; },
    r => { r.segments.pop(); }, r => { r.segments[2] = { ...r.segments[0] }; },
    r => { r.segments.push({ segment_code: 'other', name: '合成额外路段' }); },
    r => { delete r.segments[2]; }, r => { r.segments[2] = null; },
    r => { r.segments[2].name = '改名'; }, r => { r.segments[2].name = ''; },
  ];
  for (const change of changes) {
    const r = route(); change(r); assert.equal(build(r).available, false);
  }
  for (const change of [f => f.pop(), f => f.push(f[2]),
    f => { f[2].properties.kind = 'facility'; }, f => { f[2].properties.name = '另一登记路'; },
    f => { f[2].properties = Object.assign([], f[2].properties); }]) {
    const f = registry(); change(f); assert.equal(build(route(), f).available, false);
  }
  for (const invalid of [null, undefined, {}, [], 'route'])
    assert.equal(buildNavigationPhotoCue(invalid, registry(), 0,
      { verifiedOrdinary: true, apiBaseUrl: base }).available, false);
  for (const name of ['路段名称未记录', '路段资料未确认', '登记资料无效']) {
    const r = route(), f = registry(); r.segments[0].name = name; f[0].properties.name = name;
    assert.equal(build(r, f).available, false, 'matching placeholder names are not verified named roads');
  }
});

test('missing evidence is specific to its own step and never replaced by another step', () => {
  for (const evidence of [undefined, null, []]) {
    const f = registry(); f[0].properties.evidence_photos = evidence;
    const result = build(route(), f);
    assert.equal(result.available, true); assert.equal(result.steps.length, 2);
    assert.deepEqual(result.steps[0].photos, []); assert.ok(result.steps[0].reason);
    assert.equal(result.steps[1].photos[0].photoId, 'synthetic-photo-1');
  }
  const f = registry(); delete f[1].properties.evidence_photos;
  const result = build(route(), f);
  assert.equal(result.steps[0].photos.length, 1); assert.deepEqual(result.steps[1].photos, []);
  assert.ok(result.steps[1].reason);
});

test('both derivative paths must exactly match the safe photo id', () => {
  const changes = [
    p => { p.photo_id = '../outside'; }, p => { p.photo_id = 'a.webp'; },
    p => { p.photo_id = 'a/b'; }, p => { p.photo_id = 'a%2fb'; }, p => { p.photo_id = ''; },
    p => { p.thumbnail_url = '/media/evidence/thumb/other.webp'; },
    p => { p.display_url = '/media/evidence/display/other.webp'; },
    p => { delete p.thumbnail_url; }, p => { delete p.display_url; },
    p => { p.thumbnail_url = 'https://other.example.test/media/evidence/thumb/synthetic-photo-0.webp'; },
    p => { p.display_url = 'https://api.example.test/media/evidence/display/synthetic-photo-0.webp'; },
    p => { p.display_url = '//other.example.test/a.webp'; },
    p => { p.display_url = 'data:image/webp;base64,AAAA'; },
    p => { p.display_url += '?download=1'; }, p => { p.display_url += '#photo'; },
    p => { p.display_url = '/media/evidence/display/../synthetic-photo-0.webp'; },
    p => { p.display_url = '/media/evidence/display/synthetic-photo-0%2ewebp'; },
  ];
  for (const change of changes) {
    const f = registry(); change(f[0].properties.evidence_photos[0]);
    const current = build(route(), f).steps[0];
    assert.deepEqual(current.photos, []); assert.ok(current.reason);
  }
});

test('any malformed evidence metadata invalidates its whole step without filtering forward', () => {
  const invalid = [null, {}, [], { ...photo(), caption: '' }, { ...photo(), caption: ' padded ' },
    { ...photo(), caption: '合成\n照片' }, { ...photo(), caption: '<img>' },
    { ...photo(), risk_tags: undefined }, { ...photo(), risk_tags: 'tag' },
    { ...photo(), risk_tags: [null] }, { ...photo(), risk_tags: [''] },
    { ...photo(), risk_tags: ['tag\u202e'] }];
  for (const item of invalid) {
    const f = registry(); f[0].properties.evidence_photos.push(item);
    const result = build(route(), f);
    assert.deepEqual(result.steps[0].photos, []); assert.ok(result.steps[0].reason);
    assert.equal(result.steps[1].photos.length, 1);
  }
  for (const evidence of [{}, 'photo', Array(1), [photo(), photo()]]) {
    const f = registry(); f[0].properties.evidence_photos = evidence;
    assert.deepEqual(build(route(), f).steps[0].photos, []);
  }
  const f = registry(); f[0].properties.evidence_photos[0].risk_tags = [];
  assert.equal(build(route(), f).steps[0].photos.length, 1);
});

test('the same registered photo may legitimately belong to different route segments', () => {
  const f = registry(); f[0].properties.evidence_photos = [photo('shared-photo')];
  f[1].properties.evidence_photos = [photo('shared-photo')];
  assert.deepEqual(build(route(), f).steps.map(step => step.photos[0].photoId), ['shared-photo', 'shared-photo']);
});

test('only explicit canonical http(s) API configuration can prefix media paths', () => {
  for (const apiBaseUrl of ['', undefined, null, '/api', '//api.example.test', 'file:///tmp',
    'javascript:alert(1)', 'data:text/plain,abc', 'ftp://api.example.test',
    'https://user:secret@api.example.test', 'https://api.example.test?x=1',
    'https://api.example.test#x', 'https://api.example.test?', 'https://api.example.test#',
    ' https://api.example.test', 'https://api.example.test/../app',
    'https://api.example.test/%2e%2e/app', 'https://api.example.test/app\\other',
    'https://api.example.test/app//other', 'https://API.example.test',
    'https://api.example.test:443', 'https://api.example.test/app\n']) {
    const result = build(route(), registry(), 0, { apiBaseUrl });
    assert.equal(result.available, false, String(apiBaseUrl)); assert.deepEqual(result.steps, []);
  }
  for (const apiBaseUrl of ['http://localhost:8000', 'https://api.example.test/', base, `${base}/`]) {
    const result = build(route(), registry(), 0, { apiBaseUrl });
    assert.equal(result.available, true, apiBaseUrl);
    assert.equal(result.steps[0].photos[0].url,
      `${apiBaseUrl.replace(/\/$/, '')}/media/evidence/display/synthetic-photo-0.webp`);
  }
});

test('the pure manifest does not mutate frozen registration or invoke effects', () => {
  const r = route(), f = registry();
  r.segments.forEach(Object.freeze); Object.freeze(r.segments); Object.freeze(r.segment_codes); Object.freeze(r);
  f.forEach(feature => {
    feature.properties.evidence_photos.forEach(item => { Object.freeze(item.risk_tags); Object.freeze(item); });
    Object.freeze(feature.properties.evidence_photos); Object.freeze(feature.properties); Object.freeze(feature);
  }); Object.freeze(f);
  const before = JSON.stringify([r, f]), originals = new Map();
  for (const key of ['fetch', 'setTimeout', 'setInterval']) {
    originals.set(key, globalThis[key]); globalThis[key] = () => { throw Error('unexpected side effect'); };
  }
  try {
    assert.equal(build(r, f).available, true); assert.equal(JSON.stringify([r, f]), before);
  } finally {
    for (const [key, value] of originals) globalThis[key] = value;
  }
});
