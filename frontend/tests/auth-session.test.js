import test from 'node:test';
import assert from 'node:assert/strict';
import { effectScope, nextTick, ref, watch } from 'vue';
import { useFamilyMonitor } from '../src/composables/useFamilyMonitor.js';

globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    has: (key) => values.has(key),
  };
}

globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();
const { useAuthSession } = await import('../src/composables/useAuthSession.js');

test('elder login preserves saved profile fields, account compatibility and login role', async () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('elderMapUser', JSON.stringify({ account: '100001', mobilityType: 'CANE', realName: '李阿姨', password: 'legacy-secret' }));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'http://localhost:8000/api/auth/elder');
    assert.deepEqual(JSON.parse(options.body), { nickname: '李阿姨', password: 'pw' });
    return {
      ok: true,
      json: async () => ({ id: 1, account: '100001', nickname: '李阿姨', family_binding_code: '123456' }),
    };
  };
  try {
    const user = await session.loginElder({ nickname: '李阿姨', password: 'pw' });
    assert.equal(user.role, 'elder');
    assert.equal(user.mobilityType, 'CANE');
    assert.equal(user.realName, '李阿姨');
    assert.equal(user.password, undefined);
    const storedUser = JSON.parse(localStorage.getItem('elderMapUser'));
    assert.equal(storedUser.account, '100001');
    assert.equal(Object.hasOwn(storedUser, 'password'), false);
    assert.equal(localStorage.getItem('mapLastLoginRole'), 'elder');
    assert.equal(localStorage.getItem('familyMapUser'), null);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('admin token lives only in sessionStorage and is cleared on admin logout', async () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ username: 'admin', role: 'admin', access_token: 'signed-token' }),
  });
  try {
    await session.loginAdmin({ username: 'admin', password: 'admin123' });
    assert.equal(sessionStorage.getItem('adminAccessToken'), 'signed-token');
    assert.equal(session.adminAccessToken.value, 'signed-token');
    assert.equal(session.adminUser.value.access_token, 'signed-token');
    assert.equal(localStorage.has('adminAccessToken'), false);
    assert.equal(localStorage.getItem('mapLastLoginRole'), null);
    session.logout('admin');
    assert.equal(sessionStorage.getItem('adminAccessToken'), null);
    assert.equal(session.adminAccessToken.value, '');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('restoreSession restores legacy role-selected user data and session-only admin guard token', () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('mapLastLoginRole', 'family');
  localStorage.setItem('familyMapUser', JSON.stringify({ id: 8, role: 'family', phone: '13800000000', password: 'legacy-secret' }));
  localStorage.setItem('elderMapUser', JSON.stringify({ id: 3, role: 'elder', nickname: '李阿姨', password: 'elder-legacy-secret' }));
  sessionStorage.setItem('adminAccessToken', 'tab-token');
  const restored = session.restoreSession();
  assert.equal(restored.user.id, 8);
  assert.equal(restored.user.role, 'family');
  assert.equal(Object.hasOwn(JSON.parse(localStorage.getItem('familyMapUser')), 'password'), false);
  assert.equal(Object.hasOwn(JSON.parse(localStorage.getItem('elderMapUser')), 'password'), false);
  assert.equal(restored.adminToken, 'tab-token');
  assert.equal(session.adminAccessToken.value, 'tab-token');
});

test('clearing the in-memory user revokes a family route role without deleting its saved profile', () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('mapLastLoginRole', 'family');
  localStorage.setItem('familyMapUser', JSON.stringify({ id: 8, role: 'family', phone: '13800000000' }));
  session.restoreSession();
  assert.equal(session.getCurrentRole(), 'family');
  session.clearCurrentUser();
  assert.equal(session.getCurrentRole(), null);
  assert.equal(localStorage.getItem('familyMapUser') !== null, true);
});

test('legacy saved elder password is removed during session restore', () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('mapLastLoginRole', 'elder');
  localStorage.setItem('elderMapUser', JSON.stringify({ id: 3, role: 'elder', nickname: '李阿姨', password: 'legacy-secret' }));
  session.restoreSession();
  assert.equal(Object.hasOwn(session.currentUser.value, 'password'), false);
  assert.equal(Object.hasOwn(JSON.parse(localStorage.getItem('elderMapUser')), 'password'), false);
});

test('legacy saved admin credentials are removed during session restore', () => {
  const session = useAuthSession();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('adminMapCredentials', JSON.stringify({ username: 'admin', password: 'legacy-secret' }));
  session.restoreSession();
  assert.equal(localStorage.getItem('adminMapCredentials'), null);
});

test('family demo login and binding preserve explicit enabled responses without issuing tokens', async () => {
  const session = useAuthSession();
  localStorage.clear();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({ ok: true, json: async () => url.endsWith('/bind')
    ? { elder: { id: 1, nickname: '合成老人' } }
    : { id: 2, phone: '13800000000', role: 'family' } });
  try {
    const user = await session.loginFamily({ phone: '13800000000' });
    assert.equal(user.access_token, undefined);
    await session.bindFamily({ elderAccount: '100001', bindingCode: '123456' });
    assert.equal(session.currentUser.value.bindingStatus, 'ACTIVE');
    assert.equal(session.familySharingDenied.value, false);
  } finally { globalThis.fetch = previousFetch; }
});

test('binding 403 revokes cached state and prevents an older success restoring authorization', async () => {
  const session = useAuthSession();
  const previousFetch = globalThis.fetch;
  const requests = [];
  let resolveOld;
  const oldBody = new Promise(resolve => { resolveOld = resolve; });
  session.currentUser.value = { id: 2, role: 'family', bindingStatus: 'ACTIVE', boundElder: { id: 1 } };
  localStorage.setItem('familyMapUser', JSON.stringify(session.currentUser.value));
  globalThis.fetch = async () => {
    const index = requests.length;
    requests.push(index);
    return index === 0 ? { ok: true, json: () => oldBody } : { ok: false, status: 403 };
  };
  try {
    const old = session.bindFamily({ elderAccount: '100001', bindingCode: '123456' });
    const rejectedOld = assert.rejects(old, /已失效/);
    await assert.rejects(session.bindFamily({ elderAccount: '100001', bindingCode: '123456' }), /共享演示未开启/);
    assert.equal(session.familySharingDenied.value, true);
    assert.equal(session.currentUser.value.boundElder, null);
    assert.equal(JSON.parse(localStorage.getItem('familyMapUser')).bindingStatus, null);
    resolveOld({ elder: { id: 99 } });
    await rejectedOld;
    assert.equal(session.currentUser.value.boundElder, null);
  } finally { globalThis.fetch = previousFetch; }
});

test('family phone login 403 provides unavailable feedback and clears cached binding', async () => {
  const session = useAuthSession();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  localStorage.setItem('familyMapUser', JSON.stringify({ id: 2, role: 'family', boundElder: { id: 1 }, bindingStatus: 'ACTIVE' }));
  try {
    await assert.rejects(session.loginFamily({ phone: '13800000000' }), /手机号不是可信身份认证/);
    assert.equal(JSON.parse(localStorage.getItem('familyMapUser')).boundElder, null);
  } finally { globalThis.fetch = previousFetch; }
});

test('a pending bind cannot restore the family session after logout', async () => {
  const session = useAuthSession();
  const previousFetch = globalThis.fetch;
  let resolveBody;
  const body = new Promise(resolve => { resolveBody = resolve; });
  globalThis.fetch = async () => ({ ok: true, json: () => body });
  session.currentUser.value = { id: 2, role: 'family' };
  try {
    const pending = session.bindFamily({ elderAccount: '100001', bindingCode: '123456' });
    const rejected = assert.rejects(pending, /已失效/);
    session.logout();
    resolveBody({ elder: { id: 1 } });
    await rejected;
    assert.equal(session.currentUser.value, null);
    assert.equal(localStorage.getItem('familyMapUser'), null);
  } finally { globalThis.fetch = previousFetch; }
});

test('older same-session binding 403 revokes sharing despite a newer failed request', async () => {
  const session = useAuthSession();
  const previousFetch = globalThis.fetch;
  const requests = [];
  session.currentUser.value = { id: 2, role: 'family', boundElder: { id: 1 }, bindingStatus: 'ACTIVE' };
  localStorage.setItem('familyMapUser', JSON.stringify(session.currentUser.value));
  globalThis.fetch = () => new Promise(resolve => requests.push(resolve));
  try {
    const older = session.bindFamily({ elderAccount: '100001', bindingCode: '123456' });
    const olderRejection = assert.rejects(older, /共享演示未开启/);
    const newer = session.bindFamily({ elderAccount: '100002', bindingCode: '123456' });
    const newerRejection = assert.rejects(newer, /已失效/);
    requests[0]({ status: 403, ok: false });
    await olderRejection;
    requests[1]({ status: 500, ok: false, json: async () => ({}) });
    await newerRejection;
    assert.equal(session.familySharingDenied.value, true);
    assert.equal(session.currentUser.value.boundElder, null);
    assert.equal(JSON.parse(localStorage.getItem('familyMapUser')).bindingStatus, null);
  } finally { globalThis.fetch = previousFetch; }
});

test('cold family cache never restores binding or monitor evidence, even offline', async () => {
  const session = useAuthSession();
  localStorage.clear();
  const stale = { id: 2, role: 'family', phone: '13800000000', nickname: '合成家属', boundElder: { id: 1, nickname: '旧老人', account: '旧账号' }, bindingStatus: 'ACTIVE', binding: { status: 'ACTIVE', elder: { id: 1 } }, monitor: { navigation: { latitude: 29 } } };
  localStorage.setItem('mapLastLoginRole', 'family');
  localStorage.setItem('familyMapUser', JSON.stringify(stale));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    const restored = session.restoreSession();
    assert.equal(restored.user.id, 2);
    assert.equal(restored.user.nickname, '合成家属');
    assert.equal(restored.user.boundElder, null);
    assert.equal(restored.user.bindingStatus, null);
    assert.equal(restored.user.binding, undefined);
    assert.equal(restored.user.monitor, undefined);
    assert.equal(session.confirmedFamilyElder.value, null);
    assert.equal(JSON.stringify(restored.user).includes('旧老人'), false);
    await assert.rejects(session.loginFamily({ phone: stale.phone }), /offline/);
    assert.equal(session.confirmedFamilyElder.value, null);
    assert.equal(JSON.stringify(JSON.parse(localStorage.getItem('familyMapUser'))).includes('旧老人'), false);
  } finally { globalThis.fetch = previousFetch; }
});

test('server-confirmed login/bind is immediate but persistence and next session remain unconfirmed', async () => {
  const session = useAuthSession();
  localStorage.clear();
  const previousFetch = globalThis.fetch;
  const elder = { id: 1, nickname: '本次确认老人', account: '100001' };
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/bind') ? { elder: { ...elder, id: 3, nickname: '本次新绑定老人' } } : { id: 2, phone: '13800000000', role: 'family', binding: { status: 'ACTIVE', elder } } });
  try {
    await session.loginFamily({ phone: '13800000000' });
    assert.deepEqual({ ...session.confirmedFamilyElder.value }, elder);
    let cached = JSON.parse(localStorage.getItem('familyMapUser'));
    assert.equal(cached.boundElder, null);
    assert.equal(cached.bindingStatus, null);
    assert.equal(cached.binding, undefined);
    await session.bindFamily({ elderAccount: '100003', bindingCode: '123456' });
    assert.equal(session.confirmedFamilyElder.value.id, 3);
    assert.equal(session.currentUser.value.bindingStatus, 'ACTIVE');
    session.updateProfile({ nickname: '更新家属昵称' });
    cached = JSON.parse(localStorage.getItem('familyMapUser'));
    assert.equal(cached.boundElder, null);
    assert.equal(JSON.stringify(cached).includes('本次新绑定老人'), false);
    const key = session.familySessionKey.value;
    session.restoreSession();
    assert.ok(session.familySessionKey.value > key);
    assert.equal(session.confirmedFamilyElder.value, null);
    assert.equal(session.currentUser.value.bindingStatus, null);
    await session.loginFamily({ phone: '13800000000' });
    assert.equal(session.confirmedFamilyElder.value.id, 1);
    session.revokeFamilySharing();
    assert.equal(session.confirmedFamilyElder.value, null);
  } finally { globalThis.fetch = previousFetch; }
});

test('fresh successful bind after 403 clears monitor denial and preserves immediate confirmed UX', async () => {
  const session = useAuthSession();
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const scope = effectScope();
  const activeMode = ref('family-binding');
  let binds = 0;
  let polls = 0;
  const elder = { id: 3, nickname: '重试确认老人', account: '100003' };
  globalThis.window = { ...previousWindow, setInterval: () => 1, clearInterval: () => {} };
  globalThis.fetch = async url => {
    if (url.endsWith('/bind')) return ++binds === 1 ? { ok: false, status: 403 } : { ok: true, json: async () => ({ elder }) };
    polls += 1;
    return { ok: true, json: async () => ({ elder, navigation: { status: 'IDLE' } }) };
  };
  session.currentUser.value = { id: 2, role: 'family' };
  session.familySharingDenied.value = false;
  try {
    const monitor = scope.run(() => {
      const workflow = useFamilyMonitor({ currentUser: session.currentUser, activeMode,
        sessionKey: session.familySessionKey, apiBaseUrl: 'http://api.test', onDenied: session.revokeFamilySharing });
      watch(session.familySharingDenied, denied => { if (denied) workflow.deny(); });
      return workflow;
    });
    await assert.rejects(session.bindFamily({ elderAccount: '100003', bindingCode: '123456' }), /共享演示未开启/);
    await nextTick();
    assert.ok(monitor.unavailable.value);
    await session.bindFamily({ elderAccount: '100003', bindingCode: '123456' });
    assert.equal(session.confirmedFamilyElder.value.id, 3);
    await nextTick();
    assert.equal(monitor.unavailable.value, '');
    activeMode.value = 'family'; await nextTick();
    await Promise.resolve(); await Promise.resolve();
    assert.ok(polls > 0);
    assert.equal(monitor.elder.value.id, 3);
    assert.equal(JSON.parse(localStorage.getItem('familyMapUser')).boundElder, null);
  } finally { scope.stop(); globalThis.fetch = previousFetch; globalThis.window = previousWindow; }
});
