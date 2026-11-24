import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';

test('family page hides cached names/accounts and preserves current-session binding UX', async () => {
  // No .env, listening HTTP server, real API, database or external map service.
  const server = await createServer({ configFile: false, envDir: false, plugins: [vue()],
    server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { default: FamilyPage } = await server.ssrLoadModule('/src/pages/FamilyPage.vue');
    const render = props => renderToString(createSSRApp(FamilyPage, props));
    const user = { role: 'family', nickname: '合成家属', boundElder: { nickname: '缓存旧老人', account: '旧账号999' }, bindingStatus: 'ACTIVE' };
    const cold = await render({ user });
    assert.match(cold, /尚未取得本次服务端关联确认/);
    assert.doesNotMatch(cold, /缓存旧老人|旧账号999|演示关联信息|已授权/);
    // This is the exact state retained after a cold-start request fails offline.
    const offline = await render({ user, elder: null, monitor: { navigation: { status: 'IDLE' } } });
    assert.doesNotMatch(offline, /缓存旧老人|旧账号999|演示关联信息/);
    const confirmed = { nickname: '本次绑定老人', account: '本次账号123' };
    const bound = await render({ user, elder: confirmed });
    assert.match(bound, /本次绑定老人/);
    assert.match(bound, /本次账号123/);
    assert.match(bound, /演示关联信息/);
    assert.doesNotMatch(bound, /缓存旧老人|旧账号999/);
    const monitored = await render({ user, monitor: { elder: confirmed, navigation: { status: 'IDLE' } } });
    assert.match(monitored, /本次绑定老人/);
    const denied = await render({ user, elder: confirmed, unavailable: '共享被拒绝' });
    assert.match(denied, /共享被拒绝/);
    assert.doesNotMatch(denied, /本次绑定老人|本次账号123|演示关联信息/);
  } finally { await server.close(); }
});
