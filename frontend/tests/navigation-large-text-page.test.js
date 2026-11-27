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
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0,
    progress: { index: 1, paused: false }, mapFeatures: registry(), ...extra });
  const visible = reactive({ value: true }), root = node('root'), Page = await component();
  const handlers = Object.fromEntries(['Progress', 'SelectSegment', 'EndNavigation', 'OpenRoutes',
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
function assertLarge(p, enabled, disabled = false) {
  const button = p.button(enabled ? CLOSE : OPEN);
  assert.ok(button, enabled ? CLOSE : OPEN);
  assert.equal(button.props.type, 'button');
  assert.equal(button.props['aria-pressed'], enabled);
  assert.equal(button.props.disabled, disabled);
  assert.equal(hasClass(p.byClass('journey-page'), 'journey-large-text'), enabled);
}
function unchanged(p) {
  return clone({ props: p.props, events: p.events, effects: p.effects,
    maps: all(p.root).filter(isMap).map(n => n.props) });
}

for (const [name, extra] of [['fallback map', {}], ['base map', { pilotArea: { center: [106, 29] } }]]) {
  test(`native large-text toggle defaults off and changes no guidance or device effects with ${name}`, async t => {
    const p = await mount(t, extra), map = all(p.root).find(isMap);
    assertLarge(p, false);
    const before = unchanged(p);
    await p.click(OPEN); assertLarge(p, true);
    assert.equal(all(p.root).find(isMap), map, 'map instance is retained');
    assert.deepEqual(unchanged(p), before);
    await p.click(CLOSE); assertLarge(p, false);
    assert.equal(all(p.root).find(isMap), map);
    assert.deepEqual(unchanged(p), before);
    for (const key of ['fetch', 'network', 'storage', 'speak', 'gps', 'wake']) assert.equal(p.effects[key], 0, key);
  });
}

test('toggling retains current instructions, rest plan, map preview and the explicit show card', async t => {
  const p = await mount(t);
  const select = all(p.root).find(n => n.props.id === 'navigation-walking-plan');
  await select.props.onChange({ target: { value: '100' } }); await nextTick();
  await p.click('预览下一段'); await p.click('给身边的人看');
  const card = p.find('navigation-show-step'), focused = document.activeElement;
  const content = () => [text(p.byClass('journey-current')), text(p.byClass('journey-counter')),
    text(p.find('manual-remaining')), text(p.find('navigation-rest')), text(p.find('navigation-rest-plan')),
    text(all(p.root).find(n => n.props.id === 'next-segment-preview')), select.props.value];
  assert.equal(select.props.value, 100);
  assert.match(text(p.find('navigation-rest-plan')), /少约 50 米/);
  assert.equal(text(p.find('navigation-show-step-text')), '第 2 段：合成乙路');
  const before = content(), beforeEffects = unchanged(p);
  await p.click(OPEN); assertLarge(p, true);
  assert.deepEqual(content(), before);
  assert.equal(p.find('navigation-show-step'), card);
  assert.equal(document.activeElement, focused);
  await p.click(CLOSE); assertLarge(p, false);
  assert.deepEqual(content(), before);
  assert.equal(p.find('navigation-show-step'), card);
  assert.deepEqual(unchanged(p), beforeEffects);
});

test('same-route manual next and previous, display mode and ordinary rest retain the preference', async t => {
  const p = await mount(t), selectedRoute = p.props.selectedRoute;
  await p.click(OPEN);
  await p.click('已走完这段'); assertLarge(p, true);
  assert.equal(p.events.findLast(([name]) => name === 'Progress')[1].index, 2);
  assert.match(text(p.byClass('journey-counter')), /第 3 段，共 3 段：合成丙路/);
  p.props.progress = { index: 2, paused: false }; await nextTick(); assertLarge(p, true);
  await p.click('上一段'); assertLarge(p, true);
  assert.equal(p.events.findLast(([name]) => name === 'Progress')[1].index, 1);
  p.props.progress = { index: 1, paused: false }; await nextTick();
  await p.click('文字导航'); assertLarge(p, true);
  assert.equal(all(p.root).some(n => n.props.id === 'optional-navigation-map'), false);
  await p.click('累了，休息一下'); assertLarge(p, true);
  await p.click('看看前方能在哪歇');
  assert.match(text(p.find('navigation-paused')), /第 2 段/);
  const before = unchanged(p), pausedText = text(p.find('navigation-paused'));
  await p.click(CLOSE); assertLarge(p, false);
  await p.click(OPEN); assertLarge(p, true);
  assert.equal(text(p.find('navigation-paused')), pausedText);
  assert.deepEqual(unchanged(p), before);
  assert.equal(p.button('已走完这段').props.disabled, true);
  await p.click('继续前行'); assertLarge(p, true);
  await p.click('地图导航'); assertLarge(p, true);
  assert.match(text(p.byClass('journey-counter')), /第 2 段，共 3 段：合成乙路/);
  assert.equal(p.props.selectedRoute, selectedRoute);
  assert.equal(p.events.some(([name]) => ['EndNavigation', 'OpenRoutes', 'ConfirmObstruction'].includes(name)), false);
  for (const key of ['fetch', 'network', 'storage', 'speak', 'gps', 'wake']) assert.equal(p.effects[key], 0, key);
});

test('same-route metadata, parent progress and proof updates do not reset a reading preference', async t => {
  const p = await mount(t); await p.click(OPEN);
  p.props.selectedRoute.private_note = '合成备注更新'; await nextTick(); assertLarge(p, true);
  p.props.selectedRoute.segments[1].explanation = '合成登记说明更新'; await nextTick(); assertLarge(p, true);
  p.props.progress = { index: 1, paused: false }; await nextTick(); assertLarge(p, true);
  p.props.textMemoRouteVerified = false; await nextTick(); assertLarge(p, true);
  p.props.mapFeatures[0].properties.explanation = '合成登记更新'; await nextTick(); assertLarge(p, true);
});

for (const [label, mutate] of [
  ['route reference replacement', p => { p.props.selectedRoute = route(); }],
  ['profile change', p => { p.props.selectedProfile = { label: '合成出行情况' }; }],
  ['pilot area change', p => { p.props.pilotArea = { center: [106, 29] }; }],
  ['memo scope change', p => { p.props.memoScope++; }],
]) test(`large text resets on ${label} and permits an explicit new choice`, async t => {
  const p = await mount(t); await p.click(OPEN);
  mutate(p); await nextTick(); assertLarge(p, false);
  await p.click(OPEN); assertLarge(p, true);
});

test('guidance pause clears large text and a captured handler cannot revive the hidden page', async t => {
  const p = await mount(t), toggle = p.button(OPEN).props.onClick;
  await p.click(OPEN); p.props.guidancePaused = true; await nextTick();
  assert.equal(p.byClass('journey-page'), undefined);
  assert.equal(p.byClass('journey-large-text'), undefined);
  const before = unchanged(p); await toggle(); await nextTick();
  assert.deepEqual(unchanged(p), before);
  p.props.guidancePaused = false; await nextTick(); assertLarge(p, false);
});

test('active detour changes reset large text but permit a fresh choice and ordinary local rest', async t => {
  const p = await mount(t);
  await p.click(OPEN); p.props.detourActive = true; await nextTick(); assertLarge(p, false);
  const before = unchanged(p); await p.click(OPEN); assertLarge(p, true);
  assert.deepEqual(unchanged(p), before);
  await p.click('累了，休息一下'); assertLarge(p, true);
  await p.click('继续前行'); assertLarge(p, true);
  p.props.detourActive = false; await nextTick(); assertLarge(p, false);
});

test('obstruction confirmation clears and blocks large text, and cancellation leaves it off', async t => {
  const p = await mount(t, { obstructionState: { reason: '', options: [
    { kind: 'current', index: 1, manualIndex: 1, segment_code: 'b', name: '合成乙路' },
  ] } }), toggle = p.button(OPEN).props.onClick;
  await p.click(OPEN); const before = clone([p.props, p.events]);
  await p.click('前方走不了'); assertLarge(p, false, true);
  const blocked = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), blocked);
  await p.click('取消，继续原行程'); assertLarge(p, false);
  assert.deepEqual(clone([p.props, p.events]), before);
});

test('end confirmation clears and blocks the preference; cancel and confirmed end keep their behavior', async t => {
  const p = await mount(t), toggle = p.button(OPEN).props.onClick;
  await p.click(OPEN); await p.click('结束导航'); assertLarge(p, false, true);
  const blocked = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), blocked);
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
  await p.click('继续导航'); assertLarge(p, false);
  await p.click(OPEN); await p.click('结束导航'); await p.click('结束但未确认到达');
  assertLarge(p, false, true);
  const ended = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), ended);
  assert.equal(p.events.filter(([name]) => name === 'EndNavigation').length, 1);
});

test('leaving for route choices clears the preference and rejects a captured toggle immediately', async t => {
  const p = await mount(t), toggle = p.button(OPEN).props.onClick;
  await p.click(OPEN); await p.click('查看路线方案'); assertLarge(p, false, true);
  const before = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), before);
  assert.equal(p.events.filter(([name]) => name === 'OpenRoutes').length, 1);
});

test('no route or current segment leaves large text disabled and cannot retain its class', async t => {
  const p = await mount(t, { selectedRoute: null }), toggle = p.button(OPEN).props.onClick;
  assertLarge(p, false, true);
  const before = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), before);
  p.props.selectedRoute = route(); await nextTick(); assertLarge(p, false);
  await p.click(OPEN); assertLarge(p, true);
  p.props.selectedRoute.segment_codes = []; p.props.selectedRoute.segments = [];
  await nextTick(); assertLarge(p, false, true);
  const empty = unchanged(p); await toggle(); await nextTick();
  assertLarge(p, false, true); assert.deepEqual(unchanged(p), empty);
});

test('unmounted captured toggles have no effects and remounting starts with normal text', async t => {
  const p = await mount(t), toggle = p.button(OPEN).props.onClick;
  await p.click(OPEN); const enabledToggle = p.button(CLOSE).props.onClick;
  p.visible.value = false; await nextTick();
  const before = unchanged(p);
  await toggle(); await enabledToggle(); await nextTick();
  assert.equal(p.byClass('journey-page'), undefined);
  assert.equal(p.byClass('journey-large-text'), undefined);
  assert.deepEqual(unchanged(p), before);
  p.visible.value = true; await nextTick(); assertLarge(p, false);
});
