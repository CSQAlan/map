import test from 'node:test';
import assert from 'node:assert/strict';

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
