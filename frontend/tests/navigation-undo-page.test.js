import test from 'node:test';
import { createNavigationReceipt } from '../src/composables/useNavigationReceipt.js';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, markRaw, reactive, nextTick } from 'vue';

// Exercise the real page with registered synthetic roads and an in-memory DOM.
const UNDO = '撤销刚才的确认';
function route() {
  const codes = ['a', 'b', 'c'], names = ['合成甲路', '合成乙路', '合成丙路'];
  return { distance_m: 180, segment_codes: codes, private_note: '合成备注',
    segments: codes.map((segment_code, i) => ({ segment_code, name: names[i],
      length_m: [100, 50, 30][i], step_count: 0, width_m: 2,
      explanation: '请核对现场后沿登记道路前行。', risk_tags: ['留意现场'],
      geometry_coordinates: [[106 + i / 1000, 29], [106 + (i + 1) / 1000, 29]] })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1',
      segment_codes: [...codes], node_codes: ['A', 'B', 'C', 'D'], segment_lengths_m: [100, 50, 30],
      stops: [{ node_index: 2, node_code: 'C', name: '合成中途休息点' },
        { node_index: 3, node_code: 'D', name: '合成终点休息点' }] } };
}

const registry = () => route().segments.map(row => ({ type: 'Feature',
  properties: { kind: 'segment', ...row },
  geometry: { type: 'LineString', coordinates: row.geometry_coordinates } }));
const node = (type, value = '') => markRaw({ type, text: value, children: [], props: {}, focusCount: 0,
  focus() { this.focusCount++; document.activeElement = this; },
  addEventListener() {}, removeEventListener() {},
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  querySelectorAll(selector) { return all(this).filter(n => n !== this && n.type === selector); } });
const all = n => [n, ...n.children.flatMap(all)];
const text = n => n ? n.text + n.children.map(text).join('') : '';
const hasClass = (n, name) => String(n?.props.class || '').split(/\s+/).includes(name);
const clone = value => JSON.parse(JSON.stringify(value));
const isMap = n => ['AmapRouteMap', 'FallbackRouteMap'].includes(n.type);
let compiled;
async function component() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'navigation-large-text-page-test', inlineTemplate: true }).content;
  code = code.replace(/import \{ watchCoordinates \} from '[^']+';/,
    'const watchCoordinates = (...args) => globalThis.__navigationLargeTextGps(...args);')
    .replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}='${name}';`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
      `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}
async function mount(t, extra = {}) {
  const originals = new Map(), events = [];
  const effects = { fetch: 0, network: 0, storage: 0, speak: 0, cancel: 0, voices: 0,
    gps: 0, wake: 0, mapCreate: 0, mapRemove: 0, mapPatch: 0 };
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  set('document', { activeElement: null, visibilityState: 'visible', addEventListener() {},
    removeEventListener() {}, getElementById: () => null });
  set('navigator', { wakeLock: { request() { effects.wake++; throw Error('unexpected wake request'); } } });
  set('speechSynthesis', { getVoices() { effects.voices++; return []; },
    cancel() { effects.cancel++; }, speak() { effects.speak++; } });
  set('SpeechSynthesisUtterance', class { constructor(text) { this.text = text; } });
  set('__navigationLargeTextGps', () => { effects.gps++; throw Error('unexpected GPS request'); });
  for (const key of ['localStorage', 'sessionStorage']) set(key, new Proxy({}, {
    get() { effects.storage++; return () => null; },
    set() { effects.storage++; return true; },
  }));
  for (const key of ['XMLHttpRequest', 'WebSocket', 'EventSource']) set(key,
    class { constructor() { effects.network++; throw Error('unexpected network request'); } });
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected fetch'); });
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0, arrivalSession: 7, manualConfirmedCount: 0,
    progress: { index: 0, paused: false }, mapFeatures: registry(), ...extra });
  const model = createNavigationReceipt();
  props.arrivalSession = model.begin(props.selectedRoute);
  const visible = reactive({ value: true }), root = node('root'), Page = await component();
  const handlers = Object.fromEntries(['ConfirmManualSegment', 'Progress', 'SelectSegment', 'EndNavigation', 'OpenRoutes',
    'SendSos', 'RetryMap', 'ConfirmObstruction', 'PauseDetour', 'MapError']
    .map(name => [`on${name}`, value => events.push([name, value])]));
  handlers.onConfirmManualSegment = event => {
    events.push(['ConfirmManualSegment', event]);
    if (event.index === props.progress.index && event.route === props.selectedRoute) model.confirm(event);
  };
  handlers.onDiscardManualUndo = event => {
    if (event.session === props.arrivalSession && event.route === props.selectedRoute) model.discardUndo();
  };
  handlers.onProgress = event => { events.push(['Progress', event]); props.progress = event; };
  handlers.onEndNavigation = event => { events.push(['EndNavigation', event]); model.finish(event); };
  const renderer = createRenderer({ createElement(tag) {
    const n = node(tag); if (isMap(n)) effects.mapCreate++; return n;
  }, createText: value => node('#text', value), createComment: () => node('#comment'),
    setText(n, value) { n.text = value; }, setElementText(n, value) { n.text = value; n.children = []; },
    patchProp(n, key, old, value) { if (isMap(n)) effects.mapPatch++; n.props[key] = value; },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent; const i = parent.children.indexOf(anchor);
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
    }, remove(n) {
      if (isMap(n)) effects.mapRemove++;
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
    }, parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
  const app = renderer.createApp({ render: () => visible.value ? h(Page, { ...props, ...handlers, manualUndo: model.undoCandidate.value,
    manualConfirmedCount: model.confirmedCount.value,
    undoManualConfirmation: token => token.nextIndex === props.progress.index && !props.progress.paused && model.undo(token) }) : null });
  app.mount(root);
  t.after(() => {
    app.unmount();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const button = label => all(root).find(n => n.type === 'button' && text(n) === label);
  const find = id => all(root).find(n => n.props['data-testid'] === id);
  const byClass = name => all(root).find(n => hasClass(n, name));
  return { model, root, props, visible, effects, events, button, find, byClass,
    async click(label) {
      const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true, label);
      await b.props.onClick(); await nextTick();
    } };
}

const count = p => text(p.find('manual-confirmed-count'));
const progress = p => p.events.filter(([name]) => name === 'Progress');

test('real page + receipt: forward 1/3 -> undo 0/3 at original segment, one progress and no device/camera action', async t => {
  const p = await mount(t, { pilotArea: {} });
  await p.click('已走完这段');
  assert.match(count(p), /当前正在走第 2 段.*1 段 \/ 共 3 段/);
  const before = { ...p.effects }, prior = progress(p).length;
  const selectCount = p.events.filter(([n]) => n === 'SelectSegment').length;
  const map = all(p.root).find(isMap), camera = map.props['camera-request'];
  const action = p.button(UNDO).props.onClick;
  await action(); await action(); await nextTick();
  assert.match(count(p), /当前正在走第 1 段.*0 段 \/ 共 3 段/);
  assert.equal(p.model.confirmedCount.value, 0);
  assert.equal(progress(p).length, prior + 1);
  assert.equal(p.events.filter(([n]) => n === 'SelectSegment').length, selectCount);
  assert.equal(map.props['camera-request'], camera);
  assert.equal(map.props.following, false);
  assert.equal(document.activeElement, p.button('已走完这段'));
  for (const key of ['fetch','network','storage','speak','gps','wake']) assert.equal(p.effects[key], before[key], key);
});

test('last segment undo only removes its mark; end receipt uses real Set independently of arrival', async t => {
  const p = await mount(t);
  await p.click('已走完这段'); await p.click('已走完这段');
  await p.click('手动确认最后一段已走完');
  const before = progress(p).length;
  await p.click(UNDO);
  assert.match(count(p), /当前正在走第 3 段.*2 段 \/ 共 3 段/);
  assert.equal(progress(p).length, before);
  await p.click('核对目的地并结束'); await p.click('我已到达（本人确认）');
  assert.deepEqual(p.model.receipt.value, { outcome: 'arrived', confirmed: 2, total: 3 });
});

test('previous only reviews; repeated first and last marks preserve old members and offer no undo', async t => {
  const p = await mount(t);
  await p.click('已走完这段'); const stale = p.button(UNDO).props.onClick;
  await p.click('上一段'); assert.equal(p.button(UNDO), undefined);
  assert.equal(p.model.confirmedCount.value, 1);
  await p.click('已走完这段'); assert.equal(p.button(UNDO), undefined);
  await stale(); await nextTick(); assert.equal(p.model.confirmedCount.value, 1);
  await p.click('已走完这段'); await p.click('手动确认最后一段已走完');
  await p.click('手动确认最后一段已走完'); assert.equal(p.button(UNDO), undefined);
  assert.equal(p.model.confirmedCount.value, 3);
});

test('old callback cannot undo a newer step, including after returning to the same index', async t => {
  const p = await mount(t);
  await p.click('已走完这段'); const old = p.button(UNDO).props.onClick;
  await p.click('已走完这段'); const latest = p.button(UNDO).props.onClick;
  await old(); await nextTick(); assert.equal(p.model.confirmedCount.value, 2);
  assert.equal(p.props.progress.index, 2);
  await latest(); await p.click('上一段'); await p.click('已走完这段');
  await p.click('已走完这段'); const current = p.model.undoCandidate.value;
  await latest(); await nextTick();
  assert.equal(p.model.undoCandidate.value, current); assert.equal(p.model.confirmedCount.value, 2);
});

for (const boundary of ['rest','end-cancel','obstruction','recovery','guidancePaused','detourActive',
  'memoScope','arrivalSession','selectedRoute','selectedProfile','pilotArea','other-action','leave','unmount']) {
  test(`undo expires permanently on ${boundary}; stale callback cannot delete the mark`, async t => {
    const p = await mount(t, { obstructionState: { options: [{}] } });
    await p.click('已走完这段'); const old = p.button(UNDO).props.onClick;
    if (boundary === 'rest') { await p.click('累了，休息一下'); await p.click('继续前行'); }
    else if (boundary === 'end-cancel') { await p.click('结束导航'); await p.click('继续导航'); }
    else if (boundary === 'obstruction') { await p.click('前方走不了'); await p.click('取消，继续原行程'); }
    else if (boundary === 'recovery') { await p.click('我不确定走到哪'); await p.click('关闭核对'); }
    else if (boundary === 'leave') await p.click('查看路线方案');
    else if (boundary === 'unmount') { p.visible.value = false; await nextTick(); }
    else if (boundary === 'other-action') {
      const section = all(p.root).find(n => n.props.onClickCapture);
      section.props.onClickCapture({ target: { closest: () => ({ hasAttribute: () => false }) } });
    } else {
      p.props[boundary] = ['memoScope','arrivalSession'].includes(boundary) ? 99
        : ['guidancePaused','detourActive'].includes(boundary) ? true : boundary === 'selectedRoute' ? route() : {};
      await nextTick();
    }
    await old(); await nextTick();
    assert.equal(p.model.confirmedCount.value, 1);
    assert.equal(p.model.undoCandidate.value, null);
    assert.equal(p.button(UNDO), undefined);
  });
}

test('new session rejects the old callback; parent rejection cannot simulate undo', async t => {
  const p = await mount(t);
  await p.click('已走完这段'); const old = p.button(UNDO).props.onClick;
  p.props.arrivalSession = p.model.begin(p.props.selectedRoute); await nextTick();
  await p.click('已走完这段'); const current = p.model.undoCandidate.value;
  await old(); await nextTick();
  assert.equal(p.model.undoCandidate.value, current); assert.equal(p.model.confirmedCount.value, 1);
  p.model.discardUndo(); await old(); await nextTick();
  assert.equal(p.props.progress.index, 2); assert.equal(p.model.confirmedCount.value, 1);
});

test('undo silences automatic speech even when voice was explicitly enabled', async t => {
  const p = await mount(t);
  globalThis.speechSynthesis.getVoices = () => [{ lang: 'zh-CN', localService: true }];
  await p.click('开启语音提示'); await p.click('已走完这段');
  const before = p.effects.speak;
  assert.equal(before, 2, 'explicit opt-in speaks initially and on normal advance');
  assert.ok(p.button('关闭语音'));
  await p.click(UNDO);
  assert.equal(p.effects.speak, before);
});
