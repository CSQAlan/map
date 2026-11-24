import test from 'node:test';
import assert from 'node:assert/strict';
import { createAmapSession } from '../src/services/amapSession.js';

test('shared SDK failure resets the vendor cache and retry makes a fresh load', async () => {
  let loads = 0;
  let failed = true;
  let resets = 0;
  const sdk = { Map: class {} };
  const session = createAmapSession({
    load() { loads++; return failed ? Promise.reject(Error('network')) : Promise.resolve(sdk); },
    reset() { resets++; failed = false; },
  }, {});
  const first = session.load();
  assert.equal(session.load(), first);
  await assert.rejects(first, /network/);
  assert.equal(resets, 1);
  assert.equal(await session.load(), sdk);
  assert.equal(loads, 2);
  assert.equal(await session.load(), sdk);
  assert.equal(loads, 2, 'A loaded SDK must not be reset/reloaded by another map');
});

test('hung SDK requires page reload and cannot overlap a late script with another load', async () => {
  let late;
  let loads = 0;
  let resets = 0;
  const sdk = { live: true };
  const session = createAmapSession({
    load() { return ++loads === 1 ? new Promise(resolve => { late = resolve; }) : Promise.resolve(sdk); },
    reset() { resets++; },
  }, {}, { timeoutMs: 20 });
  await assert.rejects(session.load(), { name: 'TimeoutError' });
  assert.equal(resets, 0);
  await assert.rejects(session.load(), { requiresPageReload: true });
  late({ stale: true });
  await Promise.resolve();
  await assert.rejects(session.load(), { requiresPageReload: true });
  assert.equal(loads, 1);
});
