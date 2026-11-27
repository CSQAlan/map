import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, reactive, nextTick } from 'vue';

const route = () => ({ distance_m: 100, segment_codes: ['a', 'b'], segments: [
  { segment_code: 'b', name: '合成第二路段', length_m: 50 },
  { segment_code: 'a', name: '合成首段', length_m: 50 },
] });
const photo = id => ({ photo_id: id, caption: `合成登记说明${id}`, risk_tags: [],
  thumbnail_url: `/media/evidence/thumb/${id}.webp`, display_url: `/media/evidence/display/${id}.webp` });
const registry = () => route().segments.map(row => ({ properties: { kind: 'segment', ...row,
  evidence_photos: [photo(`${row.segment_code}_first`), photo(`${row.segment_code}_second`)] } }));
const node = (type, text = '') => ({ type, text, children: [], props: {}, focus() {} });
const all = n => [n, ...n.children.flatMap(all)];
const text = n => n ? n.text + n.children.map(text).join('') : '';
let compiled;
async function component() {
  if (compiled) return compiled;
  const url = new URL('../src/components/PredepartureFirstLegPhoto.vue', import.meta.url);
  const code = compileScript(parse(await readFile(url, 'utf8')).descriptor,
    { id: 'predeparture-photo-test', inlineTemplate: true }).content
    .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
      `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
  compiled = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  return compiled;
}
async function mount(t, extra = {}) {
  const effects = { fetch: 0 }, events = [];
  t.mock.method(globalThis, 'fetch', () => { effects.fetch++; throw Error('unexpected service'); });
  const props = reactive({ routeSource: route(), mapFeatures: registry(), scope: 0,
    apiBaseUrl: 'http://127.0.0.1:8000', ...extra });
  const root = node('root'), visible = reactive({ value: true }), Page = await component();
  const renderer = createRenderer({ createElement: tag => node(tag), createText: value => node('#text', value),
    createComment: () => node('#comment'), setText(n, value) { n.text = value; },
    setElementText(n, value) { n.text = value; n.children = []; }, patchProp(n, key, old, value) { n.props[key] = value; },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1);
      n.parent = parent; const i = parent.children.indexOf(anchor);
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n);
    }, remove(n) { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); },
    parentNode: n => n.parent, nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] });
  const app = renderer.createApp({ render: () => visible.value ? h(Page, { ...props,
    onStartNavigation: e => events.push(e), onSelectSegment: e => events.push(e) }) : null });
  app.mount(root); t.after(() => app.unmount());
  const button = label => all(root).find(n => n.type === 'button' && text(n) === label);
  const find = id => all(root).find(n => n.props['data-testid'] === id);
  return { props, root, visible, effects, events, button, find,
    async click(label) { const b = button(label); assert.ok(b, label); await b.props.onClick(); await nextTick(); } };
}
test('explicit first-leg disclosure mounts at most one exact first photo and has no route or service effects', async t => {
  const p = await mount(t), before = JSON.stringify(p.props);
  assert.equal(all(p.root).filter(n => n.type === 'img').length, 0);
  await p.click('出发前看首段实景');
  assert.equal(p.button('出发前看首段实景').props['aria-expanded'], true);
  const image = p.find('predeparture-photo-image');
  assert.equal(image.props.src, 'http://127.0.0.1:8000/media/evidence/display/a_first.webp');
  assert.equal(image.props.referrerpolicy, 'no-referrer');
  assert.equal(all(p.root).filter(n => n.type === 'img').length, 1);
  assert.match(text(p.find('predeparture-photo-preview')), /合成首段/);
  assert.match(text(p.find('predeparture-photo-preview')), /登记照片，只用于认路，不代表现状或当前位置/);
  assert.equal(p.button('下一张'), undefined); assert.equal(p.button('下一段实景'), undefined);
  image.props.onLoad(); await nextTick();
  assert.doesNotMatch(text(p.root), /正在加载/);
  await p.click('关闭首段实景');
  assert.equal(p.find('predeparture-photo-image'), undefined);
  assert.equal(JSON.stringify(p.props), before); assert.deepEqual(p.events, []); assert.deepEqual(p.effects, { fetch: 0 });
});
for (const kind of ['missing', 'invalid', 'ambiguous', 'base']) test(`${kind}: no substitution from second segment or second photo`, async t => {
  const mapFeatures = registry();
  if (kind === 'missing') delete mapFeatures[1].properties.evidence_photos;
  if (kind === 'invalid') mapFeatures[1].properties.evidence_photos[0].display_url = 'https://invalid.test/a.webp';
  if (kind === 'ambiguous') mapFeatures.push(structuredClone(mapFeatures[1]));
  const p = await mount(t, { mapFeatures, ...(kind === 'base' ? { apiBaseUrl: '' } : {}) });
  await p.click('出发前看首段实景');
  assert.equal(p.find('predeparture-photo-image'), undefined);
  assert.match(text(p.find('predeparture-photo-preview')), /没有|未|不能/);
  assert.doesNotMatch(text(p.find('predeparture-photo-preview')), /合成第二路段|b_first|a_second/);
});
for (const [label, mutate] of [
  ['route', p => { p.props.routeSource = { ...route(), segment_codes: ['b', 'a'] }; }],
  ['route content', p => { p.props.routeSource.segments[0].name = '更改'; }],
  ['evidence', p => { p.props.mapFeatures[0].properties.evidence_photos[0].caption = '更改'; }],
  ['evidence replacement', p => { p.props.mapFeatures = registry(); }],
  ['scope', p => { p.props.scope++; }],
  ['base', p => { p.props.apiBaseUrl = 'http://127.0.0.1:9000'; }],
  ['provenance', p => { p.props.routeSource = null; }],
  ['leave/start', p => { p.visible.value = false; }],
]) test(`closing on ${label} ignores delayed old callbacks and never opens the new image`, async t => {
  const p = await mount(t); await p.click('出发前看首段实景');
  const old = p.find('predeparture-photo-image'); mutate(p); await nextTick();
  assert.equal(p.find('predeparture-photo-image'), undefined);
  old.props.onError(); old.props.onLoad(); await nextTick();
  assert.equal(p.find('predeparture-photo-image'), undefined);
  if (p.button('出发前看首段实景')) {
    await p.click('出发前看首段实景');
    const current = p.find('predeparture-photo-image');
    old.props.onError(); await nextTick();
    if (current) assert.equal(p.find('predeparture-photo-image'), current);
    assert.doesNotMatch(text(p.root), /加载失败/);
  }
});
test('load failure preserves registered caption, requests no alternate image, and stale error cannot affect reopening', async t => {
  const p = await mount(t); await p.click('出发前看首段实景');
  const old = p.find('predeparture-photo-image'); old.props.onError(); await nextTick();
  assert.match(text(p.root), /加载失败/); assert.match(text(p.root), /合成登记说明a_first/);
  assert.equal(all(p.root).filter(n => n.type === 'img').length, 0);
  await p.click('关闭首段实景'); await p.click('出发前看首段实景');
  const current = p.find('predeparture-photo-image'); old.props.onError(); old.props.onLoad(); await nextTick();
  assert.equal(p.find('predeparture-photo-image'), current);
  current.props.onLoad(); await nextTick(); assert.doesNotMatch(text(p.root), /加载失败|正在加载/);
});
test('no proven route means no disclosure or image node', async t => {
  const p = await mount(t, { routeSource: null });
  assert.equal(p.button('出发前看首段实景'), undefined);
  assert.equal(all(p.root).filter(n => n.type === 'img').length, 0);
});
test('real registration index sample resolves its first exact record without opening original media', async t => {
  const segments = JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/core_segments.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../../backend/app/db/seed_data/photo_manifest.json', import.meta.url), 'utf8'));
  const row = segments.find(s => s.segment_code === 'S_SY_GATE_TO_MAIN');
  assert.equal(segments.filter(s => s.segment_code === row.segment_code).length, 1);
  const photos = row.evidence_photo_refs.map(name => {
    const matches = manifest.filter(p => p.original_name === name); assert.equal(matches.length, 1);
    const { photo_id, caption, risk_tags } = matches[0];
    return { photo_id, caption, risk_tags, thumbnail_url: `/media/evidence/thumb/${photo_id}.webp`,
      display_url: `/media/evidence/display/${photo_id}.webp` };
  });
  const p = await mount(t, { routeSource: { distance_m: row.length_m, segment_codes: [row.segment_code], segments: [row] },
    mapFeatures: [{ properties: { ...row, kind: 'segment', evidence_photos: photos } }] });
  await p.click('出发前看首段实景');
  assert.equal(p.find('predeparture-photo-image').props.src,
    'http://127.0.0.1:8000/media/evidence/display/SY_IMG_9499.webp');
  assert.match(text(p.root), /师大苑内部主路入口段/);
  assert.match(text(p.root), /不代表现状或当前位置/);
});
