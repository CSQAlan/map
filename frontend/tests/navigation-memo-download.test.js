import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMemoDownload, routeMemoDownloadSupported, ROUTE_MEMO_FILENAME } from '../src/services/routeMemoDownload.js';

function browser(fail = '') {
  const calls = [], blobs = [], timers = new Map();
  const env = { Blob, navigator: { userAgent: 'Chrome/120 Safari/537.36', userActivation: { isActive: true } },
    URL: { createObjectURL(blob) { calls.push('url'); blobs.push(blob); if (fail === 'url') throw Error('url'); return 'blob:synthetic'; },
      revokeObjectURL(url) { calls.push(['revoke', url]); } },
    document: { body: { appendChild() { calls.push('append'); if (fail === 'append') throw Error('append'); } },
      createElement() { return { download: '', remove() { calls.push('remove'); }, click() {
        calls.push(['click', this.download, this.href]); if (fail === 'click') throw Error('click');
      } }; } },
    setTimeout(fn) { calls.push('timer'); if (fail === 'timer') throw Error('timer'); timers.set(1, fn); return 1; },
    clearTimeout(id) { timers.delete(id); } };
  return { env, calls, blobs, timers };
}
test('no work before a trusted explicit event; link click is synchronous with exact UTF-8 plaintext', async () => {
  const b = browser(), file = createRouteMemoDownload(b.env);
  assert.deepEqual(b.calls, []);
  assert.equal(file.download('路线备忘', { isTrusted: false }), 'unsupported');
  assert.deepEqual(b.calls, []);
  assert.equal(file.download('路线备忘', { isTrusted: true }), 'requested');
  assert.equal(ROUTE_MEMO_FILENAME, 'route-memo.txt');
  assert.deepEqual(b.calls.slice(0, 4), ['url', 'append', ['click', 'route-memo.txt', 'blob:synthetic'], 'remove']);
  assert.equal(b.blobs[0].type, 'text/plain;charset=utf-8');
  assert.deepEqual(new Uint8Array(await b.blobs[0].arrayBuffer()), new TextEncoder().encode('路线备忘'));
  b.timers.get(1)(); file.dispose();
  assert.equal(b.calls.filter(x => Array.isArray(x) && x[0] === 'revoke').length, 1);
  assert.equal(b.timers.size, 0);
});
test('unsupported browser or known native WebView never creates a URL or clicks', () => {
  for (const change of [e => { delete e.URL.createObjectURL; }, e => { delete e.URL.revokeObjectURL; },
    e => { e.document.createElement = () => ({}); }, e => { e.navigator.userAgent = 'Android; wv Chrome/120'; },
    e => { e.navigator.userAgent = 'iPhone AppleWebKit/605.1'; }, e => { e.Capacitor = { isNativePlatform: () => true }; }]) {
    const b = browser(); change(b.env); const file = createRouteMemoDownload(b.env);
    assert.equal(routeMemoDownloadSupported(b.env), false);
    assert.equal(file.download('路线备忘', { isTrusted: true }), 'unsupported');
    assert.deepEqual(b.calls, []);
  }
});
test('download exceptions and lifecycle disposal detach and revoke once without retrying the click', () => {
  for (const fail of ['url', 'append', 'click', 'timer']) {
    const b = browser(fail), file = createRouteMemoDownload(b.env);
    assert.equal(file.download('路线备忘', { isTrusted: true }), 'error'); file.dispose();
    assert.equal(b.calls.filter(x => Array.isArray(x) && x[0] === 'revoke').length, Number(fail !== 'url'));
    assert.ok(b.calls.filter(x => Array.isArray(x) && x[0] === 'click').length <= 1);
    assert.equal(b.timers.size, 0);
  }
  const b = browser(), file = createRouteMemoDownload(b.env);
  file.download('路线备忘', { isTrusted: true }); file.dispose(); file.dispose();
  assert.equal(b.calls.filter(x => Array.isArray(x) && x[0] === 'revoke').length, 1);
  assert.equal(b.timers.size, 0);
});
