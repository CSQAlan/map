import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationReceipt } from '../src/composables/useNavigationReceipt.js';

const route = () => ({ segment_codes: ['a', 'b', 'c'] });
function setup() {
  const model = createNavigationReceipt(), selected = route(), session = model.begin(selected);
  const confirm = index => model.confirm({ session, route: selected, index });
  return { model, selected, session, confirm };
}

test('forward and last-segment undo remove only the latest newly added Set member', () => {
  const { model, selected, session, confirm } = setup();
  confirm(0);
  const first = model.undoCandidate.value;
  assert.equal(first.route, selected); assert.equal(first.session, session);
  assert.equal(first.index, 0); assert.equal(first.nextIndex, 1);
  assert.equal(model.undo(first), true);
  assert.equal(model.confirmedCount.value, 0);
  assert.equal(model.undo(first), false);
  confirm(0); confirm(1); confirm(2);
  const last = model.undoCandidate.value;
  assert.equal(last.index, 2); assert.equal(last.nextIndex, 2);
  assert.equal(model.undo(last), true);
  assert.equal(model.confirmedCount.value, 2);
  model.finish({ session, route: selected, outcome: 'unconfirmed' });
  assert.deepEqual(model.receipt.value, { outcome: 'unconfirmed', confirmed: 2, total: 3 });
});

test('repeated confirmation offers no undo and preserves the earlier valid mark', () => {
  const { model, confirm, selected, session } = setup();
  confirm(0); const old = model.undoCandidate.value;
  model.discardUndo(); confirm(0);
  assert.equal(model.undoCandidate.value, null);
  assert.equal(model.undo(old), false);
  assert.equal(model.confirmedCount.value, 1);
  model.finish({ session, route: selected, outcome: 'arrived' });
  assert.equal(model.receipt.value.confirmed, 1);
});

test('tokens are unique; old, forged, discarded, finished and new-session tokens cannot undo', () => {
  const { model, confirm, selected, session } = setup();
  confirm(0); const old = model.undoCandidate.value;
  confirm(1); const current = model.undoCandidate.value;
  for (const token of [null, old, { ...current }, { ...current, index: 0 }]) assert.equal(model.undo(token), false);
  assert.equal(model.undoCandidate.value, current);
  model.discardUndo(); assert.equal(model.undo(current), false);
  confirm(2); const last = model.undoCandidate.value;
  model.finish({ session, route: selected, outcome: 'arrived' });
  assert.equal(model.undo(last), false);
  model.begin(selected); confirm(0); // old generation is rejected
  assert.equal(model.undoCandidate.value, null);
  const next = model.sessionId.value;
  model.confirm({ session: next, route: selected, index: 0 });
  assert.equal(model.undo(last), false);
  assert.equal(model.confirmedCount.value, 1);
  const latest = model.undoCandidate.value;
  model.reset(); assert.equal(model.undo(latest), false);
  assert.equal(model.confirmedCount.value, 0);
});
