import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, reactive, nextTick } from 'vue';

const route = () => ({ distance_m: 150, segment_codes: ['a', 'b'], segments: [
  { segment_code: 'a', name: '合成林荫步道', length_m: 100 },
  { segment_code: 'b', name: '合成环湖步道', length_m: 50 },
] });
const node = (type, text = '') => ({ type, text, children: [], props: {},
  focus() {}, querySelector: () => null, querySelectorAll: () => [] });
const all = n => [n, ...n.children.flatMap(all)];
const text = n => n ? n.text + n.children.map(text).join('') : '';
let compiled;
async function component() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'navigation-memo-page-test', inlineTemplate: true }).content;
  code = code.replace(/import \{ watchCoordinates \} from '[^']+';/,
    'const watchCoordinates = () => { throw Error("unexpected GPS"); };')
    .replace(/import \{ createRouteMemoDownload, routeMemoDownloadSupported \} from '[^']+';/,
      'const routeMemoDownloadSupported = () => true; const createRouteMemoDownload = () => globalThis.__memoDownload;')
    .replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}='${name}';`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
      `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}
async function mount(t, extra = {}) {
  const originals = new Map(), effects = { downloads: [], fetch: 0, speak: 0, wake: 0 }, events = [];
  const set = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  set('__memoDownload', { download(value) { effects.downloads.push(value); return 'requested'; }, dispose() {} });
  set('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: () => null });
  set('navigator', { wakeLock: { request() { effects.wake++; throw Error('unexpected wake'); } } });
  set('speechSynthesis', { getVoices: () => [], cancel() {}, speak() { effects.speak++; } });
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected fetch'); });
  const props = reactive({ selectedRoute: route(), textMemoRouteVerified: true, memoScope: 0,
    mapFeatures: route().segments.map(row => ({ properties: { kind: 'segment', ...row } })), ...extra });
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
    async click(label) { const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true); b.props.onClick({ isTrusted: true }); await nextTick(); } };
}

test('read-only disclosure and selectable full-route text require separate download action and leave navigation untouched', async t => {
  const p = await mount(t), before = JSON.stringify([p.events, p.props]);
  assert.equal(p.find('navigation-memo-preview'), undefined);
  await p.click('保存文字路线');
  assert.equal(p.find('navigation-memo-text').props.tabindex, '0');
  assert.match(text(p.find('navigation-memo-text')), /1\. 合成林荫步道[\s\S]*2\. 合成环湖步道/);
  assert.equal(JSON.stringify([p.events, p.props]), before);
  assert.deepEqual(p.effects, { downloads: [], fetch: 0, speak: 0, wake: 0 });
  await p.click('下载文字路线（浏览器）');
  assert.equal(p.effects.downloads[0], text(p.find('navigation-memo-text')));
  assert.match(text(p.find('navigation-memo-preview')), /无法确认是否保存/);
  assert.equal(JSON.stringify([p.events, p.props]), before);
  await p.click('收起路线备忘');
  assert.equal(p.find('navigation-memo-preview'), undefined);
});

test('ordinary rest memo preserves frozen paused flow and its separate rest disclosure', async t => {
  const p = await mount(t);
  await p.click('累了，休息一下'); await p.click('看看前方能在哪歇');
  const before = JSON.stringify([p.events, text(p.find('navigation-paused')), text(p.find('paused-rest-preview'))]);
  await p.click('保存文字路线');
  assert.equal(JSON.stringify([p.events, text(p.find('navigation-paused')), text(p.find('paused-rest-preview'))]), before);
  assert.equal(p.button('已走完这段').props.disabled, true);
  assert.equal(p.button('慢一点，只听这一段').props.disabled, true);
  assert.deepEqual(p.effects, { downloads: [], fetch: 0, speak: 0, wake: 0 });
});

for (const [label, mutate] of [
  ['route replacement', p => { p.props.selectedRoute = route(); }],
  ['route mutation', p => { p.props.selectedRoute.segments[0].name = '合成另一条路'; }],
  ['registry mutation', p => { p.props.mapFeatures[0].properties.name = '合成另一条路'; }],
  ['scope', p => { p.props.memoScope++; }],
  ['provenance', p => { p.props.textMemoRouteVerified = false; }],
  ['obstruction pause', p => { p.props.guidancePaused = true; }],
  ['detour', p => { p.props.detourActive = true; }],
  ['profile', p => { p.props.selectedProfile = { label: '合成情况' }; }],
]) test(`memo clears on ${label} delivery and captured download cannot export old text`, async t => {
  const p = await mount(t); await p.click('保存文字路线');
  const download = p.button('下载文字路线（浏览器）').props.onClick;
  // Parent replacements reach child props on Vue's render tick; nested row
  // mutations are observed synchronously by the child's deep watch.
  mutate(p); await nextTick(); download({ isTrusted: true }); await nextTick();
  assert.equal(p.find('navigation-memo-preview'), undefined);
  assert.equal(p.effects.downloads.length, 0);
});

test('captured preview/download actions stay unavailable through end confirmation, confirmed end and unmount', async t => {
  const p = await mount(t); const open = p.button('保存文字路线').props.onClick;
  await p.click('保存文字路线'); const download = p.button('下载文字路线（浏览器）').props.onClick;
  await p.click('结束导航'); open(); download({ isTrusted: true }); await nextTick();
  assert.equal(p.find('navigation-memo-preview'), undefined);
  await p.click('结束但未确认到达'); open(); download({ isTrusted: true }); await nextTick();
  assert.equal(p.find('navigation-memo-preview'), undefined);
  p.visible.value = false; await nextTick(); open(); download({ isTrusted: true }); await nextTick();
  assert.equal(p.find('navigation-memo-preview'), undefined); assert.equal(p.effects.downloads.length, 0);
});
