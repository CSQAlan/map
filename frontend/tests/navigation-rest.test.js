import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRenderer, h, reactive, nextTick } from 'vue';
import { compileScript, parse } from '@vue/compiler-sfc';
import { navigationRest } from '../src/utils/navigationRest.js';
import { navigationRestPlan } from '../src/utils/navigationRestPlan.js';
import { WALKING_BUDGETS } from '../src/utils/walkingBudget.js';
import { createRoutePlanner } from '../src/composables/useRoutePlanner.js';

// Synthetic directed paths, not live location or the non-launchable rest preview.
function route(prefix = '') {
  const codes = ['ar', 'rq', 'qt'].map(code => prefix + code);
  return { distance_m: 180, segment_codes: codes,
    segments: codes.map((segment_code, i) => ({ segment_code, name: `合成路段${i + 1}`,
      length_m: [100, 50, 30][i], geometry_coordinates: [[106, 29], [106.001, 29]], step_count: 0 })),
    navigation_rest: { version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1',
      segment_codes: [...codes], node_codes: ['A', 'R', 'Q', 'T'], segment_lengths_m: [100, 50, 30],
      stops: [{ node_index: 0, node_code: 'A', name: '合成起点休息点' },
        { node_index: 1, node_code: 'R', name: '合成第一休息点' },
        { node_index: 2, node_code: 'Q', name: '合成第二休息点' },
        { node_index: 3, node_code: 'T', name: '合成终点休息点' }] } };
}
const clone = value => JSON.parse(JSON.stringify(value));
test('page walking plan: exact hundredths, equality and each reused option', () => {
  const r = route();
  assert.deepEqual(navigationRestPlan(r, 0, 100), {
    state: 'equal', distance: 100, difference: 0, text: '估算恰好等于计划（100 米）。',
  });
  for (const plan of WALKING_BUDGETS) {
    assert.equal(navigationRestPlan(r, 0, plan).difference, plan - 100);
  }
  r.segments.forEach((row, i) => { row.length_m = [73.63, 86, 174][i]; });
  r.distance_m = 333.63; r.navigation_rest.segment_lengths_m = [73.63, 86, 174];
  r.navigation_rest.stops = [r.navigation_rest.stops[2]];
  assert.deepEqual(navigationRestPlan(r, 0, 100), {
    state: 'over', distance: 159.63, difference: 59.63, text: '估算超出计划约 59.63 米。',
  });
  assert.deepEqual(navigationRestPlan(r, 1, 100), {
    state: 'under', distance: 86, difference: 14, text: '估算未超过计划，少约 14 米。',
  });
  assert.equal(navigationRestPlan(r, 2, 100), null, 'passed node has no substitute');
});

test('walking plan rejects unknown, malformed, unbounded and inactive evidence without coercion', () => {
  for (const plan of [null, undefined, '', '100', 0, -100, 150, NaN, Infinity, {}, []])
    assert.equal(navigationRestPlan(route(), 0, plan), null);
  for (const [, mutate] of invalid) {
    const r = route(); mutate(r); assert.equal(navigationRestPlan(r, 0, 100), null);
  }
  for (const options of [{ paused: true }, { active: false }])
    assert.equal(navigationRestPlan(route(), 0, 100, options), null);
  for (const index of [-1, 3, 0.5, undefined]) assert.equal(navigationRestPlan(route(), index, 100), null);
  for (const value of [NaN, Infinity, -1, 0, '100', Number.MAX_VALUE, Number.MAX_SAFE_INTEGER / 100 + 1]) {
    const r = route(); r.distance_m = value;
    assert.equal(navigationRestPlan(r, 0, 100), null);
  }
  const r = route(); r.distance_m = 1e308;
  r.navigation_rest.segment_lengths_m = [100, 1e308, 1e308];
  r.segments.forEach((row, i) => { row.length_m = r.navigation_rest.segment_lengths_m[i]; });
  assert.equal(navigationRestPlan(r, 0, 100), null, 'overflow elsewhere must not validate a finite next leg');
  assert.equal(navigationRestPlan(null, 0, 100), null);
  assert.equal(navigationRestPlan({ state: 'upcoming', distance: 100 }, 0, 100), null, 'a raw hint is not route evidence');
});
test('nearest forward middle stop uses whole current unconfirmed directed leg; backtracking is manual', () => {
  const r = route();
  const first = navigationRest(r, 0);
  assert.equal(first.state, 'upcoming'); assert.equal(first.name, '合成第一休息点'); assert.equal(first.distance, 100);
  assert.match(first.destinationText, /终点是登记休息点/);
  assert.equal(navigationRest(r, 1).name, '合成第二休息点');
  assert.equal(navigationRest(r, 1).distance, 50);
  assert.equal(navigationRest(r, 2).state, 'none');
  assert.equal(navigationRest(r, 0).name, first.name);
  r.navigation_rest.stops.splice(1, 1);
  assert.equal(navigationRest(r, 0).distance, 150, 'sum ordered actual legs, never straight line');
});

test('start, passed nodes and destination never count as upcoming intermediate stops', () => {
  const r = route(); r.navigation_rest.stops.splice(1, 2);
  const hint = navigationRest(r, 0);
  assert.equal(hint.state, 'none'); assert.match(hint.text, /登记路线前方无已标注中途休息点/);
  assert.match(hint.destinationText, /终点是登记休息点/);
  r.navigation_rest.stops = [];
  assert.equal(navigationRest(r, 0).destinationText, '');
  assert.equal(navigationRest(r, 0).state, 'none');
});

const invalid = [
  ['old DTO', r => delete r.navigation_rest],
  ['wrong version', r => r.navigation_rest.version = 2],
  ['wrong source', r => r.navigation_rest.source = 'preview'],
  ['missing stops', r => delete r.navigation_rest.stops],
  ['missing chain', r => r.navigation_rest.node_codes.pop()],
  ['repeated node', r => r.navigation_rest.node_codes[1] = 'A'],
  ['wrong node identity', r => r.navigation_rest.stops[1].node_code = 'elsewhere'],
  ['same node ambiguous', r => r.navigation_rest.stops.splice(2, 0, { ...r.navigation_rest.stops[1], name: '合成歧义记录' })],
  ['wrong stop order', r => r.navigation_rest.stops.reverse()],
  ['negative index', r => r.navigation_rest.stops[0].node_index = -1],
  ['noninteger index', r => r.navigation_rest.stops[1].node_index = 0.5],
  ['beyond destination', r => r.navigation_rest.stops[3].node_index = 4],
  ['missing name', r => r.navigation_rest.stops[1].name = ''],
  ['missing row', r => r.segments.pop()],
  ['wrong row order', r => r.segments.reverse()],
  ['repeated edge', r => r.segment_codes[1] = r.segment_codes[0]],
  ['other route evidence', r => r.navigation_rest.segment_codes[0] = 'other'],
  ['missing leg', r => r.navigation_rest.segment_lengths_m.pop()],
  ['zero leg', r => r.navigation_rest.segment_lengths_m[0] = 0],
  ['string leg', r => r.navigation_rest.segment_lengths_m[0] = '100'],
  ['mismatch length', r => r.segments[0].length_m = 99],
  ['bad total', r => r.distance_m = 181],
  ['missing actual length', r => delete r.segments[0].length_m],
];
for (const [name, mutate] of invalid) test(`${name}: unknown, never absence or zero`, () => {
  const r = route(); mutate(r);
  const hint = navigationRest(r, 0);
  assert.equal(hint.state, 'unknown'); assert.match(hint.text, /暂未确认/);
  assert.equal(hint.destinationText, undefined); assert.equal(hint.distance, undefined);
});
test('pause, detour suspension, no active trip and missing route hide old hints', () => {
  for (const options of [{ paused: true }, { active: false }, { active: false, paused: true }])
    assert.deepEqual(navigationRest(route(), 0, options), { state: 'hidden' });
  assert.deepEqual(navigationRest(null, 0), { state: 'hidden' });
  for (const index of [-1, 3, 0.5, undefined]) assert.equal(navigationRest(route(), index).state, 'unknown');
});

async function compiledPage() {
  const url = new URL('../src/pages/NavigationPage.vue', import.meta.url);
  let code = compileScript(parse(await readFile(url, 'utf8')).descriptor, { id: 'nav-rest', inlineTemplate: true }).content;
  code = code.replace(/import (\w+) from '([^']+\.vue)';/g, (_, name) => `const ${name}={render:()=>null};`)
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) => `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}
const node = (type, text = '') => ({ type, text, children: [], props: {}, querySelector: () => null, querySelectorAll: () => [] });
const text = n => n.text + n.children.map(text).join('');
const all = n => [n, ...n.children.flatMap(all)];
function mount(Page, props) {
  const renderer = createRenderer({ createElement: tag => node(tag), createText: v => node('#text', v), createComment: () => node('#comment'),
    setText(n, v) { n.text = v; }, setElementText(n, v) { n.text = v; n.children = []; }, patchProp(n, key, old, v) { n.props[key] = v; },
    insert(n, parent, anchor) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = parent;
      const i = parent.children.indexOf(anchor); parent.children.splice(i < 0 ? parent.children.length : i, 0, n); },
    remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
  const root = node('root'), events = [];
  const app = renderer.createApp({ render: () => h(Page, { ...props, onEndNavigation: () => events.push('end'), onOpenRoutes: () => events.push('routes'),
    onProgress: value => events.push(['progress', value]), onSelectSegment: value => events.push(['segment', value]) }) });
  app.mount(root);
  return { root, app, events, async selectPlan(value) {
    const select = all(root).find(n => n.props.id === 'navigation-walking-plan');
    assert.ok(select); select.props.onChange({ target: { value } }); await nextTick();
  }, async click(label) {
    const button = all(root).find(n => n.type === 'button' && text(n).includes(label));
    assert.ok(button, label); assert.notEqual(button.props.disabled, true); button.props.onClick(); await nextTick();
  } };
}
test('actual map-free page advances/backtracks, rests, changes route, suspends and ends with no new speech/network', async () => {
  const Page = await compiledPage(), props = reactive({ selectedRoute: route(), guidancePaused: false });
  const originalFetch = globalThis.fetch, originalSpeech = globalThis.speechSynthesis, originalUtterance = globalThis.SpeechSynthesisUtterance;
  let fetches = 0; const spoken = [];
  globalThis.fetch = () => { fetches++; throw Error('no request allowed'); };
  globalThis.speechSynthesis = { cancel() {}, getVoices: () => [], speak: u => spoken.push(u.text) };
  globalThis.SpeechSynthesisUtterance = class { constructor(value) { this.text = value; } };
  const page = mount(Page, props);
  const hint = () => all(page.root).find(n => n.props['data-testid'] === 'navigation-rest');
  try {
    assert.match(text(hint()), /合成第一休息点.*100 米/);
    assert.match(text(hint()), /包含尚未确认走完的当前整段/);
    assert.match(text(hint()), /不是实时定位点距/);
    assert.match(text(hint()), /不保证有座位或现场通行/);
    assert.equal(hint().props['aria-live'], undefined, 'no additional auto announcement');
    await page.click('已走完这段'); assert.match(text(hint()), /合成第二休息点.*50 米/);
    assert.doesNotMatch(text(hint()), /合成第一休息点/);
    await page.click('上一段'); assert.match(text(hint()), /合成第一休息点/);
    await page.click('已走完这段'); await page.click('已走完这段');
    assert.equal(hint().props['data-state'], 'none'); assert.match(text(hint()), /终点是登记休息点/);
    assert.doesNotMatch(text(hint()), /合成第一休息点|合成第二休息点/);
    await page.click('上一段'); await page.click('上一段');
    await page.click('休息一下'); assert.equal(hint(), undefined);
    await page.click('继续前行'); assert.match(text(hint()), /合成第一休息点/);
    props.selectedRoute = { ...route('other-'), navigation_rest: null }; await nextTick();
    assert.match(text(hint()), /暂未确认/); assert.doesNotMatch(text(hint()), /合成第一休息点/);
    props.selectedRoute = route('new-'); await nextTick();
    await page.click('开启语音提示'); assert.equal(spoken.length, 1);
    assert.doesNotMatch(spoken[0], /休息点/);
    props.detourActive = true; props.guidancePaused = true; props.selectedRoute = null; await nextTick();
    assert.equal(hint(), undefined); assert.doesNotMatch(text(page.root), /合成第一休息点/);
    props.selectedRoute = route('late-'); await nextTick(); assert.equal(hint(), undefined);
    props.guidancePaused = false; await nextTick(); assert.match(text(hint()), /合成第一休息点/);
    assert.equal(spoken.length, 1);
    await page.click('结束导航'); assert.equal(hint(), undefined);
    await page.click('继续导航'); assert.ok(hint());
    await page.click('结束导航'); await page.click('确认结束导航'); assert.equal(hint(), undefined);
    props.selectedRoute = route('too-late-'); await nextTick(); assert.equal(hint(), undefined);
    assert.ok(page.events.includes('end')); assert.equal(fetches, 0);
  } finally { page.app.unmount(); globalThis.fetch = originalFetch; globalThis.speechSynthesis = originalSpeech; globalThis.SpeechSynthesisUtterance = originalUtterance; }
});

test('page walking plan is optional, local, cleared on route change and hidden with stale points', async t => {
  const Page = await compiledPage(), props = reactive({ selectedRoute: route(), guidancePaused: false });
  t.mock.method(globalThis, 'fetch', () => { throw Error('no request allowed'); });
  const oldSpeech = globalThis.speechSynthesis, oldUtterance = globalThis.SpeechSynthesisUtterance, spoken = [];
  globalThis.speechSynthesis = { cancel() {}, getVoices: () => [], speak: value => spoken.push(value.text) };
  globalThis.SpeechSynthesisUtterance = class { constructor(value) { this.text = value; } };
  t.after(() => { globalThis.speechSynthesis = oldSpeech; globalThis.SpeechSynthesisUtterance = oldUtterance; });
  const page = mount(Page, props);
  const find = id => all(page.root).find(n => n.props['data-testid'] === id);
  const select = () => all(page.root).find(n => n.props.id === 'navigation-walking-plan');
  try {
    assert.equal(select().props.value, ''); assert.equal(find('navigation-rest-plan'), undefined);
    assert.deepEqual(all(select()).filter(n => n.type === 'option').map(n => n.props.value), ['', ...WALKING_BUDGETS]);
    await page.click('开启语音提示'); assert.equal(spoken.length, 1);
    const before = clone(page.events);
    await page.selectPlan('100');
    assert.match(text(find('navigation-rest-plan')), /估算恰好等于计划（100 米）/);
    assert.deepEqual(page.events, before, 'preference is never emitted or published as progress');
    assert.equal(spoken.length, 1, 'even enabled voice does not announce preference/comparison');
    const explanation = all(page.root).find(n => n.props.id === 'navigation-plan-explanation');
    for (const phrase of ['下一登记中途休息点', '尚未手动确认走完的当前整段', '出发前的不间断步行预算', '不是实际距离', '不保存或发送']) assert.ok(text(explanation).includes(phrase));
    await page.selectPlan('100junk'); assert.equal(find('navigation-rest-plan'), undefined);
    await page.selectPlan('100'); await page.click('已走完这段');
    assert.match(text(find('navigation-rest-plan')), /估算未超过计划，少约 50 米/);
    assert.doesNotMatch(text(find('navigation-rest')), /合成第一休息点/);
    await page.click('休息一下'); assert.equal(find('navigation-rest-plan'), undefined); assert.equal(find('navigation-rest'), undefined);
    await page.click('继续前行'); assert.match(text(find('navigation-rest-plan')), /少约 50 米/);
    await page.click('已走完这段'); assert.equal(find('navigation-rest-plan'), undefined); assert.equal(select(), undefined);
    await page.click('上一段');
    props.selectedRoute.navigation_rest.stops[2].node_code = 'unconfirmed'; await nextTick();
    assert.equal(find('navigation-rest-plan'), undefined); assert.equal(select(), undefined);
    assert.doesNotMatch(text(find('navigation-rest')), /合成第二休息点/);
    props.selectedRoute = route('replacement-'); await nextTick();
    assert.equal(select().props.value, ''); assert.equal(find('navigation-rest-plan'), undefined);
    await page.selectPlan('200'); props.guidancePaused = true; await nextTick();
    assert.equal(find('navigation-rest-plan'), undefined); assert.doesNotMatch(text(page.root), /合成第一休息点/);
    props.selectedRoute = null; await nextTick(); props.selectedRoute = route('detour-'); await nextTick();
    props.guidancePaused = false; await nextTick();
    assert.equal(select().props.value, ''); assert.equal(find('navigation-rest-plan'), undefined);
    await page.selectPlan('100');
    Object.assign(props.selectedRoute, route('mutated-in-place-')); await nextTick();
    assert.equal(select().props.value, ''); assert.equal(find('navigation-rest-plan'), undefined);
    await page.selectPlan('100'); await page.selectPlan(''); assert.equal(find('navigation-rest-plan'), undefined);
    await page.selectPlan('100'); await page.click('结束导航'); assert.equal(find('navigation-rest-plan'), undefined);
    await page.click('继续导航'); await page.click('查看路线方案'); assert.equal(find('navigation-rest-plan'), undefined);
  } finally { page.app.unmount(); }
});
test('leaving route page immediately hides hint even before async parent navigation completes', async () => {
  const page = mount(await compiledPage(), reactive({ selectedRoute: route() }));
  try {
    await page.click('查看路线方案'); assert.ok(page.events.includes('routes'));
    assert.equal(all(page.root).some(n => n.props['data-testid'] === 'navigation-rest'), false);
  } finally { page.app.unmount(); }
});

test('paused preview explicitly reads the frozen whole manual step and existing plan without normal hints or side effects', async t => {
  const Page = await compiledPage(), r = route();
  r.navigation_rest.stops.splice(1, 1);
  const props = reactive({ selectedRoute: r });
  t.mock.method(globalThis, 'fetch', () => { throw Error('preview must stay offline'); });
  const oldSpeech = globalThis.speechSynthesis, oldUtterance = globalThis.SpeechSynthesisUtterance;
  const spoken = [];
  globalThis.speechSynthesis = { cancel() {}, getVoices: () => [], speak: u => spoken.push(u.text) };
  globalThis.SpeechSynthesisUtterance = class { constructor(value) { this.text = value; } };
  const page = mount(Page, props);
  const find = id => all(page.root).find(n => n.props['data-testid'] === id);
  const button = label => all(page.root).find(n => n.type === 'button' && text(n) === label);
  try {
    await page.selectPlan('100'); await page.click('开启语音提示');
    await page.click('文字导航'); await page.click('休息一下');
    assert.equal(find('paused-rest-preview'), undefined);
    const open = button('看看前方能在哪歇'); assert.ok(open);
    assert.equal(open.props['aria-expanded'], false);
    assert.equal(open.props['aria-controls'], 'paused-rest-preview');
    assert.ok(all(page.root).indexOf(button('继续前行')) < all(page.root).indexOf(open));
    const before = clone(page.events), beforeSpeech = [...spoken];
    await page.click('看看前方能在哪歇');
    const preview = find('paused-rest-preview'); assert.ok(preview);
    assert.equal(preview.props['data-state'], 'upcoming');
    assert.match(text(preview), /合成第二休息点.*150 米/);
    assert.match(text(preview), /尚未手动确认走完的当前整段/);
    assert.match(text(preview), /不是.*实际距离/);
    assert.match(text(preview), /100 米.*超出计划约 50 米/);
    assert.equal(preview.props['aria-live'], undefined);
    assert.equal(all(preview).some(n => ['button', 'select', 'input'].includes(n.type)), false);
    assert.equal(find('navigation-rest'), undefined);
    assert.equal(find('navigation-rest-plan'), undefined);
    assert.equal(all(page.root).some(n => n.props.id === 'optional-navigation-map'), false);
    assert.deepEqual(page.events, before); assert.deepEqual(spoken, beforeSpeech);
    assert.equal(button('收起前方休息信息').props['aria-expanded'], true);
    await page.click('收起前方休息信息'); assert.equal(find('paused-rest-preview'), undefined);
    await page.click('看看前方能在哪歇'); await page.click('继续前行');
    assert.equal(find('paused-rest-preview'), undefined);
    assert.match(text(find('navigation-rest-plan')), /超出计划约 50 米/);
    assert.equal(spoken.length, beforeSpeech.length + 1, 'existing resume speech stays unchanged');
    await page.click('已走完这段'); await page.click('休息一下');
    assert.equal(button('看看前方能在哪歇').props['aria-expanded'], false);
    await page.click('看看前方能在哪歇');
    assert.match(text(find('paused-rest-preview')), /合成第二休息点.*50 米/);
    assert.match(text(find('navigation-paused')), /第 2 段/);
  } finally {
    page.app.unmount(); globalThis.speechSynthesis = oldSpeech; globalThis.SpeechSynthesisUtterance = oldUtterance;
  }
});

test('paused preview keeps every strict evidence rejection unknown, distinct from no intermediate and destination only', async () => {
  const Page = await compiledPage();
  for (const [name, mutate] of [...invalid, ['no route chain', r => { r.segment_codes = []; r.segments = []; }]]) {
    const props = reactive({ selectedRoute: route(), progress: { index: 1, paused: true } });
    const page = mount(Page, props);
    try {
      mutate(props.selectedRoute); await nextTick();
      await page.click('看看前方能在哪歇');
      const preview = all(page.root).find(n => n.props['data-testid'] === 'paused-rest-preview');
      assert.equal(preview.props['data-state'], 'unknown', name);
      assert.match(text(preview), /暂未确认/, name);
      assert.doesNotMatch(text(preview), /合成.*休息点|前方无已标注|约 0 米|终点是登记/, name);
    } finally { page.app.unmount(); }
  }
  for (const destinationOnly of [false, true]) {
    const r = route(); r.navigation_rest.stops = destinationOnly ? [r.navigation_rest.stops.at(-1)] : [];
    const page = mount(Page, reactive({ selectedRoute: r, progress: { index: 1, paused: true } }));
    try {
      await page.click('看看前方能在哪歇');
      const preview = all(page.root).find(n => n.props['data-testid'] === 'paused-rest-preview');
      assert.equal(preview.props['data-state'], 'none');
      assert.match(text(preview), /登记路线前方无已标注中途休息点/);
      assert.equal(/终点是登记休息点：合成终点休息点/.test(text(preview)), destinationOnly);
      assert.doesNotMatch(text(preview), /最近登记中途休息点|约 \d+ 米|暂未确认/);
    } finally { page.app.unmount(); }
  }
});

test('paused preview collapses on context transitions and rejects old open handlers outside manual rest', async () => {
  const Page = await compiledPage();
  for (const transition of ['resume', 'route', 'deep-route', 'profile', 'area', 'detour', 'obstruction', 'end-dialog', 'leave', 'end']) {
    const props = reactive({ selectedRoute: route(), selectedProfile: { label: '合成出行情况' }, progress: { index: 1, paused: true } });
    const page = mount(Page, props);
    const find = id => all(page.root).find(n => n.props['data-testid'] === id);
    const button = label => all(page.root).find(n => n.type === 'button' && text(n) === label);
    try {
      const oldOpen = button('看看前方能在哪歇').props.onClick;
      await page.click('看看前方能在哪歇'); assert.ok(find('paused-rest-preview'));
      if (transition === 'resume') await page.click('继续前行');
      if (transition === 'route') props.selectedRoute = route('replacement-');
      if (transition === 'deep-route') props.selectedRoute.segments[1].name = '更正路段名称';
      if (transition === 'profile') props.selectedProfile = { label: '更正出行情况' };
      if (transition === 'area') props.pilotArea = { area_code: 'replacement' };
      if (transition === 'detour') props.detourActive = true;
      if (transition === 'obstruction') props.guidancePaused = true;
      if (transition === 'end-dialog' || transition === 'end') await page.click('结束导航');
      if (transition === 'leave') await page.click('查看路线方案');
      if (transition === 'end') await page.click('结束但未确认到达');
      await nextTick(); assert.equal(find('paused-rest-preview'), undefined, transition);
      if (['resume', 'route', 'obstruction', 'end-dialog', 'leave', 'end'].includes(transition)) {
        oldOpen(); await nextTick(); assert.equal(find('paused-rest-preview'), undefined, `stale handler: ${transition}`);
      }
      if (transition === 'obstruction') {
        assert.equal(find('navigation-paused'), undefined);
        assert.equal(button('看看前方能在哪歇'), undefined);
        props.guidancePaused = false; await nextTick();
      }
      if (transition === 'end-dialog') await page.click('继续导航');
      if (button('看看前方能在哪歇')) assert.equal(button('看看前方能在哪歇').props['aria-expanded'], false, transition);
      assert.equal(find('paused-rest-preview'), undefined, `does not revive: ${transition}`);
    } finally { page.app.unmount(); }
  }
});

const response = payload => ({ ok: true, json: async () => payload });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
test('planner keeps actual candidate metadata, not rest preview; late plan cannot revive on context change', async () => {
  const places = ['合成起点', '合成终点', '其他终点'].map(value => ({ value, label: value }));
  const pending = deferred(); let calls = 0;
  const primary = route('ordinary-'); primary.navigation_rest.stops = [];
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    fetcher: async () => ++calls === 1 ? response({ routes: [primary, route('other-')] }) : pending.promise });
  planner.startName.value = places[0].value; planner.endName.value = places[1].value;
  await planner.planRoutes(); assert.equal(navigationRest(planner.selectedRoute.value, 0).state, 'none');
  planner.selectRoute(1); assert.equal(navigationRest(planner.selectedRoute.value, 0).state, 'upcoming');
  const task = planner.planRoutes(); assert.equal(planner.selectedRoute.value, null);
  planner.endName.value = places[2].value;
  pending.resolve(response({ routes: [route('late-')], rest_preview: { stop_name: '不可启动预览' } }));
  await task; assert.equal(planner.selectedRoute.value, null);
  assert.equal(navigationRest(planner.selectedRoute.value, 0).state, 'hidden');
});

test('detour preview stays separate; GPS replan metadata waits for explicit confirmation; errors and old responses stay hidden', async () => {
  const places = ['合成起点', '合成终点'].map(value => ({ value, label: value }));
  const original = route('original-'); original.navigation_rest.stops = [];
  const alternate = route('alternate-'), gps = route('gps-');
  gps.segments[0].geometry_coordinates[0] = [106.0005, 29];
  gps.navigation_rest.node_codes[0] = '__CURRENT_ORIGIN__';
  gps.navigation_rest.stops.shift();
  const payload = routes => ({ start_name: places[0].value, end_name: places[1].value,
    mobility_type: 'WHEELCHAIR', strategy: 'BALANCED', excluded_segment_code: 'original-ar', routes });
  let failure = false; let delayed = null;
  const planner = createRoutePlanner({ getStartOptions: () => places, getEndOptions: () => places,
    fetcher: async url => {
      if (url.includes('/start-options?')) return response({ excluded_segment_code: 'original-ar', candidates: [
        { segment_code: 'gps-ar', name: '合成裁剪接入', allowed: true, distance_m: 1, snapped_coordinates: [106.0005, 29] }] });
      if (url.includes('start_longitude=')) {
        if (failure) throw Error('synthetic offline');
        if (delayed) return delayed.promise;
        return response({ ...payload([gps]), start_context: { segment_code: 'gps-ar', name: '合成裁剪接入', snapped_coordinates: [106.0005, 29], distance_m: 1 } });
      }
      return response(url.includes('exclude_segment_code=') ? payload([alternate]) : payload([original]));
    } });
  planner.startName.value = places[0].value; planner.endName.value = places[1].value;
  await planner.planRoutes(); await planner.previewExclusion('original-ar');
  assert.equal(navigationRest(planner.selectedRoute.value, 0).state, 'none');
  assert.equal(planner.useExclusionRoute(), true);
  assert.equal(navigationRest(planner.selectedRoute.value, 0).state, 'upcoming');
  let timestamp = Date.now() - 10;
  const fix = async () => ({ longitude: 106.0005, latitude: 29, accuracy: 1, timestamp: ++timestamp });
  await planner.detour.replan(fix); assert.equal(planner.selectedRoute.value, null);
  await planner.detour.confirmStart('gps-ar'); assert.equal(planner.selectedRoute.value, null);
  assert.equal(planner.detour.confirmRoute(), true);
  assert.equal(navigationRest(planner.selectedRoute.value, 0).distance, 100);
  failure = true; await planner.detour.replan(fix); await planner.detour.confirmStart('gps-ar');
  assert.equal(planner.selectedRoute.value, null);
  assert.equal(planner.detour.confirmRoute(), false);
  failure = false; delayed = deferred();
  await planner.detour.replan(fix); const task = planner.detour.confirmStart('gps-ar');
  planner.detour.pause('synthetic newer generation');
  delayed.resolve(response({ ...payload([gps]), start_context: { segment_code: 'gps-ar', name: '合成裁剪接入', snapped_coordinates: [106.0005, 29], distance_m: 1 } }));
  await task; assert.equal(planner.selectedRoute.value, null);
  assert.equal(planner.detour.confirmRoute(), false);
});

test('public seed endpoint render evidence: woodland 270 is destination; lotus246 ends at entry not platform', async () => {
  const seed = JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json', import.meta.url), 'utf8'));
  const pois = JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_pois.json', import.meta.url), 'utf8'));
  for (const [codes, distance] of [
    [['S_SY_GATE_TO_GARDEN_SPLIT', 'S_SY_GARDEN_SPLIT_TO_REST'], 270],
    [['S_SY_GATE_TO_MAIN', 'S_SY_MAIN_TO_LOTUS'], 246],
  ]) {
    const rows = codes.map(code => seed.find(e => e.segment_code === code));
    const nodes = [rows[0].start_node_code, ...rows.map(e => e.end_node_code)];
    const r = { segment_codes: codes, segments: rows, distance_m: distance, navigation_rest: {
      version: 1, source: 'ACTIVE_REST_AREA_LINKED_NODES/v1', segment_codes: codes, node_codes: nodes,
      segment_lengths_m: rows.map(e => e.length_m), stops: nodes.flatMap((node, i) => pois
        .filter(p => p.poi_type === 'REST_AREA' && p.linked_node_code === node)
        .map(p => ({ name: p.name, node_code: node, node_index: i }))) } };
    assert.equal(navigationRest(r, 0).state, 'none');
    assert.match(navigationRest(r, 0).destinationText, /终点是登记休息点/);
    assert.ok(!nodes.includes('N_SY_LOTUS_PLATFORM'));
    if (nodes.at(-1) === 'N_SY_LOTUS_ENTRY') r.arrival_boundary = {
      version: 1, kind: 'LOTUS_ENTRY', node_code: 'N_SY_LOTUS_ENTRY', last_segment_code: codes.at(-1),
      source: 'SHIDAYUAN-core-endpoint-interpretation/2026-11-24/v1',
    };
    const page = mount(await compiledPage(), reactive({ selectedRoute: r }));
    try {
      assert.match(text(page.root), /终点是登记休息点/);
      assert.match(text(page.root), /登记路线前方无已标注中途休息点/);
      if (nodes.at(-1) === 'N_SY_LOTUS_ENTRY') assert.match(text(page.root), /只到荷塘入口，不到内侧平台或座椅/);
    } finally { page.app.unmount(); }
  }
});
