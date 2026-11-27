import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationWakeLock } from '../src/services/navigationWakeLock.js';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function sentinel({ released = false, fail = false } = {}) {
  const lock = new EventTarget(); lock.released = released; lock.calls = 0;
  lock.release = async () => { lock.calls++; if (fail) throw Error('release refused'); lock.released = true; lock.dispatchEvent(new Event('release')); };
  lock.platformRelease = () => { lock.released = true; lock.dispatchEvent(new Event('release')); };
  return lock;
}
function fixture(t, request) {
  const document = new EventTarget(); document.visibilityState = 'visible';
  let eligible = true, calls = 0;
  const controller = createNavigationWakeLock({ document, navigator: { wakeLock: { request(type) { assert.equal(type, 'screen'); calls++; return request(); } } }, eligible: () => eligible });
  t.after(controller.dispose);
  return { controller, document, calls: () => calls,
    pause(value = true) { eligible = !value; if (value) controller.disable(); },
    hide(value = true) { document.visibilityState = value ? 'hidden' : 'visible'; document.dispatchEvent(new Event('visibilitychange')); } };
}
const settled = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('fresh default is off; explicit enable, duplicate click, off and explicit reacquisition', async t => {
  const locks = [sentinel(), sentinel()];
  const f = fixture(t, () => locks[f.calls() - 1]); const c = f.controller;
  assert.equal(c.state.value, 'off'); assert.equal(f.calls(), 0);
  await c.enable(); assert.equal(c.state.value, 'active');
  await c.enable(); assert.equal(f.calls(), 1);
  c.disable(); await settled(); assert.equal(locks[0].calls, 1); assert.equal(c.state.value, 'released');
  assert.equal(f.calls(), 1); await c.enable(); assert.equal(c.state.value, 'active'); assert.equal(f.calls(), 2);
});

for (const reason of ['off', 'pause', 'hide', 'context', 'dispose']) {
  test(`late pending grant after ${reason} is released without ever becoming active`, async t => {
    const pending = deferred(), lock = sentinel(); const f = fixture(t, () => pending.promise), c = f.controller;
    const request = c.enable(); assert.equal(c.state.value, 'pending');
    await c.enable(); assert.equal(f.calls(), 1);
    if (reason === 'pause') f.pause(); else if (reason === 'hide') f.hide(); else if (reason === 'dispose') c.dispose(); else c.disable();
    f.pause(false); f.hide(false);
    await c.enable(); assert.equal(f.calls(), 1, 'pending request remains serialized after cancellation');
    pending.resolve(lock); await request;
    assert.equal(c.state.value, 'released'); assert.equal(lock.calls, 1); assert.equal(f.calls(), 1);
    if (reason === 'dispose') { await c.enable(); assert.equal(f.calls(), 1); }
  });
}

test('active pause and hidden tab release; resume, visibility and permission changes never reacquire', async t => {
  const locks = []; const f = fixture(t, () => { const lock = sentinel(); locks.push(lock); return lock; }); const c = f.controller;
  await c.enable(); f.pause(); await settled(); assert.equal(locks[0].calls, 1);
  await c.enable(); assert.equal(f.calls(), 1);
  f.pause(false); await settled(); assert.equal(f.calls(), 1);
  await c.enable(); f.hide(); await settled(); assert.equal(locks[1].calls, 1);
  await c.enable(); f.hide(false); f.document.dispatchEvent(new Event('permissionschange')); await settled();
  assert.equal(f.calls(), 2); assert.equal(c.state.value, 'released');
  await c.enable(); assert.equal(f.calls(), 3);
});

test('unsupported, synchronous rejection, pending rejection and already released sentinel are truthful', async t => {
  const unsupported = createNavigationWakeLock({ navigator: {}, document: undefined });
  assert.equal(unsupported.state.value, 'unsupported'); await unsupported.enable(); unsupported.dispose();
  for (const request of [() => { throw Error('denied'); }, () => Promise.reject(Error('denied'))]) {
    const f = fixture(t, request); await f.controller.enable(); assert.equal(f.controller.state.value, 'rejected');
  }
  const f = fixture(t, () => sentinel({ released: true })); await f.controller.enable(); assert.equal(f.controller.state.value, 'released');
});

test('platform releases do not auto renew and stale release events cannot affect a newer lock', async t => {
  const locks = [sentinel(), sentinel()]; const f = fixture(t, () => locks[f.calls() - 1]); const c = f.controller;
  await c.enable(); locks[0].platformRelease(); assert.equal(c.state.value, 'released'); assert.equal(f.calls(), 1);
  await c.enable(); locks[0].platformRelease(); assert.equal(c.state.value, 'active');
  c.dispose(); await settled(); assert.equal(locks[1].calls, 1);
});

test('release rejections are consumed for active and obsolete pending locks', async t => {
  for (const late of [false, true]) {
    const pending = deferred(), lock = sentinel({ fail: true }); const f = fixture(t, () => late ? pending.promise : lock); const c = f.controller;
    const request = c.enable();
    if (!late) await request;
    c.disable(); if (late) { pending.resolve(lock); await request; }
    await settled(); assert.equal(c.state.value, 'release-error'); await c.enable(); assert.equal(f.calls(), 1);
  }
});

test('obsolete rejection does not replace released state or issue another request', async t => {
  const pending = deferred(); const f = fixture(t, () => pending.promise); const c = f.controller;
  const request = c.enable(); c.disable(); pending.reject(Error('denied')); await request;
  assert.equal(c.state.value, 'released'); assert.equal(f.calls(), 1);
});
