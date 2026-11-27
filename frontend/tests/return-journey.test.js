import test from 'node:test';
import assert from 'node:assert/strict';
import { returnJourneyDraft } from '../src/utils/returnJourney.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';

const places = ['A', 'B'].map(value => ({ value, label: value }));
const journey = () => ({ allowed: true, scope: 'guest:1', route: { segment_codes: ['OUTBOUND'] },
  start: 'A', end: 'B', mobility: 'CANE', strategy: 'SAFEST', detour: false, currentOrigin: false });

test('only proposes the two reversed names; does not copy/reverse outbound geometry', () => {
  const snapshot = journey();
  assert.deepEqual(returnJourneyDraft(snapshot, { ...snapshot }, places, places), { start: 'B', end: 'A' });
  assert.deepEqual(snapshot.route.segment_codes, ['OUTBOUND']);
});

for (const value of ['', ' ', null, undefined, 12, ' A ', 'unregistered']) {
  test(`rejects invalid/missing named endpoint ${JSON.stringify(value)}`, () => {
    for (const field of ['start', 'end']) {
      const snapshot = { ...journey(), [field]: value };
      assert.equal(returnJourneyDraft(snapshot, snapshot, places, places), null);
    }
  });
}

test('rejects identical names, no start snapshot and changed route identity', () => {
  const snapshot = journey();
  const same = { ...snapshot, end: 'A' };
  assert.equal(returnJourneyDraft(same, same, places, places), null);
  assert.equal(returnJourneyDraft(null, snapshot, places, places), null);
  assert.equal(returnJourneyDraft(snapshot, { ...snapshot, route: { ...snapshot.route } }, places, places), null);
});

for (const [field, value] of [['allowed', false], ['detour', true], ['currentOrigin', true],
  ['scope', 'elder:other'], ['start', 'B'], ['end', 'A'], ['mobility', 'WHEELCHAIR'], ['strategy', 'BALANCED']]) {
  test(`rejects changed ${field} context`, () => {
    const snapshot = journey();
    assert.equal(returnJourneyDraft(snapshot, { ...snapshot, [field]: value }, places, places), null);
  });
}

test('rejects a current-origin or detour snapshot even when current flags were cleared', () => {
  const context = journey();
  for (const field of ['detour', 'currentOrigin']) {
    assert.equal(returnJourneyDraft({ ...context, [field]: true }, context, places, places), null);
  }
});

test('both original and reversed names must still be registered in equivalent options', () => {
  const snapshot = journey();
  for (const [starts, ends] of [[places.slice(0, 1), places], [places, places.slice(1)],
    [places.slice(1), places], [places, places.slice(0, 1)], [null, places], [places, []]]) {
    assert.equal(returnJourneyDraft(snapshot, snapshot, starts, ends), null);
  }
  assert.deepEqual(returnJourneyDraft(snapshot, snapshot, [...places], [...places]), { start: 'B', end: 'A' });
});

test('prefill is inert; explicit named query uses a fresh return result and rejects stale responses', async () => {
  const calls = [], pending = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    fetcher: url => { calls.push(new URL(url, 'http://localhost')); return new Promise(resolve => pending.push(resolve)); } });
  const respond = code => ({ ok: true, json: async () => ({ routes: [{ segment_codes: [code] }] }) });
  planner.startName.value = 'A'; planner.endName.value = 'B';
  const outbound = planner.planRoutes(); pending.shift()(respond('OUTBOUND')); await outbound;
  const snapshot = { ...journey(), route: planner.selectedRoute.value };
  const draft = returnJourneyDraft(snapshot, snapshot, places, places);
  // A late request from the old context must not restore outbound results.
  const old = planner.planRoutes();
  planner.startName.value = draft.start; planner.endName.value = draft.end;
  assert.equal(calls.length, 2);
  assert.equal(planner.selectedRoute.value, null);
  pending.shift()(respond('STALE')); assert.equal(await old, false);
  assert.equal(planner.startName.value, 'B'); assert.equal(planner.endName.value, 'A');
  const returning = planner.planRoutes();
  assert.equal(calls[2].searchParams.get('start_name'), 'B');
  assert.equal(calls[2].searchParams.get('end_name'), 'A');
  assert.equal(calls[2].searchParams.has('start_longitude'), false);
  pending.shift()(respond('NEW_RETURN')); assert.equal(await returning, true);
  assert.deepEqual(planner.selectedRoute.value.segment_codes, ['NEW_RETURN']);
  assert.match(planner.actionStatus.value, /再开始导航/);
});
