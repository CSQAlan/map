import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, markRaw, reactive, nextTick } from 'vue';

// Real page and proof helpers, with synthetic registrations and an in-memory DOM.
const OPEN = '给身边的人看', CLOSE = '关闭大字卡';
const CURRENT = '第 2 段：内部主路到楼栋组团B';
const CAVEAT = '这是我在查看的路线步骤，不能确认我就在这里。';
const route = () => ({ distance_m: 180, segment_codes: ['a', 'b', 'c'],
  private_note: '合成隐私占位文本', segments: [
    { segment_code: 'c', name: '合成湖边步道', length_m: 30 },
    { segment_code: 'a', name: '合成南门连接路', length_m: 100 },
    { segment_code: 'b', name: '内部主路到楼栋组团B', length_m: 50,
      explanation: '合成不应展示的辅助说明', risk_tags: ['合成不应展示的注意事项'] },
  ] });
const registry = () => route().segments.map(row => ({ properties: { kind: 'segment', ...row } }));
const node = (type, text = '') => markRaw({ type, text, children: [], props: {}, focusCount: 0,
  focus() { this.focusCount++; document.activeElement = this; },
  addEventListener() {}, removeEventListener() {},
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  querySelectorAll(selector) { return all(this).filter(n => n !== this && n.type === selector); } });
const all = n => [n, ...n.children.flatMap(all)];
const text = n => n ? n.text + n.children.map(text).join('') : '';
let compiled;
async function component() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'navigation-show-step-page-test', inlineTemplate: true }).content;
  code = code.replace(/import \{ watchCoordinates \} from '[^']+';/,
    'const watchCoordinates = () => { throw Error("unexpected GPS"); };')
    .replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}='${name}';`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
      `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}
async function mount(t, extra = {}) {
  const originals = new Map(), effects = { fetch: 0, speak: 0, wake: 0 }, events = [];
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  set('document', { activeElement: null, visibilityState: 'visible', addEventListener() {},
    removeEventListener() {}, getElementById: () => null });
  set('navigator', { wakeLock: { request() { effects.wake++; throw Error('unexpected wake'); } } });
  set('speechSynthesis', { getVoices: () => [], cancel() {}, speak() { effects.speak++; } });
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected fetch'); });
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0,
    progress: { index: 1, paused: false }, mapFeatures: registry(), ...extra });
  const visible = reactive({ value: true }), root = node('root'), Page = await component();
  const handlers = Object.fromEntries(['Progress', 'SelectSegment', 'EndNavigation', 'OpenRoutes',
    'SendSos', 'RetryMap', 'ConfirmObstruction', 'PauseDetour', 'MapError']
    .map(name => [`on${name}`, value => events.push([name, value])]));
  const renderer = createRenderer({ createElement: tag => node(tag), createText: value => node('#text', value),
    createComment: () => node('#comment'), setText(n, value) { n.text = value; },
    setElementText(n, value) { n.text = value; n.children = []; }, patchProp(n, key, old, value) { n.props[key] = value; },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent; const i = parent.children.indexOf(anchor);
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
    }, remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
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
  return { props, root, visible, effects, events, button, find,
    async click(label) {
      const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true);
      await b.props.onClick(); await nextTick();
    } };
}

test('explicit show card follows segment_codes, displays only the current registered name and has no navigation effects', async t => {
  const p = await mount(t), before = JSON.stringify([p.events, p.props]);
  assert.equal(p.find('navigation-show-step'), undefined);
  await p.click(OPEN);
  const card = p.find('navigation-show-step');
  assert.ok(card);
  assert.equal(text(p.find('navigation-show-step-text')), CURRENT);
  assert.equal(all(card).find(n => n.type === 'h2' || n.type === 'h3')?.text, '请帮我核对这段路');
  assert.ok(all(card).some(n => text(n) === CAVEAT));
  assert.doesNotMatch(text(card), /合成南门连接路|合成湖边步道|合成隐私占位文本|合成不应展示|登记全长|下一段/);
  assert.deepEqual(all(card).filter(n => n.type === 'button').map(text), [CLOSE]);
  assert.equal(p.button(OPEN).props['aria-expanded'], true);
  assert.equal(p.button(OPEN).props['aria-controls'], card.props.id);
  assert.equal(JSON.stringify([p.events, p.props]), before);
  assert.deepEqual(p.effects, { fetch: 0, speak: 0, wake: 0 });
});

test('opening focuses the card, explicit close and Escape return focus to its opener', async t => {
  const p = await mount(t);
  await p.click(OPEN);
  assert.equal(document.activeElement, p.find('navigation-show-step'));
  await p.click(CLOSE);
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(document.activeElement, p.button(OPEN));
  assert.equal(p.button(OPEN).props['aria-expanded'], false);
  await p.click(OPEN);
  const card = p.find('navigation-show-step');
  await card.parent.props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(document.activeElement, p.button(OPEN));
});

test('ordinary rest closes the old card and permits reopening at the frozen step without progress or route effects', async t => {
  const p = await mount(t);
  await p.click(OPEN); await p.click('累了，休息一下');
  assert.equal(p.find('navigation-show-step'), undefined);
  await p.click('看看前方能在哪歇');
  const before = JSON.stringify([p.events, p.props, text(p.find('navigation-paused')), text(p.find('paused-rest-preview'))]);
  await p.click(OPEN);
  assert.equal(text(p.find('navigation-show-step-text')), CURRENT);
  await p.click(CLOSE); await p.click(OPEN);
  assert.equal(JSON.stringify([p.events, p.props, text(p.find('navigation-paused')), text(p.find('paused-rest-preview'))]), before);
  assert.equal(p.button('已走完这段').props.disabled, true);
  assert.equal(p.button('慢一点，只听这一段').props.disabled, true);
  assert.deepEqual(p.effects, { fetch: 0, speak: 0, wake: 0 });
});

test('malformed incoming progress cannot obtain a card through the normalized fallback index', async t => {
  const p = await mount(t, { progress: { index: '1', paused: false } });
  const open = p.button(OPEN).props.onClick;
  for (const index of ['1', -1, 999, '0', null, NaN]) {
    p.props.progress = { index, paused: false }; await nextTick();
    assert.equal(p.button(OPEN).props.disabled, true, `${String(index)} (${typeof index})`);
    const reasonId = p.button(OPEN).props['aria-describedby'];
    assert.ok(reasonId && text(all(p.root).find(n => n.props.id === reasonId)).trim(), 'linked disabled reason');
    await open(); await nextTick();
    assert.equal(p.find('navigation-show-step'), undefined);
  }
});

test('conflicting raw parent progress clears the current card and cannot select a different step', async t => {
  const p = await mount(t); await p.click(OPEN);
  const open = p.button(OPEN).props.onClick;
  p.props.progress.index = 0; await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.button(OPEN).props.disabled, true);
  await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
});

test('live proof, unique registrations, exact safe names, complete route and ordinary context are all required', async t => {
  const p = await mount(t), open = p.button(OPEN).props.onClick;
  const row = p.props.selectedRoute.segments.find(s => s.segment_code === 'b');
  const official = p.props.mapFeatures.find(s => s.properties.segment_code === 'b').properties;
  const originalName = row.name, length = row.length_m;
  const cases = [
    ['unverified', () => { p.props.textMemoRouteVerified = false; }, () => { p.props.textMemoRouteVerified = true; }],
    ['duplicate registration', () => { p.props.mapFeatures.push({ properties: { ...official } }); }, () => { p.props.mapFeatures.pop(); }],
    ['missing registration', () => { official.kind = 'other'; }, () => { official.kind = 'segment'; }],
    ['name mismatch', () => { row.name = '合成另一条路'; }, () => { row.name = originalName; }],
    ['matching private prose', () => { row.name = official.name = '合成备注：联系家属 13800000000'; }, () => { row.name = official.name = originalName; }],
    ['coordinate context', () => { p.props.selectedRoute.start_context = { segment_code: 'b', longitude: 10 }; }, () => { delete p.props.selectedRoute.start_context; }],
    ['invalid whole-route length', () => { row.length_m = -1; }, () => { row.length_m = length; }],
  ];
  for (const [label, invalidate, restore] of cases) {
    invalidate(); await nextTick();
    assert.equal(p.button(OPEN).props.disabled, true, label);
    const reasonId = p.button(OPEN).props['aria-describedby'];
    assert.ok(reasonId && text(all(p.root).find(n => n.props.id === reasonId)).trim(), `${label} linked reason`);
    await open(); await nextTick();
    assert.equal(p.find('navigation-show-step'), undefined, label);
    restore(); await nextTick();
    assert.equal(p.button(OPEN).props.disabled, false, `${label} restored`);
  }
});

for (const [label, mutate] of [
  ['same-step parent progress replacement', p => { p.props.progress = { index: 1, paused: false }; }],
  ['parent pause mutation', p => { p.props.progress.paused = true; }],
  ['route replacement', p => { p.props.selectedRoute = route(); }],
  ['deep route metadata mutation', p => { p.props.selectedRoute.private_note = '合成更改占位文本'; }],
  ['profile replacement', p => { p.props.selectedProfile = { label: '合成陪同情况' }; }],
  ['map context replacement', p => { p.props.pilotArea = { center: [10, 10] }; }],
  ['deep registry mutation', p => { p.props.mapFeatures[0].properties.explanation = '合成更改说明'; }],
  ['proof loss', p => { p.props.textMemoRouteVerified = false; }],
  ['memo scope change', p => { p.props.memoScope++; }],
]) test(`the show card clears on ${label}`, async t => {
  const p = await mount(t); await p.click(OPEN);
  const opener = p.button(OPEN), focusCount = opener.focusCount;
  mutate(p); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.button(OPEN)?.props['aria-expanded'], false);
  assert.equal(opener.focusCount, focusCount, 'automatic clearing does not move focus');
});

test('detour and guidance pause clear the card and reject a captured opener', async t => {
  const p = await mount(t); await p.click(OPEN);
  const open = p.button(OPEN).props.onClick;
  p.props.detourActive = true; await nextTick();
  assert.equal(p.button(OPEN).props.disabled, true);
  await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  p.props.guidancePaused = true; await nextTick();
  await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.ok(p.button('返回路线页'));
});

test('obstruction confirmation blocks the card until cancelled without changing progress', async t => {
  const p = await mount(t, { obstructionState: { reason: '', options: [
    { kind: 'current', index: 1, manualIndex: 1, segment_code: 'b', name: '内部主路到楼栋组团B' },
  ] } });
  await p.click(OPEN); const open = p.button(OPEN).props.onClick;
  const before = JSON.stringify([p.events, p.props]);
  await p.click('前方走不了');
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.button(OPEN).props.disabled, true);
  await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  await p.click('取消，继续原行程'); await p.click(OPEN);
  assert.equal(text(p.find('navigation-show-step-text')), CURRENT);
  assert.equal(JSON.stringify([p.events, p.props]), before);
});

test('end confirmation, confirmed end and route exit retain their events and block captured card actions', async t => {
  const p = await mount(t); await p.click(OPEN);
  const open = p.button(OPEN).props.onClick;
  await p.click('结束导航'); await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.events.some(([name]) => name === 'EndNavigation'), false);
  await p.click('继续导航'); await p.click(OPEN);
  assert.equal(text(p.find('navigation-show-step-text')), CURRENT);
  await p.click('结束导航'); await p.click('结束但未确认到达');
  await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.events.filter(([name]) => name === 'EndNavigation').length, 1);
  await p.click('查看路线方案'); await open(); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.events.filter(([name]) => name === 'OpenRoutes').length, 1);
});

test('captured open, close and Escape handlers cannot remount a card or focus detached controls after unmount', async t => {
  const p = await mount(t); await p.click(OPEN);
  const opener = p.button(OPEN), open = opener.props.onClick;
  const close = p.button(CLOSE).props.onClick, escape = p.find('navigation-show-step').parent.props.onKeydown;
  p.visible.value = false; await nextTick();
  const before = JSON.stringify([p.events, p.effects]), focusCount = opener.focusCount;
  await open(); await close();
  await escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); await nextTick();
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(opener.focusCount, focusCount);
  assert.equal(JSON.stringify([p.events, p.effects]), before);
});

test('next and previous retain manual progress, clear the card and require parent acknowledgement before reopening', async t => {
  const p = await mount(t); await p.click(OPEN);
  await p.click('已走完这段');
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.events.findLast(([name]) => name === 'Progress')[1].index, 2);
  assert.equal(p.button(OPEN).props.disabled, true);
  p.props.progress = { index: 2, paused: false }; await nextTick(); await p.click(OPEN);
  assert.equal(text(p.find('navigation-show-step-text')), '第 3 段：合成湖边步道');
  await p.click('上一段');
  assert.equal(p.find('navigation-show-step'), undefined);
  assert.equal(p.events.findLast(([name]) => name === 'Progress')[1].index, 1);
  p.props.progress = { index: 1, paused: false }; await nextTick(); await p.click(OPEN);
  assert.equal(text(p.find('navigation-show-step-text')), CURRENT);
  assert.deepEqual(p.effects, { fetch: 0, speak: 0, wake: 0 });
});
