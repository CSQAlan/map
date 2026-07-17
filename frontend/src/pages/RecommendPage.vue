<script setup>
import { computed, ref } from 'vue';
import StrategySelector from '../components/StrategySelector.vue';
import LocationInput from '../components/LocationInput.vue';
import RouteCard from '../components/RouteCard.vue';
import EvidenceGallery from '../components/EvidenceGallery.vue';

const props = defineProps({
  mobilityType: String, routeStrategy: String, startName: String, endName: String,
  startOptions: { type: Array, default: () => [] }, endOptions: { type: Array, default: () => [] },
  profileOptions: { type: Array, default: () => [] }, strategyOptions: { type: Array, default: () => [] },
  routes: { type: Array, default: () => [] }, avoidedSegments: { type: Array, default: () => [] },
  selectedRouteIndex: Number, loading: Boolean, errorMessage: String, actionStatus: String,
  mapFeatures: { type: Array, default: () => [] }, selectedSegmentCode: String,
  diagnosticSuggestions: { type: Array, default: () => [] }, diagnosticsLoading: Boolean, apiBaseUrl: String,
});
const emit = defineEmits(['update:mobilityType', 'update:routeStrategy', 'update:startName', 'update:endName', 'fetch-routes', 'start-navigation', 'select-route', 'select-strategy', 'select-segment']);
const activeDetailTab = ref('evidence');
const selectedRoute = computed(() => props.routes[props.selectedRouteIndex] ?? null);
const selectedStrategy = computed(() => props.strategyOptions.find((item) => item.value === props.routeStrategy));
const roadFeatures = computed(() => props.mapFeatures.filter((feature) => feature.properties?.kind === 'segment'));
const selectedEvidenceFeature = computed(() => roadFeatures.value.find((feature) => feature.properties.segment_code === props.selectedSegmentCode) ?? null);
const routeEvidenceFeatures = computed(() => {
  const byCode = new Map(roadFeatures.value.map((feature) => [feature.properties.segment_code, feature]));
  return (selectedRoute.value?.segment_codes ?? []).map((code) => byCode.get(code)).filter(Boolean);
});
function priorityLabel(priority) { return priority === 'HIGH' ? '高优先级' : priority === 'MEDIUM' ? '中优先级' : '低优先级'; }
</script>

<template>
  <section class="workspace-grid route-workspace">
    <form class="control-panel" @submit.prevent="$emit('fetch-routes')">
      <div class="route-page-intro"><p class="section-kicker">路线方案</p><h1>修改地点与路线</h1><p>系统会根据老人画像优先计算适老路线。</p></div>
      <StrategySelector :model-value="routeStrategy" :options="strategyOptions" @update:model-value="$emit('select-strategy', $event)" />
      <p class="strategy-note">当前策略：{{ selectedStrategy?.label }}，{{ selectedStrategy?.hint }}</p>
      <LocationInput :model-value="startName" :options="startOptions" label="起点" icon="起" @update:model-value="$emit('update:startName', $event)" />
      <LocationInput :model-value="endName" :options="endOptions" label="终" icon="终" @update:model-value="$emit('update:endName', $event)" />
      <button class="primary-action" type="submit" :disabled="loading">{{ loading ? '正在计算…' : '生成适老路线' }}</button>
      <button class="secondary-action route-start-navigation" type="button" :disabled="loading || !routes.length" @click="$emit('start-navigation')">开始导航</button>
      <p class="status-line">{{ actionStatus }}</p><p v-if="errorMessage" class="error-line">{{ errorMessage }}</p>
    </form>

    <section class="routes-panel route-detail-panel" aria-live="polite">
      <div class="panel-heading"><p class="section-kicker">路线详情</p><h2>{{ selectedRoute ? `方案 ${selectedRouteIndex + 1}` : '等待生成路线' }}</h2></div>
      <div class="route-detail-tabs" role="tablist" aria-label="路线详情分类">
        <button :class="{ active: activeDetailTab === 'evidence' }" type="button" @click="activeDetailTab = 'evidence'">路线现场信息</button>
        <button :class="{ active: activeDetailTab === 'risk' }" type="button" @click="activeDetailTab = 'risk'">风险路段</button>
        <button :class="{ active: activeDetailTab === 'diagnosis' }" type="button" @click="activeDetailTab = 'diagnosis'">适老化诊断</button>
        <button :class="{ active: activeDetailTab === 'routes' }" type="button" @click="activeDetailTab = 'routes'">候选路线</button>
      </div>

      <section v-if="activeDetailTab === 'evidence' && selectedRoute" class="route-evidence-panel">
        <EvidenceGallery :feature="selectedEvidenceFeature" :route-features="routeEvidenceFeatures" :api-base-url="apiBaseUrl" @select-segment="$emit('select-segment', $event)" />
      </section>
      <section v-else-if="activeDetailTab === 'risk'" class="avoidance-panel">
        <p v-if="!avoidedSegments.length" class="diagnostics-empty">当前没有需要额外避开的路段。</p>
        <article v-for="segment in avoidedSegments" :key="segment.segment_code" class="avoidance-card">
          <div class="avoidance-card-top"><strong>{{ segment.name || segment.segment_code }}</strong><span :class="['avoidance-badge', segment.avoidance_level === 'BLOCKED' ? 'blocked' : 'high-risk']">{{ segment.avoidance_level === 'BLOCKED' ? '系统已避开' : '可通行但需注意' }}</span></div>
          <ul><li v-for="reason in segment.reasons" :key="`${segment.segment_code}-${reason}`">{{ reason }}</li></ul>
        </article>
      </section>
      <section v-else-if="activeDetailTab === 'diagnosis'" class="diagnostics-panel">
        <p v-if="diagnosticsLoading" class="diagnostics-empty">正在生成适老化诊断建议…</p>
        <p v-else-if="!diagnosticSuggestions.length" class="diagnostics-empty">暂未发现高优先级改造建议。</p>
        <article v-for="item in diagnosticSuggestions" :key="`${item.segment_code}-${item.issue_type}`" class="diagnostic-card">
          <div class="diagnostic-card-top"><strong>{{ item.segment_name || item.segment_code }}</strong><span :class="['diagnostic-priority', item.priority.toLowerCase()]">{{ priorityLabel(item.priority) }}</span></div>
          <p>{{ item.problem }}</p><strong class="diagnostic-suggestion">{{ item.suggestion }}</strong>
        </article>
      </section>
      <section v-else class="route-candidates-panel">
        <div v-if="!routes.length" class="empty-state"><span>请先生成路线。</span><strong>不同画像会得到不同路线排序。</strong></div>
        <RouteCard v-for="(route, index) in routes" :key="`${route.rank}-${route.route_score}`" :route="route" :selected="selectedRouteIndex === index" :selected-segment-code="selectedSegmentCode" @select="$emit('select-route', index)" @select-segment="$emit('select-segment', $event)" />
      </section>
    </section>
  </section>
</template>
