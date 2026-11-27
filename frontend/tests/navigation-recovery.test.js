import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderer, h, reactive, nextTick } from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';

// Component-level state checks: synthetic GPS, clock, speech and map adapter only.
const route = () => ({ distance_m: 200, segment_codes: ['a', 'b'], segments: [
  { segment_code: 'a', name: '合成甲段', length_m: 100 },
  { segment_code: 'b', name: '合成乙段', length_m: 100 },
] });
const features = ['a', 'b'].map((code, i) => ({ properties: { kind: 'segment', segment_code: code },
  geometry: { type: 'LineString', coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] } }));
const area = { limit_bounds: { south_west: [9.99, 9.99], north_east: [10.01, 10.01] } };
const node = (type, text = '') => {
  const element = { type, text, children: [], props: {}, focusCount: 0, addEventListener() {}, removeEventListener() {} };
  element.focus = () => { element.focusCount++; globalThis.document.activeElement = element; };
  element.querySelectorAll = selector => all(element).slice(1).filter(child => selector === 'button'
    ? child.type === 'button' : selector.startsWith('#') && child.props.id === selector.slice(1));
  element.querySelector = selector => element.querySelectorAll(selector)[0] || null;
  return element;
};
const text = n => n ? n.text + n.children.map(text).join('') : '';
const all = n => [n, ...n.children.flatMap(all)];
let compiled;
async function pageComponent() {
  if (compiled) return compiled;
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor, { id: 'nav-recovery', inlineTemplate: true }).content;
  code = code.replace(/import \{ watchCoordinates \} from '[^']+';/,
    `const watchCoordinates = (sample, error) => { const gps=globalThis.__navigationGPS; gps.sample=sample; gps.error=error; gps.watches++; return () => gps.cleared++; };`)
    .replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}='${name}';`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}
async function mount(t, options = {}) {
  const { speechSupported = true, ...pageOptions } = options;
  let now = 100000, tick;
  const gps = { watches: 0, cleared: 0 }, spoken = [], utterances = [], events = [], speech = { cancellations: 0 };
  const root = node('root'), originalDocument = globalThis.document;
  const document = { activeElement: null, visibilityState: 'visible', addEventListener() {}, removeEventListener() {},
    getElementById: id => all(root).find(n => n.props.id === id) };
  globalThis.document = document;
  globalThis.__navigationGPS = gps;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected network'); });
  const originalSpeech = globalThis.speechSynthesis, originalUtterance = globalThis.SpeechSynthesisUtterance;
  globalThis.speechSynthesis = speechSupported ? { cancel() { speech.cancellations++; }, getVoices: () => [{ lang: 'zh-CN', localService: true }], speak: u => { spoken.push(u.text); utterances.push(u); } } : undefined;
  globalThis.SpeechSynthesisUtterance = speechSupported ? class { constructor(value) { this.text = value; } } : undefined;
  const Page = await pageComponent();
  const props = reactive({ selectedRoute: route(), mapFeatures: features, pilotArea: area, ...pageOptions });
  const renderer = createRenderer({ createElement: tag => node(tag), createText: value => node('#text', value), createComment: () => node('#comment'),
    setText(n, value) { n.text = value; }, setElementText(n, value) { n.text = value; n.children = []; },
    patchProp(n, key, old, value) { n.props[key] = value; },
    insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = parent;
      const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, n); },
    remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
  const app = renderer.createApp({ render: () => h(Page, { ...props, onProgress: value => events.push({ progress: value }),
    onSelectSegment: code => events.push({ select: code }), onOpenRoutes: () => events.push({ routes: true }),
    onEndNavigation: value => events.push({ end: value }),
    onPauseDetour: reason => { events.push({ pause: reason }); props.guidancePaused = true; } }) });
  app.mount(root);
  let mounted = true;
  const unmount = () => { if (mounted) { app.unmount(); mounted = false; } };
  t.after(() => { unmount(); globalThis.document = originalDocument; globalThis.speechSynthesis = originalSpeech; globalThis.SpeechSynthesisUtterance = originalUtterance; delete globalThis.__navigationGPS; });
  const button = label => all(root).find(n => n.type === 'button' && text(n).includes(label));
  return { root, props, gps, events, spoken, utterances, speech, document, button, unmount, find: id => all(root).find(n => n.props['data-testid'] === id),
    map: () => all(root).find(n => n.type === 'AmapRouteMap'),
    async click(label) { const b = button(label); assert.ok(b, label); assert.notEqual(b.props.disabled, true, label); b.props.onClick({ currentTarget: b, target: b }); await nextTick(); },
    async fix(change = {}) { now++; gps.sample({ longitude: 10.0005, latitude: 10, accuracy: 10, timestamp: now, ...change }); await nextTick(); },
    async age() { now += 16000; tick(); await nextTick(); } };
}

test('rest is reachable at top, retains exact manual leg, locks handlers and hides legacy rest hint', async t => {
  const page = await mount(t, { progress: { index: 1, paused: false } });
  assert.ok(all(page.root).indexOf(page.button('休息一下')) < all(page.root).indexOf(page.map()));
  assert.equal(page.gps.watches, 0); assert.equal(page.spoken.length, 0);
  await page.click('开启语音提示');
  await page.click('休息一下');
  const panel = page.find('navigation-paused');
  assert.match(text(panel), /第 2 段，共 2 段：合成乙段/);
  assert.match(text(panel), /不表示已到登记休息点/);
  assert.equal(page.find('navigation-rest'), undefined);
  assert.equal(page.button('上一段').props.disabled, true);
  page.button('上一段').props.onClick();
  page.button('重播本段').props.onClick();
  page.button('关闭语音').props.onClick();
  await nextTick();
  assert.equal(page.spoken.length, 1);
  assert.equal(page.events.at(-1).progress.index, 1);
  assert.equal(page.events.at(-1).progress.paused, true);
  await page.click('文字导航'); assert.equal(page.map(), undefined);
  await page.click('地图导航'); assert.ok(page.map());
  await page.click('查看全程');
  await page.click('继续前行');
  assert.equal(page.events.at(-1).progress.index, 1);
  assert.equal(page.spoken.length, 2);
  assert.equal(page.map().props.following, false);
  assert.equal(page.gps.watches, 0);
  await page.click('休息一下'); await page.click('查看路线方案');
  assert.equal(page.events.at(-1).routes, true);
});

test('rest stops follow and off-route speech; resume requires a fresh fix and preserves explicit browsing', async t => {
  const page = await mount(t);
  await page.click('开启我的位置'); await page.fix();
  await page.click('开启语音提示');
  assert.equal(page.map().props.following, true);
  await page.click('休息一下');
  for (let i = 0; i < 3; i++) await page.fix({ latitude: 10.005 });
  assert.equal(page.map().props.following, false);
  assert.equal(page.spoken.length, 1);
  assert.match(text(page.find('map-follow-state')), /休息.*暂停位置跟随/);
  await page.fix({ accuracy: 80 }); await page.click('继续前行');
  assert.equal(page.map().props.following, false);
  await page.fix(); assert.equal(page.map().props.following, true);
  await page.click('休息一下'); await page.age(); await page.click('继续前行');
  assert.equal(page.map().props.following, false);
  await page.fix(); assert.equal(page.map().props.following, true);
  await page.click('休息一下'); await page.fix(); await page.click('继续前行');
  assert.equal(page.map().props.following, true);
  await page.click('休息一下'); await page.click('查看当前路段'); await page.fix(); await page.click('继续前行');
  assert.equal(page.map().props.following, false);
  await page.click('回到我'); assert.equal(page.map().props.following, true);
  await page.click('查看全程'); await page.click('休息一下'); await page.fix(); await page.click('继续前行');
  assert.equal(page.map().props.following, false);
  assert.equal(page.gps.watches, 1);
});

test('detour suspension supersedes rest even with an old resume callback and late good GPS', async t => {
  const page = await mount(t, { detourActive: true, progress: { index: 1, paused: false } });
  await page.click('开启我的位置'); await page.fix(); await page.click('开启语音提示');
  await page.click('休息一下'); const resume = page.button('继续前行').props.onClick;
  await page.fix({ accuracy: 80 });
  assert.match(text(page.root), /绕行引导已暂停/);
  const before = page.events.length;
  resume(); await page.fix();
  assert.equal(page.events.length, before);
  assert.equal(page.find('navigation-paused'), undefined); assert.equal(page.map(), undefined);
  assert.equal(page.spoken.length, 1); assert.equal(page.gps.cleared, 1);
});

const recoverySnapshot = page => ({
  progress: page.events.filter(e => e.progress), speech: [...page.spoken], watches: page.gps.watches,
  location: text(all(page.root).filter(n => String(n.props.class).split(' ').includes('journey-location')).at(-1)),
  leg: text(all(page.root).find(n => n.props.class === 'journey-counter')),
});

const ordinaryOptions = () => ({ selectedRoute: route(), progress: { index: 0, paused: false }, textMemoRouteVerified: true,
  mapFeatures: features.map((feature, index) => ({ ...feature, properties: { ...feature.properties, name: route().segments[index].name } })) });
const manualRecoveryTrigger = page => page.find('navigation-manual-recovery-trigger');
const manualRecoverySnapshot = page => ({ ...recoverySnapshot(page), events: [...page.events], cleared: page.gps.cleared,
  cancellations: page.speech.cancellations, camera: page.map()?.props['camera-request'], following: page.map()?.props.following,
  selected: page.map()?.props['selected-segment-code'], network: globalThis.fetch.mock.calls.length,
  route: JSON.stringify(page.props.selectedRoute), progressInput: JSON.stringify(page.props.progress) });

test('manual recovery opens without location consent, focuses one accessible card, and closes without navigation effects', async t => {
  const page = await mount(t, ordinaryOptions());
  const trigger = manualRecoveryTrigger(page);
  assert.ok(trigger, 'ordinary confirmed route exposes manual recovery');
  assert.equal(text(trigger), '我不确定走到哪');
  assert.notEqual(trigger.props.disabled, true);
  assert.equal(trigger.props['aria-expanded'], false);
  assert.equal(trigger.props['aria-controls'], 'navigation-recovery');
  assert.equal(page.find('navigation-recovery'), undefined);
  const before = manualRecoverySnapshot(page);
  trigger.focus();
  await page.click('我不确定走到哪');
  const card = page.find('navigation-recovery');
  assert.ok(card);
  assert.equal(card.props.id, 'navigation-recovery');
  assert.equal(Number(card.props.tabindex), -1);
  assert.equal(page.document.activeElement, card);
  assert.equal(trigger.props['aria-expanded'], true);
  assert.match(text(card), /手动进度仍在第 1 段：合成甲段/);
  assert.match(text(card), /不能确定您实际站在哪里/);
  assert.deepEqual(manualRecoverySnapshot(page), before);
  const close = page.find('navigation-manual-recovery-close');
  assert.ok(close); assert.equal(text(close), '关闭核对');
  await page.click('关闭核对');
  assert.equal(page.find('navigation-recovery'), undefined);
  assert.equal(page.document.activeElement, trigger);
  assert.equal(trigger.props['aria-expanded'], false);
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('我不确定走到哪');
  const reopened = page.find('navigation-recovery');
  const event = { key: 'Escape', prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  reopened.props.onKeydown(event); await nextTick();
  assert.equal(event.prevented, true); assert.equal(event.stopped, true);
  assert.equal(page.find('navigation-recovery'), undefined);
  assert.equal(page.document.activeElement, trigger);
  assert.deepEqual(manualRecoverySnapshot(page), before);
});

for (const location of ['waiting', 'healthy']) test(`manual recovery remains available with ${location} location and preserves follow and speech on open/close`, async t => {
  const page = await mount(t, ordinaryOptions());
  await page.click('开启我的位置');
  if (location === 'healthy') await page.fix();
  await page.click('开启语音提示');
  assert.equal(page.map().props.following, location === 'healthy');
  assert.equal(page.find('navigation-recovery'), undefined);
  const before = manualRecoverySnapshot(page);
  await page.click('我不确定走到哪');
  assert.ok(page.find('navigation-recovery'));
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('关闭核对');
  assert.equal(page.find('navigation-recovery'), undefined);
  assert.deepEqual(manualRecoverySnapshot(page), before);
});

test('manual map recovery centers the confirmed leg without changing another inspected selection or emitting navigation events', async t => {
  const page = await mount(t, { ...ordinaryOptions(), progress: { index: 1, paused: false } });
  await page.click('开启我的位置'); await page.fix({ longitude: 10.0015 }); await page.click('开启语音提示');
  page.map().props.onSelectSegment('a'); await nextTick();
  assert.equal(page.map().props['selected-segment-code'], 'a');
  await page.click('我不确定走到哪');
  const before = recoverySnapshot(page), events = [...page.events], cancellations = page.speech.cancellations;
  await page.click('查看本段登记地图');
  assert.equal(page.map().props['camera-request'].kind, 'current');
  assert.equal(page.map().props['camera-request'].code, 'b');
  assert.equal(page.map().props['manual-index'], 1);
  assert.equal(page.map().props['selected-segment-code'], 'a');
  assert.equal(page.map().props.following, false);
  assert.deepEqual(page.events, events);
  assert.deepEqual(recoverySnapshot(page), before);
  assert.equal(page.speech.cancellations, cancellations);
  await page.click('按本段文字继续');
  assert.equal(page.map(), undefined);
  assert.deepEqual(page.events, events);
  assert.deepEqual(recoverySnapshot(page), before);
  assert.equal(page.speech.cancellations, cancellations);
  await page.click('查看本段登记地图');
  assert.equal(page.map().props['camera-request'].code, 'b');
  assert.equal(page.map().props.following, false);
  assert.deepEqual(page.events, events);
  assert.equal(page.gps.watches, 1); assert.equal(page.gps.cleared, 0);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('manual text recovery stops healthy follow while preserving manual progress, GPS state and speech', async t => {
  const page = await mount(t, ordinaryOptions());
  await page.click('开启我的位置'); await page.fix(); await page.click('开启语音提示');
  assert.equal(page.map().props.following, true);
  await page.click('我不确定走到哪');
  const before = recoverySnapshot(page), events = [...page.events], cancellations = page.speech.cancellations;
  await page.click('按本段文字继续');
  assert.equal(page.map(), undefined);
  assert.deepEqual(page.events, events); assert.deepEqual(recoverySnapshot(page), before);
  assert.equal(page.speech.cancellations, cancellations);
  await page.click('地图导航');
  assert.equal(page.map().props.following, false);
  assert.equal(page.gps.watches, 1); assert.equal(page.gps.cleared, 0);
});

test('manual and automatic recovery share one card; closing manual disclosure preserves the location issue', async t => {
  const page = await mount(t, ordinaryOptions());
  await page.click('开启我的位置'); await page.fix({ accuracy: 80 });
  const autoCard = page.find('navigation-recovery');
  assert.ok(autoCard); assert.equal(page.find('navigation-manual-recovery-close'), undefined);
  assert.match(text(autoCard), /精度较低/);
  assert.equal(manualRecoveryTrigger(page).props['aria-expanded'], false);
  const before = manualRecoverySnapshot(page);
  await page.click('我不确定走到哪');
  assert.equal(all(page.root).filter(n => n.props['data-testid'] === 'navigation-recovery').length, 1);
  assert.equal(page.find('navigation-recovery'), autoCard);
  assert.equal(page.document.activeElement, autoCard);
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('关闭核对');
  assert.equal(page.find('navigation-recovery'), autoCard);
  assert.match(text(autoCard), /精度较低/);
  assert.equal(page.find('navigation-manual-recovery-close'), undefined);
  assert.equal(page.document.activeElement, manualRecoveryTrigger(page));
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('我不确定走到哪');
  await page.fix();
  assert.ok(page.find('navigation-recovery'), 'healthy GPS clears the automatic reason, not explicit disclosure');
  assert.doesNotMatch(text(page.find('navigation-recovery')), /定位精度较低/);
  await page.click('关闭核对');
  assert.equal(page.find('navigation-recovery'), undefined);
});

test('manual recovery keeps readable text when the uniquely registered current geometry is invalid', async t => {
  const options = ordinaryOptions();
  options.mapFeatures[0] = { ...options.mapFeatures[0], geometry: { type: 'Point', coordinates: [10, 10] } };
  const page = await mount(t, options);
  await page.click('我不确定走到哪');
  assert.equal(page.button('查看本段登记地图').props.disabled, true);
  const before = manualRecoverySnapshot(page);
  page.button('查看本段登记地图').props.onClick(); await nextTick();
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('按本段文字继续');
  assert.equal(page.map(), undefined);
  assert.equal(page.gps.watches, 0); assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('manual recovery requires confirmed manual progress and the verified named ordinary-route evidence', async t => {
  const cases = [
    ['unverified route', options => { options.textMemoRouteVerified = false; }],
    ['missing route', options => { options.selectedRoute = null; }],
    ['location-start route', options => { options.selectedRoute.start_context = { kind: 'position' }; }],
    ['missing manual index', options => { options.progress = {}; }],
    ['fractional manual index', options => { options.progress.index = 0.5; }],
    ['negative manual index', options => { options.progress.index = -1; }],
    ['out-of-range manual index', options => { options.progress.index = 2; }],
    ['missing registered name', options => { delete options.mapFeatures[0].properties.name; }],
    ['mismatching registered name', options => { options.mapFeatures[0].properties.name = '另一登记道路'; }],
    ['ambiguous registration', options => { options.mapFeatures.push(options.mapFeatures[0]); }],
    ['ordinary rest', options => { options.progress.paused = true; }],
    ['active detour', options => { options.detourActive = true; }],
    ['suspended guidance', options => { options.guidancePaused = true; }],
  ];
  for (const [label, change] of cases) await t.test(label, async sub => {
    const options = ordinaryOptions(); change(options);
    const page = await mount(sub, options), trigger = manualRecoveryTrigger(page);
    assert.ok(!trigger || trigger.props.disabled === true, label);
    assert.equal(page.find('navigation-recovery'), undefined);
    const before = manualRecoverySnapshot(page);
    trigger?.props.onClick({ currentTarget: trigger }); await nextTick();
    assert.equal(page.find('navigation-recovery'), undefined);
    assert.deepEqual(manualRecoverySnapshot(page), before);
  });
});

test('closed manual recovery actions cannot change map mode, camera, follow, progress or device services', async t => {
  const page = await mount(t, ordinaryOptions());
  await page.click('开启我的位置'); await page.fix();
  await page.click('我不确定走到哪');
  const map = page.button('查看本段登记地图').props.onClick, textAction = page.button('按本段文字继续').props.onClick;
  await page.click('关闭核对');
  const before = manualRecoverySnapshot(page);
  map(); textAction(); await nextTick();
  assert.deepEqual(manualRecoverySnapshot(page), before);
  assert.ok(page.map()); assert.equal(page.find('navigation-recovery'), undefined);
});

for (const [label, change] of [
  ['manual step', async page => { await page.click('已走完这段'); page.props.progress = { index: 1, paused: false }; }],
  ['route replacement', page => { page.props.selectedRoute = route(); }],
  ['profile replacement', page => { page.props.selectedProfile = { code: 'another-profile' }; }],
  ['memo scope', page => { page.props.memoScope++; }],
]) test(`manual recovery resets on ${label} and leaves old recovery actions inactive until a fresh open`, async t => {
  const page = await mount(t, ordinaryOptions());
  await page.click('我不确定走到哪');
  const map = page.button('查看本段登记地图').props.onClick, textAction = page.button('按本段文字继续').props.onClick;
  await change(page); await nextTick();
  assert.equal(page.find('navigation-recovery'), undefined);
  assert.equal(manualRecoveryTrigger(page).props['aria-expanded'], false);
  const before = manualRecoverySnapshot(page);
  map(); textAction(); await nextTick();
  assert.deepEqual(manualRecoverySnapshot(page), before);
  await page.click('我不确定走到哪');
  assert.ok(page.find('navigation-recovery'));
  assert.match(text(page.find('navigation-recovery')), label === 'manual step' ? /第 2 段：合成乙段/ : /第 1 段：合成甲段/);
});

for (const [label, enter, exit] of [
  ['rest', page => page.click('休息一下'), page => page.click('继续前行')],
  ['parent progress pause', page => { page.props.progress.paused = true; }, page => { page.props.progress.paused = false; }],
  ['detour', page => { page.props.detourActive = true; }, page => { page.props.detourActive = false; }],
  ['guidance suspension', page => { page.props.guidancePaused = true; }, page => { page.props.guidancePaused = false; }],
  ['obstruction draft', async page => {
    page.props.obstructionState = { options: [{ route: page.props.selectedRoute, manualIndex: 0, index: 0,
      kind: 'current', segment_code: 'a', name: '合成甲段' }], reason: '' };
    await nextTick(); await page.click('前方走不了');
  }, page => page.click('取消，继续原行程')],
  ['end confirmation', page => page.click('结束导航'), page => page.click('继续导航')],
  ['finished guidance', async page => { await page.click('结束导航'); await page.click('结束但未确认到达'); }],
  ['route exit', page => page.click('查看路线方案')],
  ['revoked verification', page => { page.props.textMemoRouteVerified = false; }, page => { page.props.textMemoRouteVerified = true; }],
]) test(`manual recovery clears on ${label}; captured open, close, Escape and recovery handlers cannot bypass it`, async t => {
  const page = await mount(t, ordinaryOptions()), trigger = manualRecoveryTrigger(page), open = trigger.props.onClick;
  await page.click('我不确定走到哪');
  const close = page.find('navigation-manual-recovery-close').props.onClick;
  const escape = page.find('navigation-recovery').props.onKeydown;
  const map = page.button('查看本段登记地图').props.onClick, textAction = page.button('按本段文字继续').props.onClick;
  await enter(page); await nextTick();
  assert.equal(page.find('navigation-recovery'), undefined);
  const unavailable = manualRecoveryTrigger(page);
  assert.ok(!unavailable || unavailable.props.disabled === true);
  const before = manualRecoverySnapshot(page), focusCount = trigger.focusCount;
  open({ currentTarget: trigger }); map(); textAction(); close();
  escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); await nextTick();
  assert.equal(page.find('navigation-recovery'), undefined);
  assert.equal(trigger.focusCount, focusCount, 'stale close cannot steal focus from the current task');
  assert.deepEqual(manualRecoverySnapshot(page), before);
  if (exit) {
    await exit(page); await nextTick();
    assert.equal(page.find('navigation-recovery'), undefined, 'returning to guidance does not reopen old disclosure');
  }
});

test('unmount invalidates captured manual recovery callbacks without focus or navigation effects', async t => {
  const page = await mount(t, ordinaryOptions()), trigger = manualRecoveryTrigger(page), open = trigger.props.onClick;
  await page.click('我不确定走到哪');
  const close = page.find('navigation-manual-recovery-close').props.onClick;
  const escape = page.find('navigation-recovery').props.onKeydown;
  const map = page.button('查看本段登记地图').props.onClick, textAction = page.button('按本段文字继续').props.onClick;
  page.unmount(); await nextTick();
  const before = manualRecoverySnapshot(page), focusCount = trigger.focusCount;
  open({ currentTarget: trigger }); map(); textAction(); close();
  escape({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); await nextTick();
  assert.deepEqual(manualRecoverySnapshot(page), before);
  assert.equal(trigger.focusCount, focusCount);
  assert.equal(page.root.children.length, 0);
});

for (const [name, message, issue] of [
  ['poor', /精度较低/, page => page.fix({ accuracy: 80 })],
  ['stale', /位置已过期或无效/, page => page.age()],
  ['invalid', /位置已过期或无效/, page => page.fix({ longitude: NaN })],
  ['outside', /超出登记地图覆盖范围/, page => page.fix({ longitude: 11 })],
  ['off-route', /可能偏离登记路线/, async page => { for (let i = 0; i < 3; i++) await page.fix({ latitude: 10.005 }); }],
  ['denied', /定位权限未开启/, async page => { page.gps.error(new Error('定位权限未开启，请使用文字指引。')); await nextTick(); }],
  ['unavailable', /定位暂不可用/, async page => { page.gps.error(new Error('暂时无法定位，请到开阔处重试。')); await nextTick(); }],
]) test(`${name}: recovery reopens only the registered manual leg or text, without progress, speech, GPS status, network or watcher changes`, async t => {
  const page = await mount(t, { progress: { index: 1, paused: false } });
  assert.equal(page.find('navigation-recovery'), undefined, 'initial opt-out');
  await page.click('开启我的位置'); await page.fix(); await page.click('开启语音提示');
  assert.equal(page.find('navigation-recovery'), undefined, 'healthy follow');
  await issue(page);
  const strip = page.find('navigation-recovery');
  assert.match(text(strip), message);
  assert.match(text(strip), /手动进度仍在第 2 段：合成乙段/);
  assert.match(text(strip), /不能确定您实际站在哪里/);
  const before = recoverySnapshot(page);
  await page.click('按本段文字继续');
  assert.equal(page.map(), undefined);
  assert.deepEqual(recoverySnapshot(page), before);
  await page.click('查看本段登记地图');
  assert.equal(page.map().props['camera-request'].kind, 'current');
  assert.equal(page.map().props['camera-request'].code, 'b');
  assert.equal(page.map().props['manual-index'], 1);
  assert.equal(page.map().props.following, false);
  assert.deepEqual(recoverySnapshot(page), before);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('recovery rejects missing, unsupported, malformed and ambiguous registered geometry at UI and handler', async t => {
  const page = await mount(t);
  await page.click('开启我的位置'); await page.fix({ accuracy: 80 });
  const original = features[0];
  for (const roads of [[], [original, original], [{ ...original, geometry: { type: 'Point', coordinates: [10, 10] } }],
    [{ ...original, geometry: { type: 'LineString', coordinates: [[NaN, 10], [10, 10]] } }]]) {
    page.props.mapFeatures = roads; await nextTick();
    assert.ok(page.find('navigation-recovery'));
    assert.equal(page.button('查看本段登记地图').props.disabled, true);
    const camera = page.map().props['camera-request'], before = recoverySnapshot(page);
    page.button('查看本段登记地图').props.onClick(); await nextTick();
    assert.equal(page.map().props['camera-request'], camera);
    assert.deepEqual(recoverySnapshot(page), before);
    await page.click('按本段文字继续');
    assert.equal(page.map(), undefined);
    await page.click('地图导航');
  }
});

test('recovery hides during rest, finish, detour and after explicit location opt-out; old actions cannot bypass them', async t => {
  const page = await mount(t);
  await page.click('开启我的位置'); await page.fix({ accuracy: 80 });
  const mapAction = page.button('查看本段登记地图').props.onClick;
  const textAction = page.button('按本段文字继续').props.onClick;
  for (const [enter, exit] of [
    [() => page.click('休息一下'), () => page.click('继续前行')],
    [() => page.click('结束导航'), () => page.click('继续导航')],
    [async () => { page.props.detourActive = true; await nextTick(); }, async () => { page.props.detourActive = false; await nextTick(); }],
  ]) {
    await enter(); assert.equal(page.find('navigation-recovery'), undefined);
    const before = recoverySnapshot(page), camera = page.map().props['camera-request'];
    mapAction(); textAction(); await nextTick();
    assert.ok(page.map()); assert.equal(page.map().props['camera-request'], camera);
    assert.deepEqual(recoverySnapshot(page), before);
    await exit(); assert.ok(page.find('navigation-recovery'));
  }
  await page.click('关闭定位'); assert.equal(page.find('navigation-recovery'), undefined);
  await page.click('开启我的位置'); await page.fix(); assert.equal(page.find('navigation-recovery'), undefined);
  await page.fix({ accuracy: 80 }); page.props.guidancePaused = true; await nextTick();
  assert.equal(page.find('navigation-recovery'), undefined);
  mapAction(); textAction(); await nextTick(); assert.equal(page.map(), undefined);
});

test('a replacement route clears prior permission failure and keeps recovery hidden before new location consent', async t => {
  const page = await mount(t);
  await page.click('开启我的位置'); page.gps.error(new Error('定位权限未开启，请使用文字指引。')); await nextTick();
  assert.ok(page.find('navigation-recovery'));
  page.props.selectedRoute = route(); await nextTick();
  assert.equal(page.find('navigation-recovery'), undefined); assert.equal(page.gps.watches, 1);
});

const aheadRoute = () => ({ distance_m: 180, segment_codes: ['a', 'b', 'c'],
  segments: ['a', 'b', 'c'].map((segment_code, i) => ({ segment_code, name: `合成登记路段${i + 1}`,
    length_m: [100, 50, 30][i], step_count: [0, 0, 7][i] })),
  navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1',
    segment_codes: ['a', 'b', 'c'], node_codes: ['A', 'B', 'C', 'D'], segment_lengths_m: [100, 50, 30],
    stops: [{ node_index: 2, node_code: 'C', name: '合成登记座椅' }] } });
const aheadFeatures = ['a', 'b', 'c'].map((code, i) => ({ properties: { kind: 'segment', segment_code: code },
  geometry: { type: 'LineString', coordinates: [[10 + i * .001, 10], [10 + (i + 1) * .001, 10]] } }));

test('active zero and mixed legacy evidence stays visible as plain text and agrees with optional local speech', async t => {
  const r = aheadRoute(); r.segments.forEach(row => { row.step_count = 0; row.width_m = 1.50; });
  const page = await mount(t, { selectedRoute: r, mapFeatures: aheadFeatures });
  const phrase = '前方未标注台阶，不能确认无台阶，请核对现场';
  for (const missing of [false, true]) {
    if (missing) { delete page.props.selectedRoute.segments[1].step_count; await nextTick(); }
    const hint = page.find('navigation-stairs');
    assert.equal(hint.type, 'p'); assert.ok(text(hint).includes(phrase));
    assert.equal(hint.props['data-state'], missing ? 'unknown' : 'none');
    assert.match(text(page.root), /本段台阶数量未确认/);
    assert.match(text(page.root), /登记路宽：1.5 米（可能为默认值）/);
    assert.match(text(page.root), /现场可用宽度未确认/);
    const before = { route: JSON.stringify(page.props.selectedRoute), events: [...page.events] };
    const count = page.spoken.length;
    await page.click('听前方情况');
    assert.equal(page.spoken.length, count + 1); assert.ok(page.spoken.at(-1).startsWith(text(hint)));
    assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
    assert.deepEqual({ route: JSON.stringify(page.props.selectedRoute), events: [...page.events] }, before);
    await page.click('慢一点，只听这一段');
    assert.match(page.spoken.at(-1), /本段台阶数量未确认/);
    assert.doesNotMatch(page.spoken.at(-1), /0 级/);
  }
  const spoken = page.spoken.length;
  await page.click('已走完这段'); assert.equal(page.events.at(-1).progress.index, 1);
  assert.equal(page.spoken.length, spoken);
  assert.equal(page.gps.watches, 0); assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('third-leg stairs are visible before map; only manual progression changes entry estimate, current has no distance', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  const hint = () => text(page.find('navigation-stairs'));
  assert.match(hint(), /前方登记台阶/); assert.match(hint(), /合成登记路段3/);
  assert.match(hint(), /7 级台阶/); assert.match(hint(), /150 米/);
  assert.ok(all(page.root).indexOf(page.find('navigation-stairs')) < all(page.root).indexOf(page.map()));
  assert.equal(page.spoken.length, 0);
  await page.click('开启我的位置'); await page.fix({ longitude: 10.0025 });
  assert.match(hint(), /150 米/);
  await page.click('已走完这段'); assert.match(hint(), /50 米/);
  await page.click('已走完这段'); assert.match(hint(), /本段登记 7 级台阶/);
  assert.doesNotMatch(hint(), /\d+ 米/);
  await page.click('核对目的地并结束'); assert.equal(page.find('navigation-stairs'), undefined);
  await page.click('继续导航'); assert.match(hint(), /本段登记 7 级台阶/);
  assert.equal(page.spoken.length, 0); assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('stair map inspection explicitly highlights third leg in either display without progress, speech or follow', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  await page.click('开启我的位置'); await page.fix();
  const before = page.events.filter(e => e.progress);
  await page.click('文字导航'); await page.click('查看台阶所在登记路段');
  assert.equal(page.map().props['camera-request'].kind, 'segment');
  assert.equal(page.map().props['camera-request'].code, 'c');
  assert.equal(page.map().props['selected-segment-code'], 'c');
  assert.equal(page.map().props['manual-index'], 0); assert.equal(page.map().props.following, false);
  assert.deepEqual(page.events.filter(e => e.progress), before);
  await page.fix(); assert.equal(page.map().props.following, false);
  assert.equal(page.spoken.length, 0); assert.equal(page.gps.watches, 1);
  assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('broken or duplicate target geometry preserves stair text and rejects stale inspection callbacks', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  const inspect = page.button('查看台阶所在登记路段').props.onClick;
  for (const roads of [[], [...aheadFeatures, aheadFeatures[2]],
    ...[{ type: 'Point', coordinates: [10, 10] }, { type: 'LineString', coordinates: 'broken' },
      { type: 'LineString', coordinates: [[10, 10], , [10.001, 10]] }].map(geometry =>
      aheadFeatures.map((f, i) => i === 2 ? { ...f, geometry } : f))]) {
    page.props.mapFeatures = roads; await nextTick();
    assert.match(text(page.find('navigation-stairs')), /合成登记路段3.*7 级台阶/);
    assert.equal(page.button('查看台阶所在登记路段').props.disabled, true);
    const camera = page.map().props['camera-request']; inspect(); await nextTick();
    assert.equal(page.map().props['camera-request'], camera);
  }
});

test('on-demand summary uses validated stairs and rest, cancels/replays once, never opts in or advances', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  assert.equal(page.spoken.length, 0);
  const before = [...page.events];
  await page.click('听前方情况');
  assert.equal(page.spoken.length, 1); assert.match(page.spoken[0], /合成登记路段3/);
  assert.match(page.spoken[0], /7 级台阶/); assert.match(page.spoken[0], /合成登记座椅/);
  assert.match(page.spoken[0], /150 米/); assert.match(page.spoken[0], /登记/);
  assert.match(page.spoken[0], /不是.*(实时|实际)|不代表.*(实时|实际)/);
  assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
  assert.deepEqual(page.events, before);
  await page.click('听前方情况'); assert.equal(page.spoken.length, 2);
  await page.click('已走完这段'); assert.equal(page.spoken.length, 2, 'no automatic summary on progression');
  await page.click('文字导航'); assert.equal(page.spoken.length, 2);
  assert.equal(page.gps.watches, 0); assert.equal(globalThis.fetch.mock.calls.length, 0);
});

test('summary requires a local Chinese voice and never falls back to remote or unspecified speech', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute() });
  for (const voices of [[], [{ lang: 'zh-CN', localService: false }], [{ lang: 'en-US', localService: true }]]) {
    globalThis.speechSynthesis.getVoices = () => voices;
    await page.click('听前方情况');
    assert.equal(page.spoken.length, 0);
    assert.match(text(page.find('navigation-ahead-summary')), /合成登记路段3/);
    assert.match(text(page.root), /本地中文语音.*不可用/);
  }
  globalThis.speechSynthesis.getVoices = () => [{ lang: 'zh-CN', localService: true }];
  await page.click('听前方情况'); assert.equal(page.spoken.length, 1);
  await page.click('停止播报'); assert.equal(page.button('停止播报'), undefined);
  assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
});

test('summary binds the validated local voice even if the platform list changes immediately', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute() });
  const local = { lang: 'zh-CN', localService: true }; let reads = 0;
  globalThis.speechSynthesis.getVoices = () => ++reads === 1 ? [local] : [{ lang: 'zh-CN', localService: false }];
  await page.click('听前方情况'); assert.equal(page.spoken.length, 1);
  assert.equal(page.utterances[0].voice, local); assert.equal(reads, 1);
});

test('manually passing the last registered stairs replaces the cue with unmarked evidence without playback', async t => {
  const r = aheadRoute(); r.segment_codes.push('d');
  r.segments.push({ segment_code: 'd', name: '合成登记末段', length_m: 20, step_count: 0 }); r.distance_m += 20;
  const page = await mount(t, { selectedRoute: r });
  await page.click('已走完这段'); await page.click('已走完这段');
  assert.match(text(page.find('navigation-stairs')), /本段登记 7 级台阶/);
  await page.click('已走完这段'); assert.equal(page.find('navigation-stairs').props['data-state'], 'none');
  assert.match(text(page.find('navigation-stairs')), /前方未标注台阶，不能确认无台阶，请核对现场/);
  assert.equal(page.button('查看台阶所在登记路段'), undefined);
  assert.equal(page.spoken.length, 0);
  await page.click('听前方情况'); assert.ok(page.spoken[0].startsWith(text(page.find('navigation-stairs'))));
});

test('rest, exit dialog, suspension and route exit block stale summary/focus handlers and cancel speech', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  let cancelled = 0; globalThis.speechSynthesis.cancel = () => cancelled++;
  const summary = page.button('听前方情况').props.onClick;
  const inspect = page.button('查看台阶所在登记路段').props.onClick;
  await page.click('听前方情况'); const firstCancel = cancelled;
  await page.click('休息一下'); assert.ok(cancelled > firstCancel);
  assert.equal(page.button('听前方情况').props.disabled, true);
  summary(); inspect(); await nextTick(); assert.equal(page.spoken.length, 1);
  assert.equal(page.find('navigation-stairs'), undefined);
  await page.click('继续前行'); assert.equal(page.spoken.length, 1);
  await page.click('听前方情况'); const dialogCancel = cancelled;
  await page.click('结束导航'); assert.ok(cancelled > dialogCancel);
  assert.equal(page.button('听前方情况').props.disabled, true);
  summary(); inspect(); await nextTick(); assert.equal(page.spoken.length, 2);
  await page.click('继续导航');
  page.props.guidancePaused = true; await nextTick(); summary(); inspect(); await nextTick();
  assert.equal(page.spoken.length, 2); assert.equal(page.map(), undefined);
  page.props.guidancePaused = false; await nextTick();
  await page.click('查看路线方案'); summary(); inspect(); await nextTick();
  assert.equal(page.spoken.length, 2); assert.equal(page.find('navigation-stairs'), undefined);
});

test('missing evidence is spoken as missing and route replacement never auto plays', async t => {
  const r = aheadRoute(); delete r.segments[0].step_count; delete r.distance_m; delete r.navigation_rest;
  const page = await mount(t, { selectedRoute: r, mapFeatures: [] });
  assert.match(text(page.find('navigation-stairs')), /已登记最先/);
  assert.doesNotMatch(text(page.find('navigation-stairs')), /\d+ 米/);
  await page.click('听前方情况');
  assert.match(page.spoken[0], /未确认|缺少|不完整/);
  assert.doesNotMatch(page.spoken[0], /\d+ 米/);
  page.props.selectedRoute = aheadRoute(); await nextTick(); assert.equal(page.spoken.length, 1);
});

test('unsupported summary speech leaves validated readable text and a usable error', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), speechSupported: false });
  await page.click('听前方情况');
  assert.equal(page.spoken.length, 0);
  assert.match(text(page.root), /不支持语音播报/);
  assert.match(text(page.find('navigation-ahead-summary')), /合成登记路段3/);
  assert.equal(page.button('开启语音提示').props['aria-pressed'], false);
});

test('ordinary map browsing with unknown or legacy-zero stairs never claims stair inspection', async t => {
  const page = await mount(t);
  page.map().props.onBrowse(); await nextTick();
  assert.match(text(page.find('map-follow-state')), /正在浏览地图/);
  assert.doesNotMatch(text(page.find('map-follow-state')), /含台阶/);
  page.props.selectedRoute.segments.forEach(row => { row.step_count = 0; }); await nextTick();
  assert.doesNotMatch(text(page.find('map-follow-state')), /含台阶/);
});

test('late GPS and stale legacy voice handlers cannot restart speech under exit dialog or after route exit', async t => {
  const page = await mount(t, { selectedRoute: aheadRoute(), mapFeatures: aheadFeatures });
  await page.click('开启我的位置'); await page.fix(); await page.click('开启语音提示');
  const replay = page.button('重新播报').props.onClick, toggle = page.button('关闭语音').props.onClick;
  await page.click('结束导航');
  for (let i = 0; i < 3; i++) await page.fix({ latitude: 10.005 });
  replay(); toggle(); await nextTick(); assert.equal(page.spoken.length, 1);
  await page.click('继续导航'); await page.fix(); await page.click('查看路线方案');
  for (let i = 0; i < 3; i++) await page.fix({ latitude: 10.005 });
  replay(); toggle(); await nextTick(); assert.equal(page.spoken.length, 1);
});
