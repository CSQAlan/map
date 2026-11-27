import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, markRaw, reactive, nextTick } from 'vue';

// Exercise the real page with registered synthetic roads and an in-memory DOM.
const OPEN = '放大导航文字', CLOSE = '关闭导航文字放大';
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
  set('__navigationLargeTextGps', () => { effects.gps++; throw Error('unexpected GPS request'); });
  for (const key of ['localStorage', 'sessionStorage']) set(key, new Proxy({}, {
    get() { effects.storage++; return () => null; },
    set() { effects.storage++; return true; },
  }));
  for (const key of ['XMLHttpRequest', 'WebSocket', 'EventSource']) set(key,
    class { constructor() { effects.network++; throw Error('unexpected network request'); } });
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected fetch'); });
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0, arrivalSession: 7, manualConfirmedCount: 0,
    progress: { index: 1, paused: false }, mapFeatures: registry(), ...extra });
  const visible = reactive({ value: true }), root = node('root'), Page = await component();
  const handlers = Object.fromEntries(['ConfirmManualSegment', 'Progress', 'SelectSegment', 'EndNavigation', 'OpenRoutes',
    'SendSos', 'RetryMap', 'ConfirmObstruction', 'PauseDetour', 'MapError']
    .map(name => [`on${name}`, value => events.push([name, value])]));
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
  const app = renderer.createApp({ render: () => visible.value ? h(Page, { ...props, ...handlers }) : null });
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
  return { root, props, visible, effects, events, button, find, byClass,
    async click(label) {
      const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true, label);
      await b.props.onClick(); await nextTick();
    } };
}

for (const [label, outcome] of [['我已到达（本人确认）', 'arrived'], ['结束但未确认到达', 'unconfirmed']]) {
  test(`ordinary end: ${outcome}, safe default, repeat and stale handlers`, async t => {
    const p = await mount(t);
    const trigger = p.button('结束导航');
    await trigger.props.onClick({currentTarget: trigger}); await nextTick();
    assert.equal(document.activeElement, p.button('继续导航'));
    const submit = p.button(label).props.onClick;
    await submit(); await submit(); await nextTick();
    const ended = p.events.filter(([name]) => name === 'EndNavigation');
    assert.equal(ended.length, 1); assert.equal(ended[0][1].outcome, outcome);
    assert.equal(ended[0][1].session, 7);
    for (const key of ['fetch','network','storage','gps','wake']) assert.equal(p.effects[key], 0);
  });
}
test('cancel, close and Escape return focus and never emit a result', async t => {
  const p = await mount(t), trigger = p.button('结束导航');
  for (const label of ['继续导航', '关闭']) {
    await trigger.props.onClick({currentTarget: trigger}); await nextTick();
    await p.click(label); assert.equal(document.activeElement, trigger);
  }
  await trigger.props.onClick({currentTarget: trigger}); await nextTick();
  const dialog = all(p.root).find(n => n.props.role === 'dialog');
  const handler = dialog.props.onKeydown;
  const event = {key:'Escape', stopPropagation(){}, preventDefault(){}};
  for (const fn of Array.isArray(handler) ? handler : [handler]) await fn(event);
  await nextTick(); assert.equal(document.activeElement, trigger);
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
  await p.click('查看路线方案');
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
});
test('manual confirmation follows only an explicit forward choice and arrival stays independent', async t => {
  const p = await mount(t);
  await p.click('上一段');
  assert.equal(p.events.some(([name]) => name === 'ConfirmManualSegment'), false);
  await p.click('已走完这段');
  assert.equal(p.events.filter(([name]) => name === 'ConfirmManualSegment').length, 1);
  assert.equal(p.events.find(([name]) => name === 'ConfirmManualSegment')[1].index, 0);
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
});
for (const field of ['arrivalSession','memoScope','selectedRoute','detourActive']) test(`changed ${field} invalidates an open dialog`, async t => {
  const p = await mount(t); await p.click('结束导航');
  const submit = p.button('我已到达（本人确认）').props.onClick;
  p.props[field] = field === 'selectedRoute' ? route() : field === 'detourActive' ? true : 99;
  await nextTick(); await submit(); await nextTick();
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
});

test('a captured choice from an old dialog cannot submit or close a later session dialog', async t => {
  const p = await mount(t); await p.click('结束导航');
  const oldSubmit = p.button('我已到达（本人确认）').props.onClick;
  const oldDismiss = p.button('继续导航').props.onClick;
  p.props.arrivalSession++; await nextTick(); await p.click('结束导航');
  await oldSubmit(); await oldDismiss(); await nextTick();
  assert.ok(p.button('继续导航'));
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
  await p.click('结束但未确认到达');
  assert.equal(p.events.find(([name]) => name === 'EndNavigation')[1].session, 8);
});
