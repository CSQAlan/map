<script setup>
import { computed, ref } from 'vue';

const props = defineProps({ user: Object, elder: Object, monitor: { type: Object, default: () => ({ navigation: { status: 'IDLE' } }) } });
const emit = defineEmits(['logout', 'refresh', 'manage-binding']);
const activeTab = ref('live');
const showAuthorization = ref(false);
const navigation = computed(() => props.monitor?.navigation || { status: 'IDLE' });
const alerts = computed(() => props.monitor?.alerts || []);
const elderName = computed(() => props.monitor?.elder?.nickname || props.elder?.nickname || props.elder?.realName || '已关联老人');
const isNavigating = computed(() => navigation.value.status === 'NAVIGATING');
</script>

<template>
  <section class="family-page desktop-family-page">
    <header class="family-header">
      <div><p class="section-kicker">家属关爱中心</p><h1>您好，{{ user?.nickname || user?.phone || '家属' }}</h1><p>仅显示您已关联老人的位置与导航状态。</p></div>
      <div class="family-header-actions"><button class="family-security" type="button" @click="showAuthorization = true">已授权查看</button><button type="button" @click="$emit('manage-binding')">关联 / 更换老人</button><button type="button" @click="$emit('refresh')">刷新数据</button><button type="button" @click="$emit('logout')">退出登录</button></div>
    </header>
    <section class="family-elder-card">
      <div><span class="family-avatar">护</span><div><strong>{{ elderName }}</strong><p><i :class="['online-dot', { offline: !isNavigating }] "></i> {{ isNavigating ? '导航中，数据每 5 秒同步' : '当前未开始导航' }}</p></div></div>
      <span class="binding-account">数字账号：{{ monitor?.elder?.account || elder?.account || '—' }}</span>
    </section>
    <div class="family-tabs" role="tablist"><button :class="{ active: activeTab === 'live' }" type="button" @click="activeTab = 'live'">实时位置</button><button :class="{ active: activeTab === 'route' }" type="button" @click="activeTab = 'route'">导航状态</button><button :class="{ active: activeTab === 'alerts' }" type="button" @click="activeTab = 'alerts'">告警消息</button></div>
    <section v-if="activeTab === 'live'" class="family-content-card family-live-layout">
      <div class="family-map-placeholder family-live-map"><div class="map-route-line" :class="{ inactive: !isNavigating }"></div><div class="family-location-cursor" aria-label="老人当前位置"><span>●</span><b>{{ elderName }}</b></div><div class="map-landmark map-landmark-a">{{ navigation.start_name || '等待导航开始' }}</div><div class="map-landmark map-landmark-b">{{ navigation.end_name || '目的地' }}</div><small>{{ isNavigating ? '根据老人端导航状态同步' : '暂无共享中的导航路线' }}</small></div>
      <div class="family-kpis"><div><span>总路程</span><strong>{{ navigation.distance_m || 0 }} 米</strong></div><div><span>剩余路程</span><strong>{{ navigation.remaining_m || 0 }} 米</strong></div><div><span>预计到达</span><strong>{{ navigation.estimated_minutes || 0 }} 分钟</strong></div></div>
      <p class="privacy-note">数据来自已关联老人启动的导航；老人更换路线、重新导航或结束导航后，家属端会自动切换为最新状态。</p>
    </section>
    <section v-else-if="activeTab === 'route'" class="family-content-card"><p class="section-kicker">当前路线</p><h2>{{ navigation.end_name ? `前往 ${navigation.end_name}` : '等待老人开始导航' }}</h2><div class="route-monitor-row"><span>起点</span><strong>{{ navigation.start_name || '—' }}</strong></div><div class="route-monitor-row"><span>下一步</span><strong>{{ navigation.current_step || '暂无导航提示' }}</strong></div><div class="route-monitor-row"><span>路线说明</span><strong>{{ navigation.route_summary || '暂无路线数据' }}</strong></div></section>
    <section v-else class="family-content-card"><p class="section-kicker">告警中心</p><h2>{{ alerts.length ? `收到 ${alerts.length} 条待处理告警` : '暂未收到新的紧急求助或异常停留告警' }}</h2><article v-for="alert in alerts" :key="alert.id" class="family-alert"><strong>{{ alert.event_type === 'SOS' ? '紧急求助' : alert.event_type }}</strong><p>{{ alert.description || '老人端已触发告警，请尽快联系老人。' }}</p><small>{{ alert.created_at || '刚刚' }}</small></article><p class="privacy-note">告警事件、关联对象及时间均由后端数据库记录，并只同步给已关联家属。</p></section>
    <div v-if="showAuthorization" class="authorization-backdrop" role="dialog" aria-modal="true">
      <section class="authorization-card">
        <button class="authorization-close" type="button" aria-label="关闭" @click="showAuthorization = false">×</button>
        <p class="section-kicker">授权信息</p><h2>已关联老人</h2>
        <dl><div><dt>老人昵称</dt><dd>{{ elderName }}</dd></div><div><dt>数字账号</dt><dd>{{ monitor?.elder?.account || elder?.account || '—' }}</dd></div><div><dt>关联状态</dt><dd>已授权 · 有效</dd></div></dl>
        <p>您可以查看该老人的实时位置、当前导航路线、预计到达时间及紧急告警；不能修改老人端的导航路线或个人资料。</p>
        <button class="secondary-action" type="button" @click="$emit('manage-binding'); showAuthorization = false">关联 / 更换老人</button>
      </section>
    </div>
  </section>
</template>
