import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, ref } from 'vue';
import { useFamilyMonitor } from '../src/composables/useFamilyMonitor.js';

globalThis.window ??= { setInterval: () => 1, clearInterval: () => {} };

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('family monitor clears old snapshots and discards responses after account switch', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = (url) => {
    const pending = deferred();
    requests.push({ url, ...pending });
    return pending.promise;
  };
  const currentUser = ref({ id: 1, role: 'family' });
  const activeMode = ref('family');
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, apiBaseUrl: 'http://api.test' }));
    await nextTick();
    assert.equal(requests.length, 1);

    currentUser.value = { id: 2, role: 'family' };
    await nextTick();
    assert.equal(requests.length, 2);
    assert.equal(workflow.elder.value, null);

    requests[0].resolve({ ok: true, json: async () => ({ elder: { nickname: '上一位老人' } }) });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(workflow.elder.value, null);

    requests[1].resolve({ ok: true, json: async () => ({ elder: { nickname: '当前关联老人' } }) });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(workflow.elder.value.nickname, '当前关联老人');
  } finally {
    scope.stop();
    globalThis.fetch = previousFetch;
  }
});

test('leaving the family dashboard resets the cached monitor snapshot', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ elder: { nickname: '已关联老人' } }) });
  const currentUser = ref({ id: 9, role: 'family' });
  const activeMode = ref('family');
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, apiBaseUrl: 'http://api.test' }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(workflow.elder.value.nickname, '已关联老人');
    activeMode.value = 'family-binding';
    await nextTick();
    assert.equal(workflow.elder.value, null);
    assert.deepEqual(workflow.monitor.value, { navigation: { status: 'IDLE' } });
  } finally {
    scope.stop();
    globalThis.fetch = previousFetch;
  }
});
