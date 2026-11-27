import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';
import { nextTick, reactive } from 'vue';

// Synthetic registered roads only; never hardware GPS or live HTTP.
const places = ['合成起点', '合成终点'].map(value => ({ value, label: value }));
const road = (code, name = `合成${code}`) => ({ segment_code: code, name, length_m: 50,
  geometry_coordinates: [[10, 10], [10.001, 10]], step_count: 0, width_m: 3 });
const route = (codes = ['blocked', 'next', 'later']) => ({ distance_m: codes.length * 50,
  segment_codes: codes, segments: codes.map(code => road(code)) });
const ok = payload => ({ ok: true, json: async () => payload });
const fix = (timestamp = Date.now()) => ({ longitude: 10.0005, latitude: 10, accuracy: 8, timestamp });
const candidate = { segment_code: 'alternative', name: '合成替代路', allowed: true,
  distance_m: 2, snapped_coordinates: [10.0005, 10] };
const lookupPayload = () => ({ excluded_segment_code: 'blocked', candidates: [candidate] });
const finalPayload = () => {
  const proposed = route(['alternative']); proposed.segments[0].geometry_coordinates[0] = [...candidate.snapped_coordinates];
  return { end_name: places[1].value, mobility_type: 'WHEELCHAIR', strategy: 'BALANCED',
    excluded_segment_code: 'blocked', start_context: candidate, routes: [proposed] };
};
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function setup({ source = route(), echo = {}, lookup = async () => ok(lookupPayload()), final = async () => ok(finalPayload()),
  preview = async () => ok({ ...finalPayload(), start_name: places[0].value }) } = {}) {
  const calls = [], paths = [];
  const live = reactive({ allowed: true, active: true, index: 0 });
  let scope = 'guest-local';
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    router: { push: async path => { paths.push(path); }, replace: async path => { paths.push(path); } },
    fetcher: async url => {
      calls.push(url);
      if (url.includes('/start-options?')) return lookup(url);
      if (url.includes('start_longitude=')) return final(url);
      if (url.includes('exclude_segment_code=')) return preview(url);
      return ok({ start_name: places[0].value, end_name: places[1].value,
        mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', routes: [source], ...echo });
    } });
  planner.configure({ getJourneyScope: () => scope, getNavigationContext: () => live });
  planner.startName.value = places[0].value; planner.endName.value = places[1].value;
  return { planner, calls, paths, live, changeScope() { scope = 'changed'; } };
}
async function start(app) { await app.planner.planRoutes(); await app.planner.startNavigation(); }
function lock(app) { return app.planner.lockNavigationObstruction(app.planner.obstructionState.value.options[0]); }

test('exact started named route locks a paused GPS-only session without fetching, candidate or guidance', async () => {
  const app = setup(); await start(app);
  const { planner, calls, paths } = app;
  const original = planner.selectedRoute.value;
  const options = planner.obstructionState.value.options;
  assert.deepEqual(options.map(o => [o.index, o.segment_code, o.name, o.kind]),
    [[0, 'blocked', '合成blocked', 'current'], [1, 'next', '合成next', 'next']]);
  assert.equal(options[0].route, original);
  const before = calls.length;
  assert.equal(lock(app), true);
  assert.equal(calls.length, before); assert.deepEqual(paths, ['/elder/navigation']);
  assert.equal(planner.detour.phase.value, 'paused');
  assert.equal(planner.detour.session.value.code, 'blocked');
  assert.equal(planner.detour.session.value.confirmedSegment, null);
  assert.equal(planner.detour.route.value, null); assert.equal(planner.detour.pending.value, null);
  assert.deepEqual(planner.detour.candidates.value, []);
  assert.equal(planner.selectedRoute.value, null); assert.deepEqual(planner.routes.value, []);
  assert.equal(await planner.startNavigation(), false);
  assert.equal(planner.detour.confirmRoute(), false);
  assert.equal(await planner.planRoutes(), false); assert.equal(calls.length, before);
});

test('manual index determines current/next, never the map inspection or preview', async () => {
  const app = setup(); await start(app);
  app.planner.selectSegment('later');
  assert.equal(app.planner.obstructionState.value.options[0].segment_code, 'blocked');
  const old = app.planner.obstructionState.value.options[1];
  app.live.index = 1;
  assert.equal(app.planner.lockNavigationObstruction(old), false, 'old current/next label lost authority');
  const current = app.planner.obstructionState.value.options[0];
  assert.equal(current.segment_code, 'next'); assert.equal(current.kind, 'current');
  assert.equal(app.planner.lockNavigationObstruction(current), true);
  assert.equal(app.planner.detour.session.value.code, 'next');
});

for (const kind of ['no-start', 'role', 'scope', 'page', 'changed-index', 'clone', 'wrong-name', 'wrong-code',
  'changed-route', 'mutated-route', 'new-trip', 'coordinate-start', 'preview']) {
  test(`${kind}: stale or unauthorized choice is inert`, async () => {
    const app = setup(); await app.planner.planRoutes();
    if (kind !== 'no-start') await app.planner.startNavigation();
    const { planner } = app;
    const choice = planner.obstructionState.value.options[0] || { route: planner.selectedRoute.value, index: 0,
      segment_code: 'blocked', name: '合成blocked', kind: 'current' };
    if (kind === 'role') app.live.allowed = false;
    if (kind === 'scope') app.changeScope();
    if (kind === 'page') app.live.active = false;
    if (kind === 'changed-index') app.live.index = 1;
    if (kind === 'clone') choice.route = structuredClone({ ...planner.selectedRoute.value,
      segment_codes: [...planner.selectedRoute.value.segment_codes], segments: [] });
    if (kind === 'wrong-name') choice.name = '别的名称';
    if (kind === 'wrong-code') choice.segment_code = 'later';
    if (kind === 'changed-route') planner.routes.value = [route()];
    if (kind === 'mutated-route') planner.selectedRoute.value.segments[0].name = '改名';
    if (kind === 'new-trip') await planner.startNavigation();
    if (kind === 'coordinate-start') planner.startContext.value = { segment_code: 'blocked' };
    if (kind === 'preview') await planner.previewExclusion('blocked');
    const displayed = planner.selectedRoute.value, before = app.calls.length;
    // A preview alone cannot grant a different road authority; an unchanged
    // actual current choice can still be confirmed while preview exists.
    const attempted = kind === 'preview' ? { ...choice, segment_code: 'alternative', name: '合成替代路' } : choice;
    assert.equal(planner.lockNavigationObstruction(attempted), false);
    assert.equal(planner.detour.session.value, null); assert.equal(planner.selectedRoute.value, displayed);
    assert.equal(app.calls.length, before);
  });
}

for (const [kind, source, echo] of [
  ['missing names', { ...route(), segments: route().segments.map(r => ({ ...r, name: '' })) }, {}],
  ['duplicate IDs', route(['blocked', 'blocked']), {}],
  ['duplicate names', { ...route(), segments: route().segments.map(r => ({ ...r, name: '重名' })) }, {}],
  ['unsupported geometry', { ...route(), segments: route().segments.map(r => ({ ...r, geometry_coordinates: [] })) }, {}],
  ['unproven echo', route(), { end_name: 'other' }],
]) test(`${kind}: no eligible registered leg and clear reason`, async () => {
  const app = setup({ source, echo }); await start(app);
  assert.deepEqual(app.planner.obstructionState.value.options, []);
  assert.ok(app.planner.obstructionState.value.reason);
  assert.equal(app.planner.lockNavigationObstruction({ segment_code: 'blocked', name: '合成blocked' }), false);
});

test('initial 422 ambiguity stays paused; retry needs a unique road then explicit route adoption', async () => {
  let attempts = 0;
  const app = setup({ lookup: async () => ++attempts === 1
    ? { ok: false, status: 422, json: async () => ({ detail: { code: 'AMBIGUOUS_EXCLUDED_LOCATION', message: '合成定位有歧义，请重试' } }) }
    : ok(lookupPayload()) });
  await start(app); assert.equal(lock(app), true);
  assert.equal(await app.planner.detour.replan(async () => fix()), false);
  assert.match(app.planner.detour.message.value, /歧义/);
  assert.equal(app.planner.selectedRoute.value, null);
  assert.equal(await app.planner.detour.replan(async () => fix(Date.now() + 1)), true);
  assert.equal(app.planner.detour.phase.value, 'confirm-start');
  assert.equal(app.planner.selectedRoute.value, null);
  assert.equal(app.calls.length, 3, 'named plan plus two lookups only');
  assert.equal(await app.planner.detour.confirmStart('alternative'), true);
  assert.equal(app.planner.selectedRoute.value, null);
  const params = new URL(app.calls.at(-1), 'http://localhost').searchParams;
  assert.equal(params.has('start_name'), false); assert.equal(params.get('exclude_segment_code'), 'blocked');
  assert.equal(app.planner.detour.confirmRoute(), true);
  assert.equal(app.planner.selectedRoute.value.segment_codes[0], 'alternative');
  assert.deepEqual(app.paths, ['/elder/navigation']);
  assert.equal(app.planner.lockNavigationObstruction({}), false, 'no nested detour');
});

test('scope/role/page round trips never revive an old choice; direct controller entry revalidates too', async () => {
  for (const change of ['scope', 'role', 'page']) {
    const app = setup(); await start(app);
    const choice = app.planner.obstructionState.value.options[0];
    if (change === 'scope') {
      app.planner.configure({ getJourneyScope: () => 'other' });
      app.planner.configure({ getJourneyScope: () => 'guest-local' });
    } else {
      const field = change === 'role' ? 'allowed' : 'active';
      app.live[field] = false; app.live[field] = true;
    }
    assert.equal(app.planner.detour.lockPaused(choice), false);
    assert.equal(app.planner.lockNavigationObstruction(choice), false);
    assert.equal(app.planner.selectedRoute.value.segment_codes[0], 'blocked');
    assert.equal(app.calls.length, 1);
  }
});

test('locking discards existing preview/comparison, and ignores an outstanding old preview response', async () => {
  const app = setup(); await start(app);
  await app.planner.previewExclusion('blocked'); await app.planner.compareWalkingRoute();
  assert.ok(app.planner.exclusionPreview.value); assert.ok(app.planner.walkingReference.value);
  assert.equal(lock(app), true);
  assert.equal(app.planner.exclusionPreview.value, null); assert.equal(app.planner.walkingReference.value, null);
  assert.equal(app.planner.useExclusionRoute(), false);
  assert.equal(app.planner.detour.phase.value, 'paused'); assert.equal(app.planner.detour.pending.value, null);

  const wait = deferred();
  const b = setup({ preview: () => wait.promise }); await start(b);
  const task = b.planner.previewExclusion('blocked');
  assert.equal(lock(b), true);
  wait.resolve(ok({ ...finalPayload(), start_name: places[0].value }));
  assert.equal(await task, false);
  assert.equal(b.planner.exclusionPreview.value, null);
  assert.equal(b.planner.selectedRoute.value, null);
  assert.equal(b.planner.detour.phase.value, 'paused');
});

test('GPS-only lock rejects mismatching confirmed road name and duplicate candidate names', async () => {
  const app = setup({ final: async () => ok({ ...finalPayload(), start_context: { ...candidate, name: '不同道路' } }) });
  await start(app); lock(app);
  await app.planner.detour.replan(async () => fix());
  assert.equal(await app.planner.detour.confirmStart('alternative'), false);
  assert.equal(app.planner.detour.pending.value, null); assert.equal(app.planner.selectedRoute.value, null);
  const b = setup({ lookup: async () => ok({ ...lookupPayload(), candidates: [candidate, { ...candidate, segment_code: 'other' }] }) });
  await start(b); lock(b);
  assert.equal(await b.planner.detour.replan(async () => fix()), false);
  assert.equal(b.planner.detour.phase.value, 'paused');
});

for (const stage of ['fix', 'lookup', 'body', 'final']) for (const change of ['cancel', 'context', 'new-journey', 'page', 'role', 'scope']) {
  test(`late ${stage} after ${change} cannot query/adopt or restore guidance`, async () => {
    const wait = deferred();
    const app = setup({ lookup: stage === 'lookup' ? () => wait.promise : stage === 'body'
      ? async () => ({ ok: true, json: () => wait.promise }) : undefined,
      final: stage === 'final' ? () => wait.promise : undefined });
    await start(app); assert.equal(lock(app), true);
    let task = app.planner.detour.replan(stage === 'fix' ? () => wait.promise : async () => fix());
    if (stage === 'final') { await task; task = app.planner.detour.confirmStart('alternative'); }
    await new Promise(resolve => setImmediate(resolve));
    if (change === 'context') app.planner.endName.value = 'changed';
    else if (change === 'page') app.live.active = false;
    else if (change === 'role') app.live.allowed = false;
    else if (change === 'scope') app.planner.configure({ getJourneyScope: () => 'changed-scope' });
    else app.planner.cancelDetour();
    if (change === 'new-journey') { await start(app); assert.equal(lock(app), true); }
    const count = app.calls.length;
    wait.resolve(stage === 'fix' ? fix() : stage === 'body' ? lookupPayload() : ok(stage === 'final' ? finalPayload() : lookupPayload()));
    assert.equal(await task, false); await nextTick();
    assert.equal(app.calls.length, count); assert.equal(app.planner.selectedRoute.value, null);
    assert.equal(app.planner.detour.pending.value, null);
    assert.equal(app.planner.detour.phase.value, change === 'cancel' ? 'idle' : 'paused');
  });
}
