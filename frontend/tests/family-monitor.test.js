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

test('403 stops polling, removes cached authorization and blocks a late decoded position', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousStorage = globalThis.localStorage;
  const requests = [];
  let polls = 0;
  let clears = 0;
  let cached;
  let denied = 0;
  globalThis.window = { setInterval: () => ++polls, clearInterval: () => ++clears };
  globalThis.localStorage = { getItem: () => null, setItem: (_key, value) => { cached = JSON.parse(value); } };
  globalThis.fetch = () => { const pending = deferred(); requests.push(pending); return pending.promise; };
  const currentUser = ref({ id: 1, role: 'family', boundElder: { id: 2 }, bindingStatus: 'ACTIVE' });
  const activeMode = ref('family');
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, apiBaseUrl: 'http://api.test', onDenied: () => ++denied }));
    const oldBody = deferred();
    requests[0].resolve({ ok: true, json: () => oldBody.promise });
    await Promise.resolve();
    workflow.monitor.value = { elder: { id: 2 }, navigation: { latitude: 29, longitude: 106 }, alerts: [{ id: 1 }] };
    workflow.elder.value = { id: 2 };
    const newer = workflow.refresh();
    requests[1].resolve({ ok: false, status: 403 });
    await newer;
    assert.equal(denied, 1);
    assert.ok(clears > 0);
    assert.equal(workflow.elder.value, null);
    assert.deepEqual(workflow.monitor.value, { navigation: { status: 'IDLE' } });
    assert.equal(currentUser.value.bindingStatus, null);
    assert.equal(cached.boundElder, null);
    assert.match(workflow.unavailable.value, /不可|拒绝/);
    oldBody.resolve({ elder: { id: 2 }, navigation: { latitude: 88 } });
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(workflow.monitor.value, { navigation: { status: 'IDLE' } });
    const previousPolls = polls;
    workflow.start(); await workflow.refresh();
    assert.equal(polls, previousPolls);
    assert.equal(requests.length, 2);
    activeMode.value = 'family-binding'; await nextTick();
    activeMode.value = 'family'; await nextTick();
    assert.equal(requests.length, 2);
    assert.ok(workflow.unavailable.value);
  } finally {
    scope.stop(); globalThis.fetch = previousFetch; globalThis.window = previousWindow; globalThis.localStorage = previousStorage;
  }
});

test('a late denied response from an old account cannot disable the new account', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = () => { const pending = deferred(); requests.push(pending); return pending.promise; };
  const currentUser = ref({ id: 1, role: 'family' });
  const activeMode = ref('family');
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, apiBaseUrl: 'http://api.test' }));
    currentUser.value = { id: 2, role: 'family' }; await nextTick();
    requests[1].resolve({ ok: true, json: async () => ({ elder: { id: 3 }, navigation: { status: 'NAVIGATING' } }) });
    await Promise.resolve(); await Promise.resolve();
    requests[0].resolve({ status: 403, ok: false });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(workflow.elder.value.id, 3);
    assert.equal(workflow.unavailable.value, '');
  } finally { scope.stop(); globalThis.fetch = previousFetch; }
});

test('older same-session 403 revokes sharing even when a newer poll fails', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = () => { const pending = deferred(); requests.push(pending); return pending.promise; };
  const currentUser = ref({ id: 1, role: 'family', bindingStatus: 'ACTIVE', boundElder: { id: 2 } });
  const activeMode = ref('family');
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, apiBaseUrl: 'http://api.test' }));
    workflow.monitor.value = { navigation: { latitude: 29 }, elder: { id: 2 } };
    const newer = workflow.refresh();
    requests[0].resolve({ status: 403, ok: false });
    await Promise.resolve(); await Promise.resolve();
    requests[1].resolve({ status: 500, ok: false });
    await newer;
    assert.equal(currentUser.value.bindingStatus, null);
    assert.equal(workflow.elder.value, null);
    assert.deepEqual(workflow.monitor.value, { navigation: { status: 'IDLE' } });
    assert.ok(workflow.unavailable.value);
    workflow.start(); await workflow.refresh();
    assert.equal(requests.length, 2);
  } finally { scope.stop(); globalThis.fetch = previousFetch; }
});

test('cold offline monitoring ignores cached binding and accepts only current-session server evidence', async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = () => { const pending = deferred(); requests.push(pending); return pending.promise; };
  const currentUser = ref({ id: 1, role: 'family', boundElder: { nickname: '缓存旧老人' }, bindingStatus: 'ACTIVE' });
  const activeMode = ref('family');
  const sessionKey = ref(1);
  const scope = effectScope();
  try {
    const workflow = scope.run(() => useFamilyMonitor({ currentUser, activeMode, sessionKey, apiBaseUrl: 'http://api.test' }));
    assert.equal(workflow.elder.value, null);
    requests[0].resolve({ ok: false, status: 503 });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(workflow.elder.value, null);
    assert.equal(workflow.monitor.value.elder, undefined);
    const oldBody = deferred();
    const old = workflow.refresh();
    requests[1].resolve({ ok: true, json: () => oldBody.promise });
    await Promise.resolve();
    sessionKey.value += 1;
    await nextTick();
    assert.equal(workflow.elder.value, null);
    requests[2].resolve({ ok: true, json: async () => ({ elder: { nickname: '本次服务端老人' }, navigation: { status: 'IDLE' } }) });
    await Promise.resolve(); await Promise.resolve();
    oldBody.resolve({ elder: { nickname: '上一会话老人' }, navigation: { latitude: 88 } });
    await old;
    assert.equal(workflow.elder.value.nickname, '本次服务端老人');
    assert.equal(workflow.monitor.value.navigation.latitude, undefined);
    const denied = workflow.refresh();
    requests[3].resolve({ ok: false, status: 403 }); await denied;
    assert.equal(workflow.elder.value, null);
    sessionKey.value += 1; await nextTick();
    requests[4].resolve({ ok: true, json: async () => ({ elder: { nickname: '重新确认老人' } }) });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(workflow.elder.value.nickname, '重新确认老人');
    assert.equal(workflow.unavailable.value, '');
  } finally { scope.stop(); globalThis.fetch = previousFetch; }
});
