import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };
const { apiRequest } = await import('../src/services/apiClient.js');

test('apiRequest serializes bodies and attaches JSON and bearer headers', async () => {
  const previousFetch = globalThis.fetch;
  let requested;
  globalThis.fetch = async (url, options) => {
    requested = { url, options };
    return { ok: true, status: 200, json: async () => ({ accepted: true }) };
  };
  try {
    const response = await apiRequest('/api/auth/admin/login', {
      method: 'POST',
      token: 'session-token',
      body: { username: 'admin', password: 'secret' },
    });
    assert.deepEqual(response, { accepted: true });
    assert.equal(requested.url, 'http://localhost:8000/api/auth/admin/login');
    assert.equal(requested.options.headers['Content-Type'], 'application/json');
    assert.equal(requested.options.headers.Authorization, 'Bearer session-token');
    assert.equal(requested.options.body, JSON.stringify({ username: 'admin', password: 'secret' }));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('apiRequest preserves backend detail and uses a caller fallback for non-string details', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({ detail: '昵称或密码不正确' }),
  });
  try {
    await assert.rejects(apiRequest('/api/auth/elder'), { message: '昵称或密码不正确' });
    globalThis.fetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ detail: [{ msg: 'field required' }] }),
    });
    await assert.rejects(apiRequest('/api/auth/elder', { errorMessage: '登录失败，请稍后重试' }), {
      message: 'field required',
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
