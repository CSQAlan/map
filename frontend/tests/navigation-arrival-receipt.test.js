import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationReceipt } from '../src/composables/useNavigationReceipt.js';

const route = () => ({ segment_codes: ['a', 'b', 'c'], private_address: 'never copy', coordinates: [106, 29] });
for (const outcome of ['arrived', 'unconfirmed']) test(`explicit ${outcome} is independent of manual count and consumed once`, () => {
  const model = createNavigationReceipt(), selected = route(), session = model.begin(selected);
  model.confirm({ session, route: selected, index: 1 });
  model.confirm({ session, route: selected, index: 1 });
  assert.equal(model.confirmedCount.value, 1);
  assert.equal(model.finish({ session, route: selected, outcome }), true);
  assert.deepEqual(model.receipt.value, { outcome, confirmed: 1, total: 3 });
  assert.equal(Object.isFrozen(model.receipt.value), true);
  assert.equal(model.finish({ session, route: selected, outcome: 'arrived' }), false);
  assert.equal(model.confirm({ session, route: selected, index: 0 }), false);
});
test('GPS/index changes and pure exit/cancel cannot create a receipt; zero-count arrival is valid', () => {
  const model = createNavigationReceipt(), selected = route(), session = model.begin(selected);
  assert.equal(model.receipt.value, null);
  for (const outcome of [undefined, 'cancel', 'COMPLETED']) {
    assert.equal(model.finish({ session, route: selected, outcome }), false);
  }
  assert.equal(model.finish({ session, route: selected, outcome: 'arrived' }), true);
  assert.deepEqual(model.receipt.value, { outcome: 'arrived', confirmed: 0, total: 3 });
});
test('confirming every segment does not infer arrival', () => {
  const model = createNavigationReceipt(), selected = route(), session = model.begin(selected);
  for (const index of [2, 0, 1, 0, 2]) model.confirm({ session, route: selected, index });
  assert.equal(model.confirmedCount.value, 3);
  model.finish({ session, route: selected, outcome: 'unconfirmed' });
  assert.equal(model.receipt.value.outcome, 'unconfirmed');
});
test('reset/new session rejects stale callbacks, different routes and invalid indices', () => {
  const model = createNavigationReceipt(), old = route(), session = model.begin(old);
  model.reset();
  assert.equal(model.finish({ session, route: old, outcome: 'arrived' }), false);
  const selected = route(), next = model.begin(selected);
  for (const index of [-1, 3, 1.2, NaN]) assert.equal(model.confirm({ session: next, route: selected, index }), false);
  assert.equal(model.confirm({ session, route: old, index: 0 }), false);
  assert.equal(model.finish({ session: next, route: old, outcome: 'arrived' }), false);
  assert.equal(model.receipt.value, null);
  model.finish({ session: next, route: selected, outcome: 'arrived' });
  model.begin(selected);
  assert.equal(model.receipt.value, null);
  assert.equal(model.confirmedCount.value, 0);
});
