import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, reactive, nextTick } from 'vue';

// In-memory renderer: no browser, project media, network or persisted fixture.
const route = () => ({ distance_m: 150, segment_codes: ['a', 'b'], segments: [
  { segment_code: 'b', name: '合成环湖步道', length_m: 50 },
  { segment_code: 'a', name: '合成林荫步道', length_m: 100 },
] });
const photo = id => ({ photo_id: id, caption: `合成说明 ${id}`, risk_tags: [],
  thumbnail_url: `/media/evidence/thumb/${id}.webp`, display_url: `/media/evidence/display/${id}.webp` });
const registry = () => route().segments.map(row => ({ properties: { kind: 'segment', ...row,
  evidence_photos: [photo(row.segment_code + '_one'), photo(row.segment_code + '_two')] } }));
const node = (type, text = '') => ({ type, text, children: [], props: {},
  focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const all = n => [n, ...n.children.flatMap(all)];
const text = n => n ? n.text + n.children.map(text).join('') : '';
let compiled;
async function component() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'navigation-photo-cue-page-test', inlineTemplate: true }).content;
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
  set('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: () => null });
  set('navigator', { wakeLock: { request() { effects.wake++; throw Error('unexpected wake'); } } });
  set('speechSynthesis', { getVoices: () => [], cancel() {}, speak() { effects.speak++; } });
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected fetch'); });
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0,
    apiBaseUrl: 'http://127.0.0.1:8000', mapFeatures: registry(), ...extra });
  const visible = reactive({ value: true }), root = node('root'), Page = await component();
  const handlers = Object.fromEntries(['Progress', 'SelectSegment', 'EndNavigation', 'OpenRoutes', 'SendSos', 'RetryMap', 'ConfirmObstruction']
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
    async click(label) { const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true); await b.props.onClick(); await nextTick(); } };
}

test('photo disclosure uses exact manual order, one image and independent current/next photo indices without side effects', async t => {
  const p = await mount(t), before = JSON.stringify([p.events, p.props]);
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  await p.click('看实景认路');
  assert.equal(p.button('看实景认路').props['aria-expanded'], true);
  assert.match(p.find('navigation-photo-cue-image').props.src, /\/display\/a_one\.webp$/);
  await p.click('下一张'); assert.match(p.find('navigation-photo-cue-image').props.src, /a_two\.webp$/);
  await p.click('下一段实景'); assert.match(p.find('navigation-photo-cue-image').props.src, /b_one\.webp$/);
  await p.click('当前段实景'); assert.match(p.find('navigation-photo-cue-image').props.src, /a_one\.webp$/);
  assert.equal(all(p.root).filter(n => n.type === 'img').length, 1);
  await p.click('关闭实景');
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  assert.equal(p.button('看实景认路').props['aria-expanded'], false);
  assert.equal(JSON.stringify([p.events, p.props]), before);
  assert.deepEqual(p.effects, { fetch: 0, speak: 0, wake: 0 });
});

for (const [label, mutate] of [
  ['same-step scope change', p => { p.props.memoScope++; }],
  ['same-step parent progress replacement', p => { p.props.progress = { index: 0, paused: false }; }],
  ['same-step route replacement', p => { p.props.selectedRoute = route(); }],
  ['same-step route mutation', p => { p.props.selectedRoute.segments[0].name = '合成另一条路'; }],
  ['same-step evidence mutation', p => { p.props.mapFeatures[0].properties.evidence_photos[0].caption = '合成更改说明'; }],
  ['same-step profile change', p => { p.props.selectedProfile = { label: '家属陪同' }; }],
  ['same-step map context', p => { p.props.pilotArea = { center: [10, 10] }; }],
  ['API base change', p => { p.props.apiBaseUrl = 'http://127.0.0.1:8001'; }],
  ['proof loss', p => { p.props.textMemoRouteVerified = false; }],
  ['obstruction pause', p => { p.props.guidancePaused = true; }],
  ['detour', p => { p.props.detourActive = true; }],
]) test(`photo disclosure and index clear on ${label}`, async t => {
  const p = await mount(t); await p.click('看实景认路'); await p.click('下一张');
  mutate(p); await nextTick();
  assert.equal(p.find('navigation-photo-cue'), undefined);
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  if (p.button('看实景认路')) assert.equal(p.button('看实景认路').props['aria-expanded'], false);
  if (p.button('看实景认路') && !p.button('看实景认路').props.disabled) {
    await p.click('看实景认路');
    assert.equal(p.find('navigation-photo-cue-image')?.props.alt, '合成说明 a_one');
  }
});

test('missing current evidence keeps its fallback and never borrows next evidence', async t => {
  const mapFeatures = registry(); delete mapFeatures[1].properties.evidence_photos;
  const p = await mount(t, { mapFeatures }); await p.click('看实景认路');
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  assert.match(text(p.find('navigation-photo-cue')), /暂无|未登记|未确认|不可用/);
  await p.click('下一段实景'); assert.match(p.find('navigation-photo-cue-image').props.src, /b_one\.webp$/);
  await p.click('当前段实景'); assert.equal(p.find('navigation-photo-cue-image'), undefined);
});

for (const index of [-1, 999, '0', null, NaN]) test(`normalized incoming progress ${String(index)} (${typeof index}) cannot select a photo`, async t => {
  const p = await mount(t, { progress: { index, paused: false } });
  assert.equal(p.button('看实景认路').props.disabled, true);
  await p.button('看实景认路').props.onClick(); await nextTick();
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  assert.match(text(p.root), /手动路线步骤未确认/);
});

test('externally conflicting manual progress clears photos without selecting another step', async t => {
  const p = await mount(t); await p.click('看实景认路');
  p.props.progress = { index: 1, paused: false }; await nextTick();
  assert.equal(p.find('navigation-photo-cue'), undefined);
  assert.equal(p.button('看实景认路').props.disabled, true);
});

test('captured photo actions cannot remount media through end confirmation, confirmed end or unmount', async t => {
  const p = await mount(t), open = p.button('看实景认路').props.onClick;
  await p.click('看实景认路'); const move = p.button('下一张').props.onClick;
  await p.click('结束导航'); await open(); move(); await nextTick();
  assert.equal(p.find('navigation-photo-cue'), undefined);
  await p.click('结束但未确认到达'); await open(); move(); await nextTick();
  assert.equal(p.find('navigation-photo-cue'), undefined);
  p.visible.value = false; await nextTick(); await open(); move(); await nextTick();
  assert.equal(p.find('navigation-photo-cue-image'), undefined);
  assert.deepEqual(p.effects, { fetch: 0, speak: 0, wake: 0 });
});
