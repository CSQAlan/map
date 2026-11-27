import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderer, h, reactive, nextTick } from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';

// Synthetic registered rows, map, speech, GPS and wake lock only.
const briefLabel = '慢一点，只听这一段';
const stopLabel = '停止这一段播报';
const route = () => ({ distance_m: 180, segment_codes: ['a', 'b', 'c'], segments: [
  { segment_code: 'a', name: '当前甲段', length_m: 100, step_count: 0, width_m: 2.5 },
  { segment_code: 'b', name: '预览乙段', length_m: 50, step_count: 0, width_m: 1.8 },
  { segment_code: 'c', name: '前方丙段', length_m: 30, step_count: 7, width_m: 1.3 },
] });
const features = ['a', 'b', 'c'].map((code, i) => ({ properties: { kind: 'segment', segment_code: code },
  geometry: { type: 'LineString', coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] } }));
const area = () => ({ limit_bounds: { south_west: [9.99, 9.99], north_east: [10.01, 10.01] } });
const node = (type, value = '') => ({ type, text: value, children: [], props: {},
  querySelector: () => null, querySelectorAll: () => [], focus() {} });
const text = n => n ? n.text + n.children.map(text).join('') : '';
const all = n => [n, ...n.children.flatMap(all)];
const clone = value => JSON.parse(JSON.stringify(value));
let compiled;
async function pageComponent() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'navigation-current-brief-test', inlineTemplate: true }).content;
  code = code.replace(/import \{ watchCoordinates \} from '[^']+';/,
    `const watchCoordinates = (sample, error) => { const gps = globalThis.__briefGPS; gps.sample = sample; gps.error = error; gps.watches++; return () => gps.cleared++; };`)
    .replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}='${name}';`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
      `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}

async function mount(t, { speechSupported = true, ...pageProps } = {}) {
  const originals = new Map();
  const setGlobal = (key, value) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  };
  let app, now = 100000;
  const gps = { watches: 0, cleared: 0 }, spoken = [], utterances = [], events = [];
  const effects = { fetch: 0, storage: [], wakeRequests: [], wakeReleases: 0, speechCancels: 0 };
  const localVoice = { lang: 'zh-CN', localService: true, name: 'Synthetic local Chinese' };
  const synthesis = { cancel() { effects.speechCancels++; }, getVoices: () => [localVoice],
    speak(utterance) { utterances.push(utterance); spoken.push(utterance.text); } };
  t.after(() => {
    app?.unmount();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  setGlobal('__briefGPS', gps);
  setGlobal('speechSynthesis', speechSupported ? synthesis : undefined);
  setGlobal('SpeechSynthesisUtterance', speechSupported ? class { constructor(value) { this.text = value; } } : undefined);
  setGlobal('document', { visibilityState: 'visible', addEventListener() {}, removeEventListener() {}, getElementById: () => null });
  setGlobal('navigator', { wakeLock: { async request(kind) {
    effects.wakeRequests.push(kind);
    return { released: false, addEventListener() {}, async release() { this.released = true; effects.wakeReleases++; } };
  } } });
  for (const key of ['localStorage', 'sessionStorage']) setGlobal(key, Object.fromEntries(
    ['getItem', 'setItem', 'removeItem', 'clear'].map(method => [method, (...args) => {
      effects.storage.push([key, method, ...args]); return null;
    }])));
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', () => 1);
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected network'); });
  const Page = await pageComponent();
  const props = reactive({ selectedRoute: route(), mapFeatures: features, pilotArea: area(),
    selectedProfile: { label: '合成出行情况' }, ...pageProps });
  const visible = reactive({ value: true });
  const handlers = Object.fromEntries(['Progress', 'SelectSegment', 'OpenRoutes', 'EndNavigation', 'RetryMap',
    'MapError', 'SendSos', 'PauseDetour', 'ConfirmObstruction'].map(name =>
    [`on${name}`, value => events.push({ name, value })]));
  const renderer = createRenderer({ createElement: tag => node(tag), createText: value => node('#text', value),
    createComment: () => node('#comment'), setText(n, value) { n.text = value; },
    setElementText(n, value) { n.text = value; n.children = []; }, patchProp(n, key, old, value) { n.props[key] = value; },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent;
      const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
    }, remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
  const root = node('root');
  app = renderer.createApp({ render: () => visible.value ? h(Page, { ...props, ...handlers }) : null });
  app.mount(root);
  const button = label => all(root).find(n => n.type === 'button' && text(n) === label);
  const find = id => all(root).find(n => n.props['data-testid'] === id);
  const map = () => all(root).find(n => n.type === 'AmapRouteMap' || n.type === 'FallbackRouteMap');
  return { root, props, gps, effects, synthesis, localVoice, spoken, utterances, events, button, find, map,
    brief: () => text(find('navigation-current-brief-text')),
    async click(label) {
      const control = button(label); assert.ok(control, label); assert.notEqual(control.props.disabled, true, label);
      control.props.onClick(); await nextTick();
    },
    async fix() {
      gps.sample({ longitude: 10.0005, latitude: 10, accuracy: 10, timestamp: ++now }); await nextTick();
    },
    async leaveParent() { visible.value = false; await nextTick(); },
  };
}

function manualSnapshot(page) {
  const map = page.map();
  return clone({ events: page.events, gps: { watches: page.gps.watches, cleared: page.gps.cleared },
    map: map ? { camera: map.props['camera-request'], current: map.props['current-segment-code'],
      selected: map.props['selected-segment-code'], index: map.props['manual-index'],
      following: map.props.following, position: map.props.position } : null,
    counter: text(all(page.root).find(n => n.props.class === 'journey-counter')),
    remaining: text(page.find('manual-remaining')),
    location: all(page.root).filter(n => String(n.props.class).split(' ').includes('journey-location')).map(text),
    wake: text(page.find('navigation-wake-lock')), requests: page.effects.wakeRequests,
    releases: page.effects.wakeReleases, fetch: page.effects.fetch, storage: page.effects.storage });
}

test('current brief is a native action inside the current card, plays once slowly and changes no navigation consent or state', async t => {
  const page = await mount(t);
  const action = page.button(briefLabel);
  const current = all(page.root).find(n => n.props.class === 'journey-current');
  assert.ok(all(current).includes(action));
  assert.equal(action.props.type, 'button');
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.spoken.length, 0);
  const before = manualSnapshot(page);
  await page.click(briefLabel);
  assert.equal(page.spoken.length, 1);
  assert.equal(page.spoken[0], page.brief());
  assert.match(page.brief(), /当前甲段/);
  assert.doesNotMatch(page.brief(), /预览乙段|前方丙段/);
  assert.equal(page.utterances[0].rate, .70);
  assert.equal(page.utterances[0].voice, page.localVoice);
  assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
  assert.deepEqual(manualSnapshot(page), before);
  page.utterances[0].onend(); await nextTick();
  assert.equal(page.button(stopLabel), undefined);
  assert.equal(page.brief(), page.spoken[0]);
  await page.click('已走完这段');
  assert.equal(page.spoken.length, 1, 'one-shot brief never opts into automatic speech');
  assert.equal(page.find('navigation-current-brief'), undefined);
});

test('brief leaves an already active location follow and screen wake lock unchanged', async t => {
  const page = await mount(t);
  await page.click('开启我的位置'); await page.fix();
  await page.click('导航时保持屏幕亮'); await nextTick();
  assert.equal(page.map().props.following, true);
  assert.deepEqual(page.effects.wakeRequests, ['screen']);
  const before = manualSnapshot(page);
  await page.click(briefLabel);
  assert.deepEqual(manualSnapshot(page), before);
  assert.equal(page.spoken.length, 1);
});

test('preview and map inspection never substitute their row for the manual current brief', async t => {
  const page = await mount(t);
  await page.click('预览下一段');
  assert.equal(page.map().props['selected-segment-code'], 'b');
  let before = manualSnapshot(page);
  await page.click(briefLabel);
  assert.match(page.brief(), /当前甲段/);
  assert.doesNotMatch(page.brief(), /预览乙段|前方丙段/);
  assert.deepEqual(manualSnapshot(page), before);
  await page.click('查看台阶所在登记路段');
  assert.equal(page.map().props['selected-segment-code'], 'c');
  before = manualSnapshot(page);
  await page.click(briefLabel);
  assert.equal(page.map().props['manual-index'], 0);
  assert.match(page.brief(), /当前甲段/);
  assert.doesNotMatch(page.brief(), /预览乙段|前方丙段/);
  assert.deepEqual(manualSnapshot(page), before);
});

test('unavailable local Chinese voices preserve identical readable brief and give a local reason', async t => {
  const page = await mount(t);
  await page.click(briefLabel); const readable = page.brief();
  await page.click(stopLabel);
  for (const voices of [[], [{ lang: 'zh-CN', localService: false }],
    [{ lang: 'zh-CN' }], [{ lang: 'en-US', localService: true }]]) {
    page.synthesis.getVoices = () => voices;
    const before = manualSnapshot(page);
    await page.click(briefLabel);
    assert.equal(page.spoken.length, 1);
    assert.equal(page.brief(), readable);
    assert.match(text(page.find('navigation-current-brief')), /本地中文语音.*不可用/);
    assert.equal(page.button(stopLabel), undefined);
    assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
    assert.deepEqual(manualSnapshot(page), before);
  }
});

test('unsupported speech leaves current text readable with a usable reason', async t => {
  const page = await mount(t, { speechSupported: false });
  await page.click(briefLabel);
  assert.match(page.brief(), /当前甲段/);
  assert.match(text(page.find('navigation-current-brief')), /不支持语音播报/);
  assert.equal(page.spoken.length, 0);
  assert.equal(page.button(stopLabel), undefined);
  assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
});

test('a uniquely registered current row without a name remains available with the unknown-name fallback', async t => {
  const registered = route(); registered.segments[0].name = '  ';
  const page = await mount(t, { selectedRoute: registered });
  await page.click(briefLabel);
  assert.match(page.brief(), /路段名称未记录/);
  assert.equal(page.spoken[0], page.brief());
  assert.doesNotMatch(page.brief(), /预览乙段|前方丙段/);
});

test('brief chooses the local Chinese voice from mixed voices and keeps ordinary and ahead rates unchanged', async t => {
  const page = await mount(t);
  page.synthesis.getVoices = () => [{ lang: 'zh-CN', localService: false },
    { lang: 'en-US', localService: true }, page.localVoice];
  await page.click('开启语音提示');
  const ordinary = page.spoken[0];
  assert.equal(page.utterances[0].rate, .85);
  await page.click(briefLabel);
  assert.equal(page.utterances[1].rate, .70);
  assert.equal(page.utterances[1].voice, page.localVoice);
  assert.equal(page.button('关闭语音').props['aria-pressed'], true);
  await page.click('重新播报');
  assert.equal(page.spoken[2], ordinary);
  assert.equal(page.utterances[2].rate, .85);
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(stopLabel), undefined);
  await page.click(briefLabel); await page.click('听前方情况');
  assert.equal(page.utterances.at(-1).rate, .85);
  assert.match(page.spoken.at(-1), /前方丙段.*7 级台阶/);
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button('关闭语音').props['aria-pressed'], true);
  await page.click('已走完这段');
  assert.equal(page.utterances.at(-1).rate, .85);
  assert.match(page.spoken.at(-1), /预览乙段/);
});

test('accessible brief stop cancels only playback, retains readable text and ignores late callbacks', async t => {
  const page = await mount(t);
  await page.click(briefLabel);
  const brief = page.utterances[0], readable = page.brief(), stop = page.button(stopLabel);
  assert.equal(stop.props.type, 'button');
  assert.notEqual(stop.props.disabled, true);
  assert.notEqual(stop.props.tabindex, -1);
  assert.notEqual(stop.props['aria-hidden'], true);
  const before = manualSnapshot(page), cancels = page.effects.speechCancels;
  await page.click(stopLabel);
  assert.ok(page.effects.speechCancels > cancels);
  assert.equal(page.button(stopLabel), undefined);
  assert.equal(page.brief(), readable);
  assert.deepEqual(manualSnapshot(page), before);
  brief.onend(); brief.onerror(); await nextTick();
  assert.equal(page.brief(), readable);
  assert.equal(page.button(stopLabel), undefined);
  assert.doesNotMatch(text(page.root), /播报未完成/);
});

test('late callbacks from a replaced brief cannot stop or mark the newer brief as failed', async t => {
  const page = await mount(t);
  await page.click(briefLabel); const first = page.utterances[0];
  await page.click(briefLabel);
  assert.equal(page.spoken.length, 2);
  assert.equal(all(page.root).filter(n => n.type === 'button' && text(n) === stopLabel).length, 1);
  first.onend(); first.onerror(); await nextTick();
  assert.ok(page.button(stopLabel));
  assert.equal(page.brief(), page.spoken[1]);
  assert.doesNotMatch(text(page.root), /播报未完成/);
  page.utterances[1].onend(); await nextTick();
  assert.equal(page.button(stopLabel), undefined);
});

test('stale brief callbacks cannot revive cleared text or disturb a newer ordinary announcement', async t => {
  const page = await mount(t);
  await page.click(briefLabel); const old = page.utterances[0];
  await page.click('开启语音提示');
  assert.equal(page.utterances[1].rate, .85);
  assert.equal(page.find('navigation-current-brief'), undefined);
  old.onend(); old.onerror(); await nextTick();
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(stopLabel), undefined);
  assert.ok(page.button('重新播报'), 'ordinary announcement remains playing');
  assert.equal(page.button('关闭语音').props['aria-pressed'], true);
  assert.doesNotMatch(text(page.root), /播报未完成/);
});

for (const [label, enter, blocked = false] of [
  ['manual progress', page => page.click('已走完这段')],
  ['route replacement', async page => { page.props.selectedRoute = route(); await nextTick(); }],
  ['registered route edits', async page => { page.props.selectedRoute.segments[0].width_m = 2.2; await nextTick(); }],
  ['profile change', async page => { page.props.selectedProfile.label = '另一合成出行情况'; await nextTick(); }],
  ['pilot area change', async page => { page.props.pilotArea.limit_bounds.north_east = [10.02, 10.02]; await nextTick(); }],
  ['detour transition', async page => { page.props.detourActive = true; await nextTick(); }],
  ['guidance suspension', async page => { page.props.guidancePaused = true; await nextTick(); }, true],
  ['end dialog', page => page.click('结束导航'), true],
  ['return to routes', page => page.click('查看路线方案'), true],
  ['parent role unmount', page => page.leaveParent(), true],
]) test(`${label} clears brief and ignores its stale completion and error`, async t => {
  const page = await mount(t);
  await page.click(briefLabel);
  const hear = page.button(briefLabel).props.onClick;
  const old = page.utterances[0], cancels = page.effects.speechCancels;
  await enter(page);
  assert.ok(page.effects.speechCancels > cancels);
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(stopLabel), undefined);
  if (blocked) hear();
  old.onend(); old.onerror(); await nextTick();
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(stopLabel), undefined);
  assert.equal(page.spoken.length, 1);
  assert.doesNotMatch(text(page.root), /播报未完成/);
});

test('confirmed finish blocks a captured brief action after the exit dialog closes', async t => {
  const page = await mount(t);
  await page.click(briefLabel);
  const hear = page.button(briefLabel).props.onClick, old = page.utterances[0];
  await page.click('结束导航'); await page.click('结束但未确认到达');
  hear(); old.onend(); old.onerror(); await nextTick();
  assert.ok(page.events.some(event => event.name === 'EndNavigation'));
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(stopLabel), undefined);
  assert.equal(page.spoken.length, 1);
});

for (const automatic of [false, true]) test(`pause clears brief and resume ${automatic ? 'resumes ordinary automatic speech' : 'does not replay the one-shot brief'}`, async t => {
  const page = await mount(t);
  if (automatic) await page.click('开启语音提示');
  await page.click(briefLabel); const old = page.utterances.at(-1);
  const staleAction = page.button(briefLabel).props.onClick;
  await page.click('累了，休息一下');
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.button(briefLabel).props.disabled, true);
  const pausedCount = page.spoken.length;
  staleAction(); old.onend(); old.onerror(); await nextTick();
  assert.equal(page.spoken.length, pausedCount);
  assert.equal(page.find('navigation-current-brief'), undefined);
  await page.click('继续前行');
  assert.equal(page.find('navigation-current-brief'), undefined);
  assert.equal(page.spoken.length, pausedCount + Number(automatic));
  if (automatic) {
    assert.equal(page.utterances.at(-1).rate, .85);
    assert.notEqual(page.spoken.at(-1), old.text);
    assert.equal(page.button('关闭语音').props['aria-pressed'], true);
  } else assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
});

test('missing, duplicate and malformed manual current rows reject brief at both button and stale handler', async t => {
  const page = await mount(t);
  const hear = page.button(briefLabel).props.onClick;
  const duplicateCodes = route(); duplicateCodes.segment_codes[1] = 'a';
  const duplicateRows = route(); duplicateRows.segments.push({ ...duplicateRows.segments[0] });
  const missing = route(); missing.segments.shift();
  const malformed = route(); const arrayRow = []; arrayRow.segment_code = 'a'; malformed.segments[0] = arrayRow;
  for (const invalid of [null, {}, { segment_codes: [], segments: [] }, missing, duplicateCodes, duplicateRows, malformed]) {
    page.props.selectedRoute = invalid; await nextTick();
    const button = page.button(briefLabel);
    assert.ok(!button || button.props.disabled === true);
    const before = manualSnapshot(page);
    hear(); await nextTick();
    assert.equal(page.spoken.length, 0);
    assert.equal(page.find('navigation-current-brief'), undefined);
    assert.deepEqual(manualSnapshot(page), before);
  }
});
