import { readonly, ref, shallowRef } from 'vue';

// Local evidence of explicit choices only. No positions, identity, endpoints,
// timestamps, storage or publishing. A generation rejects old async handlers.
export function createNavigationReceipt() {
  const receipt = shallowRef(null), confirmedCount = ref(0), sessionId = ref(0), undoCandidate = shallowRef(null);
  let generation = 0, active = null;
  function discardUndo() { undoCandidate.value = null; }
  function reset() {
    discardUndo();
    generation++; active = null; sessionId.value = 0;
    receipt.value = null; confirmedCount.value = 0;
  }
  function begin(route) {
    reset();
    const codes = route?.segment_codes;
    if (!Array.isArray(codes) || !codes.length || codes.some(code => typeof code !== 'string' || !code.trim())
        || new Set(codes).size !== codes.length) return 0;
    active = { route, total: codes.length, confirmed: new Set() };
    sessionId.value = generation;
    return generation;
  }
  function matches(event) {
    return active && event?.session === sessionId.value && event.route === active.route;
  }
  function confirm(event) {
    if (!matches(event) || !Number.isInteger(event.index) || event.index < 0 || event.index >= active.total) return false;
    discardUndo();
    const added = !active.confirmed.has(event.index);
    active.confirmed.add(event.index); confirmedCount.value = active.confirmed.size;
    // A fresh object is a one-use capability. Reconfirming an existing member
    // never grants permission to delete that earlier valid confirmation.
    if (added) undoCandidate.value = Object.freeze({ session: event.session, route: event.route,
      index: event.index, nextIndex: Math.min(event.index + 1, active.total - 1) });
    return true;
  }
  function undo(token) {
    if (!token || token !== undoCandidate.value || !matches(token) || !active.confirmed.has(token.index)) return false;
    discardUndo(); active.confirmed.delete(token.index); confirmedCount.value = active.confirmed.size;
    return true;
  }
  function finish(event) {
    if (!matches(event) || !['arrived', 'unconfirmed'].includes(event.outcome)) return false;
    discardUndo();
    receipt.value = Object.freeze({ outcome: event.outcome, confirmed: active.confirmed.size, total: active.total });
    active = null; sessionId.value = 0;
    return true;
  }
  return { receipt: readonly(receipt), confirmedCount: readonly(confirmedCount), sessionId: readonly(sessionId),
    undoCandidate: readonly(undoCandidate), reset, begin, confirm, undo, discardUndo, finish };
}
