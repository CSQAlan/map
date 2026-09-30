<script setup>
import { computed, ref } from 'vue';
import ElderStatusCard from '../components/ElderStatusCard.vue';
import FamilyAlertList from '../components/FamilyAlertList.vue';

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
    <header class="family-header family-refresh-header">
      <div><p class="section-kicker">家属关爱中心</p><h1>您好，{{ user?.nickname || user?.phone || '家属' }}</h1><p>查看已关联老人的导航状态与路线信息；当前不提供实时定位。</p></div>
      <div class="family-header-actions"><button class="family-security" type="button" @click="showAuthorization = true">已授权查看</button><button type="button" @click="$emit('manage-binding')">关联 / 更换老人</button><button type="button" @click="$emit('refresh')">刷新数据</button><button type="button" @click="$emit('logout')">退出登录</button></div>
    </header>
    <ElderStatusCard
      :elder-name="elderName"
      :account="monitor?.elder?.account || elder?.account || '—'"
      :is-navigating="isNavigating"
    />
    <div class="family-tabs" role="tablist" aria-label="家属监控信息"><button id="family-tab-live" role="tab" :aria-selected="activeTab === 'live'" :class="{ active: activeTab === 'live' }" type="button" @click="activeTab = 'live'">路线示意</button><button id="family-tab-route" role="tab" :aria-selected="activeTab === 'route'" :class="{ active: activeTab === 'route' }" type="button" @click="activeTab = 'route'">导航状态</button><button id="family-tab-alerts" role="tab" :aria-selected="activeTab === 'alerts'" :class="{ active: activeTab === 'alerts' }" type="button" @click="activeTab = 'alerts'">告警消息</button></div>
    <section v-if="activeTab === 'live'" class="family-content-card family-live-layout">
      <div class="family-map-placeholder family-live-map" role="img" aria-label="路线示意图，不显示老人实时位置"><div class="map-route-line" :class="{ inactive: !isNavigating }"></div><div class="family-route-label">路线示意 · 非实时定位</div><div class="map-landmark map-landmark-a">{{ navigation.start_name || '等待导航开始' }}</div><div class="map-landmark map-landmark-b">{{ navigation.end_name || '目的地' }}</div><small>{{ isNavigating ? '已同步导航状态；此图不含实时坐标' : '暂无共享中的导航路线' }}</small></div>
      <div class="family-kpis"><div><span>总路程</span><strong>{{ navigation.distance_m || 0 }} 米</strong></div><div><span>剩余路程</span><strong>{{ navigation.remaining_m || 0 }} 米</strong></div><div><span>预计到达</span><strong>{{ navigation.estimated_minutes || 0 }} 分钟</strong></div></div>
      <p class="privacy-note">数据来自已关联老人启动的导航；老人更换路线、重新导航或结束导航后，家属端会自动切换为最新状态。</p>
    </section>
    <section v-else-if="activeTab === 'route'" class="family-content-card"><p class="section-kicker">当前路线</p><h2>{{ navigation.end_name ? `前往 ${navigation.end_name}` : '等待老人开始导航' }}</h2><div class="route-monitor-row"><span>起点</span><strong>{{ navigation.start_name || '—' }}</strong></div><div class="route-monitor-row"><span>下一步</span><strong>{{ navigation.current_step || '暂无导航提示' }}</strong></div><div class="route-monitor-row"><span>路线说明</span><strong>{{ navigation.route_summary || '暂无路线数据' }}</strong></div></section>
    <FamilyAlertList v-else :alerts="alerts" />
    <div v-if="showAuthorization" class="authorization-backdrop" role="dialog" aria-modal="true">
      <section class="authorization-card">
        <button class="authorization-close" type="button" aria-label="关闭" @click="showAuthorization = false">×</button>
        <p class="section-kicker">授权信息</p><h2>已关联老人</h2>
        <dl><div><dt>老人昵称</dt><dd>{{ elderName }}</dd></div><div><dt>数字账号</dt><dd>{{ monitor?.elder?.account || elder?.account || '—' }}</dd></div><div><dt>关联状态</dt><dd>已授权 · 有效</dd></div></dl>
        <p>您可以查看该老人的导航路线、预计到达时间及紧急告警；当前不提供实时定位，也不能修改老人端的导航路线或个人资料。</p>
        <button class="secondary-action" type="button" @click="$emit('manage-binding'); showAuthorization = false">关联 / 更换老人</button>
      </section>
    </div>
  </section>
</template>

<style scoped>
.family-refresh-header h1 {
  color: var(--color-ink);
  font-size: clamp(1.65rem, 3vw, 2.15rem);
  line-height: 1.2;
}

.family-header-actions {
  flex-wrap: wrap;
}

.family-header-actions button {
  min-height: var(--target-min);
  padding: 0.625rem 0.875rem;
  border: 1px solid #cbd9e0;
  border-radius: var(--radius-control);
  color: var(--color-ink);
  background: var(--color-paper);
  font-weight: 650;
}

.family-header-actions button:hover {
  border-color: var(--color-blue);
  color: var(--color-blue);
  background: var(--color-blue-soft);
}

.family-header-actions .family-security {
  border-color: #c7ddd2;
  color: var(--color-success);
  background: var(--color-success-soft);
}

.family-elder-card,
.family-content-card {
  border: var(--border-subtle);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
  box-shadow: var(--shadow);
}

.family-tabs button {
  min-height: var(--target-comfortable);
  border: 1px solid transparent;
  color: #4c626f;
  background: #eaf0f3;
}

.family-tabs button.active {
  color: var(--color-paper);
  background: var(--color-blue);
}

.family-map-placeholder {
  background: linear-gradient(140deg, #dce9ed, #b8d0d9);
  color: var(--color-ink);
}

.family-map-placeholder small {
  color: #405b69;
}

.family-route-label {
  position: absolute;
  top: 1rem;
  left: 1rem;
  border: 1px solid #b7cbd4;
  border-radius: 999px;
  padding: 0.375rem 0.75rem;
  color: #203747;
  background: #ffffffeb;
  font-weight: 700;
}

.family-alert {
  border: 1px solid #ead4b8;
  color: #6f4a1e;
  background: var(--color-warning-soft);
}

.authorization-card {
  border: var(--border-subtle);
  border-radius: var(--radius-surface);
  background: var(--color-paper);
}

@media (max-width: 48rem) {
  .family-refresh-header,
  .family-elder-card {
    align-items: stretch;
    flex-direction: column;
  }

  .family-header-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .family-header-actions button {
    min-width: 0;
  }
}
</style>
