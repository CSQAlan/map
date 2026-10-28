import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window ??= { location: { protocol: 'http:', hostname: 'localhost' } };
const { createAssistant } = await import('../src/composables/useAssistant.js');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('assistant sends paired history and optional limited context', async () => {
  const sent = [];
  const assistant = createAssistant({ request: async (path, options) => { sent.push([path, options]); return { reply: '说明', model: 'local' }; } });
  assistant.draft.value = '  你好  ';
  assert.equal(await assistant.send(), true);
  assert.equal(sent[0][0], '/api/assistant/chat');
  assert.deepEqual(sent[0][1].body.messages, [{ role: 'user', content: '你好' }]);
  assert.equal('context' in sent[0][1].body, false);
  const context = { mobility: '轮椅老人' };
  assert.equal(await assistant.send('第二问', context), true);
  assert.deepEqual(sent[1][1].body.context, context);
  assert.deepEqual(sent[1][1].body.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(assistant.draft.value, '');
});

test('failed sends preserve input and previous complete history', async () => {
  const assistant = createAssistant({ request: async () => { throw new Error('离线'); } });
  assistant.draft.value = '请解释';
  assert.equal(await assistant.send(), false);
  assert.equal(assistant.draft.value, '请解释');
  assert.deepEqual(assistant.messages.value, []);
  assert.equal(assistant.error.value, '离线');
  assert.equal(assistant.loading.value, false);
});

test('cancel discards a late reply without erasing a new turn', async () => {
  const late = deferred();
  let calls = 0;
  let firstSignal;
  const assistant = createAssistant({ request: async (_path, options) => {
    calls += 1;
    if (calls === 1) { firstSignal = options.signal; return late.promise; }
    return { reply: '新回答' };
  } });
  const old = assistant.send('旧问题');
  assert.equal(await assistant.send('重复'), false);
  assert.equal(calls, 1);
  assistant.cancel();
  assert.equal(firstSignal.aborted, true);
  assert.equal(assistant.draft.value, '旧问题');
  await assistant.send('新问题');
  late.resolve({ reply: '旧回答' });
  assert.equal(await old, false);
  assert.equal(assistant.messages.value.at(-1).content, '新回答');
});

test('history is bounded to six complete pairs plus the current question', async () => {
  const assistant = createAssistant({ request: async (_path, options) => {
    assert.ok(options.body.messages.length <= 13);
    assert.equal(options.body.messages[0].role, 'user');
    return { reply: '回答' };
  } });
  for (let i = 0; i < 10; i++) await assistant.send(`问题${i}`);
  assert.equal(assistant.messages.value.length, 14);
  assistant.clear();
  assert.equal(assistant.messages.value.length, 0);
  assert.equal(assistant.draft.value, '');
});

test('empty and oversized questions do not reach the backend', async () => {
  const assistant = createAssistant({ request: async () => { assert.fail('unexpected request'); } });
  assert.equal(await assistant.send(' '), false);
  assert.equal(await assistant.send('a'.repeat(1001)), false);
  assert.match(assistant.error.value, /1000/);
});

test('status failure has a recoverable message', async () => {
  const assistant = createAssistant({ request: async () => { throw new Error('offline'); } });
  await assistant.checkStatus();
  assert.equal(assistant.status.value.available, false);
  assert.equal(assistant.checking.value, false);
});

test('a late offline check cannot overwrite a successful chat connection', async () => {
  const pendingStatus = deferred();
  const assistant = createAssistant({ request: async path => path.endsWith('/status') ? pendingStatus.promise : { reply: '已连接', model: 'local' } });
  const checking = assistant.checkStatus();
  assert.equal(await assistant.send('你好'), true);
  assert.equal(assistant.status.value.available, true);
  assert.equal(assistant.checking.value, false);
  pendingStatus.resolve({ available: false, message: 'offline' });
  await checking;
  assert.equal(assistant.status.value.available, true);
});
