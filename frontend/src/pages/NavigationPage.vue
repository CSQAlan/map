<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';

const props = defineProps({
  routes: { type: Array, default: () => [] }, selectedRouteIndex: { type: Number, default: 0 }, selectedRoute: Object,
  selectedProfile: Object, mapFeatures: { type: Array, default: () => [] }, pilotArea: Object, mapFailure: String,
  mapRetrying: Boolean, selectedSegmentCode: String, sosSubmitting: Boolean,
});
const emit = defineEmits(['select-route', 'open-routes', 'retry-map', 'select-segment', 'map-error', 'send-sos']);
const navigating = ref(false);
const routeSegmentCodes = computed(() => new Set(props.selectedRoute?.segment_codes ?? []));
function navigationText() {
  const segment = props.selectedRoute?.segments?.[0];
  if (!segment) return '请先选择一条路线。';
  const alerts = [];
  if (segment.step_count > 0) alerts.push(`前方有 ${segment.step_count} 级台阶，请注意脚下安全。`);
  if (segment.risk_tags?.length) alerts.push(`注意：${segment.risk_tags.join('、')}。`);
  return alerts.length ? `${segment.name}。${alerts.join('')}` : `请沿${segment.name}方向前进，注意观察周边。`;
}
function speak() {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const message = new SpeechSynthesisUtterance(navigationText());
  message.lang = 'zh-CN'; message.rate = 0.82;
  window.speechSynthesis.speak(message);
}
function startVoiceNavigation() { navigating.value = true; speak(); }
onBeforeUnmount(() => window.speechSynthesis?.cancel());
</script>

<template>
  <section class="navigation-page">
    <aside class="navigation-side-panel">
      <p class="section-kicker">正在为您导航</p>
      <h1>{{ selectedRoute ? `${selectedRoute.distance_m} 米 · 约 ${selectedRoute.estimated_minutes} 分钟` : '请选择路线' }}</h1>
      <p class="navigation-profile">已按{{ selectedProfile?.label || '当前出行情况' }}优先安排</p>
      <div class="navigation-route-options">
        <button v-for="(route, index) in routes" :key="`${route.rank}-${route.route_score}`" :class="{ selected: selectedRouteIndex === index }" type="button" @click="$emit('select-route', index)">
          <span>方案 {{ index + 1 }}</span><strong>{{ route.distance_m }} 米 · {{ route.estimated_minutes }} 分钟</strong><small>{{ route.summary }}</small>
        </button>
      </div>
      <div class="navigation-controls">
        <button class="navigation-start" type="button" @click="startVoiceNavigation">{{ navigating ? '导航已开始' : '开始语音导航' }}</button>
        <button class="navigation-repeat" type="button" @click="speak">播报提示</button>
        <button class="navigation-routes" type="button" @click="$emit('open-routes')">查看路线</button>
        <button class="navigation-sos" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')">紧急求助</button>
      </div>
      <p v-if="navigating" class="navigation-reminder">{{ navigationText() }}</p>
    </aside>
    <section class="navigation-map-panel" aria-label="当前规划路线地图">
      <AmapRouteMap v-if="pilotArea && !mapFailure" :area="pilotArea" :features="mapFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="selectedSegmentCode" @select-segment="$emit('select-segment', $event)" @map-error="$emit('map-error', $event)" />
      <div v-else><p class="map-fallback-notice"><span>{{ mapFailure || '正在准备地图…' }}</span><button type="button" :disabled="mapRetrying" @click="$emit('retry-map')">重试</button></p><FallbackRouteMap :features="mapFeatures" :route-segment-codes="routeSegmentCodes" :selected-segment-code="selectedSegmentCode" @select-segment="$emit('select-segment', $event)" /></div>
    </section>
  </section>
</template>
