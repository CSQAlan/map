<script setup>
import { computed, ref } from 'vue';

const props = defineProps({ users: { type: Array, default: () => [] }, pendingRecords: { type: Array, default: () => [] }, collectionSegments: { type: Array, default: () => [] } });
const emit = defineEmits(['audit', 'logout', 'update-user-status', 'open-collect']);
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
    <aside class="admin-sidebar"><div class="admin-brand">助老地图<br><strong>管理后台</strong></div><button :class="{ active: tab === 'dashboard' }" @click="tab='dashboard'">控制面板</button><button :class="{ active: tab === 'users' }" @click="tab='users'">用户与权限</button><button :class="{ active: tab === 'segments' }" @click="tab='segments'">路段数据</button><button :class="{ active: tab === 'collections' }" @click="tab='collections'">采集管理</button><button class="admin-logout" @click="$emit('logout')">退出后台</button></aside>
    <main class="admin-main">
      <header><div><p class="section-kicker">运营管理</p><h1>{{ tab === 'dashboard' ? '控制面板' : tab === 'users' ? '用户与权限' : tab === 'segments' ? '路段数据管理' : '采集管理' }}</h1></div><span class="admin-role">系统管理员</span></header>
      <template v-if="tab === 'dashboard'"><div class="admin-stats"><article><span>老人账号</span><strong>{{ elderCount }}</strong></article><article><span>家属账号</span><strong>{{ familyCount }}</strong></article><article><span>待审核采集</span><strong>{{ pendingRecords.length }}</strong></article><article><span>路段数据</span><strong>{{ segments.length }}</strong></article></div><section class="admin-card"><h2>数据库账户概览</h2><p>老人、家属和管理员均读取同一套 app_user 账户数据。管理员可在“用户与权限”中查询及启停账户。</p></section></template>
      <template v-else-if="tab === 'users'"><section class="admin-card"><div class="admin-toolbar"><input v-model="keyword" placeholder="搜索昵称、数字账号或手机号" /></div><table><thead><tr><th>昵称</th><th>账号</th><th>角色</th><th>手机号</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="user in filteredUsers" :key="user.id"><td>{{ user.nickname }}</td><td>{{ user.account }}</td><td>{{ roleName(user.role) }}</td><td>{{ user.phone || '—' }}</td><td><span :class="['status-tag', user.status === 'ACTIVE' ? 'ok' : 'off']">{{ statusName(user.status) }}</span></td><td><button v-if="user.role !== 'admin'" @click="$emit('update-user-status', { id: user.id, status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })">{{ user.status === 'ACTIVE' ? '停用' : '启用' }}</button></td></tr></tbody></table></section></template>
      <template v-else-if="tab === 'segments'"><section class="admin-card"><div class="admin-toolbar"><p>路段评分使用 1–5 级标准；现场采集审核通过后可用于路段数据维护。</p><button @click="addSegment">新增路段</button></div><table><thead><tr><th>编号/名称</th><th>坡度</th><th>平整</th><th>安全</th><th>无障碍</th><th>设施</th><th>状态</th></tr></thead><tbody><tr v-for="segment in segments" :key="segment.code"><td>{{ segment.code }}<br>{{ segment.name }}</td><td>{{ segment.slope }}</td><td>{{ segment.surface }}</td><td>{{ segment.safety }}</td><td>{{ segment.accessible }}</td><td>{{ segment.facility }}</td><td>{{ segment.status }}</td></tr></tbody></table></section></template>
      <template v-else><section class="admin-card"><div class="admin-toolbar"><p>老人端不再显示采集入口；路段现场采集统一由管理员完成。</p><button @click="$emit('open-collect')">进入现场采集</button></div><div v-if="!pendingRecords.length" class="admin-empty">暂无待审核采集记录</div><article v-for="record in pendingRecords" :key="record.id" class="collection-review"><strong>#{{ record.id }} · {{ record.segment_code }}</strong><span>采集人：{{ record.collector || '未填写' }}</span><p>{{ record.remark || '无备注' }}</p><button @click="$emit('audit', { record, result: 'APPROVED' })">通过</button><button @click="$emit('audit', { record, result: 'REJECTED' })">退回</button></article></section></template>
    </main>
  </section>
</template>
