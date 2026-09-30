<script setup>
import { computed, ref } from 'vue';
import CollectionReviewTable from '../components/CollectionReviewTable.vue';

const props = defineProps({ users: { type: Array, default: () => [] }, pendingRecords: { type: Array, default: () => [] }, collectionSegments: { type: Array, default: () => [] }, auditLoadingIds: { type: Set, default: () => new Set() } });
const emit = defineEmits(['audit', 'logout', 'update-user-status', 'open-collect', 'open-survey-placement']);
const tab = ref('dashboard');
const keyword = ref('');
const segments = ref([{ code: 'S-001', name: '大学城西路入口段', slope: 4, surface: 4, safety: 4, accessible: 4, facility: 3, status: '已发布' }]);
const filteredUsers = computed(() => props.users.filter((user) => `${user.nickname}${user.account}${user.phone}${user.role}`.includes(keyword.value)));
const elderCount = computed(() => props.users.filter((user) => user.role === 'elder').length);
const familyCount = computed(() => props.users.filter((user) => user.role === 'family').length);
const roleName = (role) => ({ elder: '老人', family: '家属', admin: '管理员' }[role] ?? role);
const statusName = (status) => status === 'ACTIVE' ? '正常' : '停用';
function addSegment() { segments.value.unshift({ code: `S-${String(segments.value.length + 1).padStart(3, '0')}`, name: '新建步行路段', slope: 3, surface: 3, safety: 3, accessible: 3, facility: 3, status: '草稿' }); }
</script>
<template>
  <section class="admin-page">
    <aside class="admin-sidebar"><div class="admin-brand">助老地图<br><strong>管理后台</strong></div><button :class="{ active: tab === 'dashboard' }" @click="tab='dashboard'">控制面板</button><button :class="{ active: tab === 'users' }" @click="tab='users'">用户与权限</button><button :class="{ active: tab === 'segments' }" @click="tab='segments'">路段数据</button><button :class="{ active: tab === 'collections' }" @click="tab='collections'">采集管理</button><button :class="{ active: tab === 'survey' }" @click="tab='survey'">踩点定位</button><button class="admin-logout" @click="$emit('logout')">退出后台</button></aside>
    <main class="admin-main">
      <header><div><p class="section-kicker">运营管理</p><h1>{{ tab === 'dashboard' ? '控制面板' : tab === 'users' ? '用户与权限' : tab === 'segments' ? '路段数据管理' : tab === 'survey' ? '踩点资料定位' : '采集管理' }}</h1></div><span class="admin-role">系统管理员</span></header>
      <template v-if="tab === 'dashboard'"><div class="admin-stats"><article><span>老人账号</span><strong>{{ elderCount }}</strong></article><article><span>家属账号</span><strong>{{ familyCount }}</strong></article><article><span>待审核采集</span><strong>{{ pendingRecords.length }}</strong></article><article><span>路段数据</span><strong>{{ segments.length }}</strong></article></div><section class="admin-card"><h2>数据库账户概览</h2><p>老人、家属和管理员均读取同一套 app_user 账户数据。管理员可在“用户与权限”中查询及启停账户。</p></section></template>
      <template v-else-if="tab === 'users'"><section class="admin-card"><div class="admin-toolbar"><input v-model="keyword" placeholder="搜索昵称、数字账号或手机号" /></div><table><thead><tr><th>昵称</th><th>账号</th><th>角色</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="user in filteredUsers" :key="user.id"><td>{{ user.nickname }}</td><td>{{ user.account }}</td><td>{{ roleName(user.role) }}</td><td>{{ user.phone || '—' }}</td><td><span :class="['status-tag', user.status === 'ACTIVE' ? 'ok' : 'off']">{{ statusName(user.status) }}</span></td><td><button v-if="user.role !== 'admin'" @click="$emit('update-user-status', { id: user.id, status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })">{{ user.status === 'ACTIVE' ? '停用' : '启用' }}</button></td></tr></tbody></table></section></template>
      <template v-else-if="tab === 'segments'"><section class="admin-card"><div class="admin-toolbar"><p>路段评分使用 1–5 级标准；现场采集审核通过后可用于路段数据维护。</p><button @click="addSegment">新增路段</button></div><table><thead><tr><th>编号/名称</th><th>坡度</th><th>平整</th><th>安全</th><th>无障碍</th><th>设施</th><th>状态</th></tr></thead><tbody><tr v-for="segment in segments" :key="segment.code"><td>{{ segment.code }}<br>{{ segment.name }}</td><td>{{ segment.slope }}</td><td>{{ segment.surface }}</td><td>{{ segment.safety }}</td><td>{{ segment.accessible }}</td><td>{{ segment.facility }}</td><td>{{ segment.status }}</td></tr></tbody></table></section></template>
      <template v-else-if="tab === 'collections'"><section class="admin-card"><div class="admin-toolbar"><p>老人端不再显示采集入口；路段现场采集统一由管理员完成。</p><button @click="$emit('open-collect')">进入现场采集</button></div><CollectionReviewTable :records="pendingRecords" :loading-ids="auditLoadingIds" @audit="$emit('audit', $event)" /></section></template>
      <template v-else><section class="admin-card"><h2>补充踩点资料位置</h2><p>对照现场照片与地图截图，将待定位资料放到地图上。落点只补充位置，不会审核资料或参与路线推荐。</p><button class="primary-action" type="button" @click="$emit('open-survey-placement')">打开踩点位置工作台</button></section></template>
    </main>
  </section>
</template>

<style scoped>
.admin-page {
  --admin-ink: #203747;
  --admin-blue: #286887;
  --admin-line: #d8e3e9;
  --admin-canvas: #f3f6f8;
  min-height: 100vh;
  min-width: 0;
  grid-template-columns: minmax(208px, 248px) minmax(0, 1fr);
  color: var(--admin-ink);
  background: var(--admin-canvas);
}

.admin-sidebar {
  position: sticky;
  top: 0;
  min-height: 100vh;
  align-content: start;
  gap: 8px;
  padding: 28px 18px;
  background: var(--admin-ink);
}

.admin-brand {
  margin: 2px 8px 28px;
  color: #c1d6e0;
  font-size: 15px;
}

.admin-brand strong { font-size: 23px; }

.admin-sidebar button {
  min-height: 50px;
  border: 1px solid transparent;
  border-radius: 10px;
  padding-inline: 14px;
  font-size: 15px;
  transition: background-color 140ms ease, color 140ms ease;
}

.admin-sidebar button.active,
.admin-sidebar button:hover {
  color: var(--admin-ink);
  background: #e5eff3;
}

.admin-sidebar button:focus-visible,
.admin-page button:focus-visible,
.admin-page input:focus-visible {
  outline: 3px solid #73b6d1;
  outline-offset: 2px;
}

.admin-sidebar .admin-logout {
  margin-top: 24px;
  border-color: #527183;
}

.admin-main {
  width: min(100%, 1480px);
  min-width: 0;
  margin-inline: auto;
  padding: clamp(22px, 3vw, 44px);
}

.admin-main > header {
  min-height: 72px;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--admin-line);
}

.admin-main h1 {
  color: var(--admin-ink);
  font-size: clamp(26px, 2.4vw, 34px);
  letter-spacing: -0.025em;
}

.admin-role {
  color: #285c73;
  background: #e2eef3;
}

.admin-stats { gap: 16px; }

.admin-stats article,
.admin-card {
  min-width: 0;
  border: 1px solid var(--admin-line);
  border-radius: 14px;
  box-shadow: 0 2px 8px rgb(32 55 71 / 5%);
}

.admin-stats article {
  min-height: 112px;
  padding: 20px;
}

.admin-stats strong {
  color: var(--admin-blue);
  font-size: 34px;
  line-height: 1;
}

.admin-card {
  margin-top: 20px;
  padding: clamp(18px, 2vw, 28px);
}

.admin-card h2 { margin-top: 0; color: var(--admin-ink); }

.admin-toolbar { flex-wrap: wrap; }
.admin-toolbar p { max-width: 70ch; line-height: 1.65; }

.admin-toolbar input {
  min-height: 48px;
  border-color: #b9cbd5;
  border-radius: 9px;
}

.admin-toolbar button,
.admin-card td button,
.collection-review button,
.admin-card > .primary-action {
  min-height: 48px;
  border: 1px solid var(--admin-blue);
  border-radius: 9px;
  padding: 10px 16px;
  color: var(--admin-blue);
  background: #fff;
  font-weight: 750;
  cursor: pointer;
}

.admin-toolbar button:hover,
.admin-card td button:hover,
.collection-review button:hover { background: #edf5f8; }

.admin-card table {
  width: 100%;
  min-width: 660px;
  border-collapse: collapse;
}

.admin-card th,
.admin-card td { padding: 13px 12px; }

.admin-card th {
  color: #425f70;
  background: #edf3f6;
  font-weight: 700;
  white-space: nowrap;
}

.admin-card td { overflow-wrap: anywhere; }

.status-tag { white-space: nowrap; }

.collection-review {
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px 14px;
  margin-top: 14px;
  padding: 16px;
  border: 1px solid #ecd9aa;
  border-left: 4px solid #c98b24;
  border-radius: 10px;
  background: #fffaf0;
}

.collection-review strong { overflow-wrap: anywhere; }
.collection-review p { grid-column: 1 / -1; line-height: 1.55; }
.collection-review button { margin: 0; }

.admin-empty {
  padding: 28px 16px;
  border: 1px dashed #c4d3db;
  border-radius: 10px;
  background: #f7fafb;
}

@media (max-width: 900px) {
  .admin-page { grid-template-columns: minmax(0, 1fr); }
  .admin-sidebar {
    position: sticky;
    z-index: 3;
    top: 0;
    min-height: 0;
    display: flex;
    overflow-x: auto;
    align-items: center;
    padding: 10px 14px;
    scrollbar-width: thin;
  }
  .admin-brand { display: none; }
  .admin-sidebar button { flex: 0 0 auto; min-height: 48px; white-space: nowrap; }
  .admin-sidebar .admin-logout { margin: 0 0 0 auto; }
  .admin-main { padding: 24px clamp(16px, 4vw, 32px); }
}

@media (max-width: 600px) {
  .admin-main { padding: 20px 14px 32px; }
  .admin-main > header { align-items: flex-start; gap: 12px; }
  .admin-role { flex: 0 0 auto; padding: 7px 10px; font-size: 13px; }
  .admin-stats { gap: 10px; }
  .admin-stats article { min-height: 96px; padding: 15px; }
  .admin-stats strong { font-size: 29px; }
  .admin-card { overflow-x: auto; }
  .admin-toolbar { align-items: stretch; }
  .admin-toolbar input,
  .admin-toolbar button { width: 100%; }
  .collection-review { grid-template-columns: minmax(0, 1fr) minmax(0, auto); }
  .collection-review strong,
  .collection-review span,
  .collection-review p { grid-column: 1 / -1; }
  .collection-review button { min-width: 92px; }
}

@media (prefers-reduced-motion: reduce) {
  .admin-sidebar button { transition: none; }
}
</style>
