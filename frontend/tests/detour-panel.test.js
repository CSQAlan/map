import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

// Real panel, synthetic props only; no server, GPS, storage or HTTP.
const url = new URL('../src/pages/DetourJourneyPanel.vue', import.meta.url);
const source = await readFile(url, 'utf8');
const code = compileScript(parse(source).descriptor, { id: 'detour-panel-test', inlineTemplate: true }).content
  .replace(/from (['"])([^'"]+)\1/g, (_, quote, specifier) =>
    `from '${specifier === 'vue' ? import.meta.resolve('vue') : new URL(specifier, url).href}'`);
const { default: Panel } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const session = { name: '合成排除路', endName: '合成终点', mobilityType: 'WHEELCHAIR', strategy: 'BALANCED' };
const pending = { distance_m: 50, segments: [{ segment_code: 'alternative', name: '合成替代路' }] };
const render = props => renderToString(createSSRApp(Panel, { session, pending, candidates: [], message: '合成状态', ...props }));
const hint = html => html.match(/<p class="detour-next-step">([^<]*)<\/p>/)?.[1] || '';

for (const [phase, expected] of [
  ['paused', '下一步：点“从当前位置重新规划绕行”，获取当前位置。'],
  ['ready', '下一步：点“从当前位置重新规划绕行”，获取当前位置。'],
  ['confirm-start', '下一步：对照周围道路，选择实际所在路段，再点“确认此路段并查询绕行”。'],
  ['confirm-route', '下一步：核对下方新路线，确认后点“使用这条绕行路线”。'],
  ['locating', ''], ['matching', ''], ['planning', ''], ['active', ''], ['idle', ''], ['unknown', ''],
]) test(`${phase}: exactly the situational next instruction, with status preserved`, async () => {
  const html = await render({ phase });
  assert.equal(hint(html), expected);
  assert.equal((html.match(/class="detour-next-step"/g) || []).length, expected ? 1 : 0);
  assert.match(html, /合成状态/);
  if (phase === 'active') assert.doesNotMatch(html, /旧路线、语音和地图引导已暂停/);
  else assert.match(html, /旧路线、语音和地图引导已暂停/);
});

test('labels are supplied choices; missing and unknown options never expose session codes', async () => {
  const html = await render({ phase: 'paused', profileLabel: '轮椅老人', strategyLabel: '最安全' });
  assert.match(html, /出行选择：轮椅老人/);
  assert.match(html, /路线偏好：“最安全”/);
  assert.doesNotMatch(html, /WHEELCHAIR|BALANCED|本次内存行程/);
  assert.match(html, /仅在这次行程中绕开所选路段，不代表公共封路；刷新页面后不会恢复导航。/);
  for (const mobilityType of ['WHEELCHAIR', 'UNKNOWN_PROFILE']) {
    const unknown = await render({ phase: 'paused', session: { ...session, mobilityType, strategy: 'UNKNOWN_STRATEGY' } });
    assert.doesNotMatch(unknown, /WHEELCHAIR|UNKNOWN_PROFILE|UNKNOWN_STRATEGY|出行选择|路线偏好/);
    assert.match(unknown, /目的地：合成终点/);
  }
});

test('route review requires a pending route and retains registered distance wording', async () => {
  assert.equal(hint(await render({ phase: 'confirm-route', pending: null })), '');
  const html = await render({ phase: 'confirm-route' });
  assert.match(html, /最新候选登记全程 50 米，仍绕开 合成排除路，前往 合成终点。/);
  assert.match(html, /合成替代路/);
  for (const label of ['从当前位置重新规划绕行', '使用这条绕行路线', '取消本次绕行', '结束本次行程']) {
    assert.ok(html.includes(label), label);
  }
});
