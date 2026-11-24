<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import RouteCard from '../components/RouteCard.vue';
import EvidenceGallery from '../components/EvidenceGallery.vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';
import { comparisonSummary, registeredRouteFacts, referenceBlockedSegments } from '../utils/routeComparison.js';

const props = defineProps({
  routes: { type: Array, default: () => [] },
  selectedRouteIndex: { type: Number, default: 0 },
  selectedRoute: { type: Object, default: null },
  avoidedSegments: { type: Array, default: () => [] },
  mapFeatures: { type: Array, default: () => [] },
  pilotArea: { type: Object, default: null },
  mapFailure: { type: String, default: '' },
  mapRetrying: Boolean,
  mapLoading: Boolean,
  selectedSegmentCode: { type: String, default: null },
  apiBaseUrl: { type: String, required: true },
  errorMessage: { type: String, default: '' },
  actionStatus: { type: String, default: '' },
  comparisonAvailable: Boolean,
  comparisonState: { type: String, default: 'idle' },
  comparisonError: { type: String, default: '' },
  walkingReference: { type: Object, default: null },
  profileLabel: { type: String, default: '' },
});

const emit = defineEmits([
  'select-route', 'select-segment', 'open-conditions', 'start-navigation',
  'retry-map', 'map-error', 'compare-walking',
]);
const isMobile = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
const currentFacts = computed(() => registeredRouteFacts(props.selectedRoute));
const walkingFacts = computed(() => registeredRouteFacts(props.walkingReference));
const comparisonText = computed(() => comparisonSummary(props.selectedRoute, props.walkingReference));
const referenceBlocked = computed(() => referenceBlockedSegments(props.avoidedSegments, props.walkingReference));
const comparisonMetrics = [['distance', '距离'], ['width', '登记最窄路宽'], ['slope', '登记最大坡度'], ['steps', '登记台阶总数']];

const routeSegmentCodes = computed(() => new Set(props.selectedRoute?.segment_codes ?? []));
const roadFeatures = computed(() => props.mapFeatures.filter((feature) => feature.properties?.kind === 'segment'));
const selectedEvidenceFeature = computed(() => roadFeatures.value.find(
  (feature) => feature.properties.segment_code === props.selectedSegmentCode
) ?? null);
const routeEvidenceFeatures = computed(() => {
  const featuresByCode = new Map(roadFeatures.value.map((feature) => [feature.properties.segment_code, feature]));
  return (props.selectedRoute?.segment_codes ?? []).map((code) => featuresByCode.get(code)).filter(Boolean);
});

function updateViewportMode() {
  isMobile.value = window.matchMedia('(max-width: 767px)').matches;
}

onMounted(() => window.addEventListener('resize', updateViewportMode, { passive: true }));
onBeforeUnmount(() => window.removeEventListener('resize', updateViewportMode));
</script>

<template>
  <main class="workspace-grid route-workspace route-options-workspace">
    <section class="routes-panel route-options-list" aria-live="polite">
      <header class="route-page-intro">
        <p class="section-kicker">路线方案</p>
        <h1>请选择适合您的路线</h1>
        <p>先比较路程和沿途情况，确认后再开始导航。</p>
      </header>

      <p v-if="errorMessage" class="error-line" role="alert">{{ errorMessage }}</p>
      <p class="status-line" aria-live="polite">{{ actionStatus }}</p>

      <div v-if="routes.length" class="route-candidates-panel">
        <RouteCard
          v-for="(route, index) in routes"
          :key="`${route.rank}-${route.route_score}`"
          :route="route"
          :selected="selectedRouteIndex === index"
          :selected-segment-code="selectedSegmentCode"
          @select="emit('select-route', index)"
          @select-segment="emit('select-segment', $event)"
        />
      </div>
      <div v-else class="empty-state">
        <span>暂时没有可显示的路线方案。</span>
        <strong>您可以返回修改起点、目的地或出行条件。</strong>
      </div>

      <section v-if="comparisonAvailable && selectedRoute" class="route-comparison" aria-label="适老路线对比">
        <h2>为什么推荐这样走？</h2>
        <p>看看当前{{ profileLabel || '出行画像' }}所选路线与同一起终点的普通步行参考有什么不同。</p>
        <button class="secondary-action" type="button" :disabled="comparisonState === 'loading'" @click="emit('compare-walking')">
          {{ comparisonState === 'loading' ? '正在获取普通步行参考…' : comparisonState === 'idle' ? '查看路线对比' : '重新获取对比' }}
        </button>
        <p v-if="comparisonError" role="status">{{ comparisonError }}</p>
        <div v-if="comparisonState === 'ready' || comparisonState === 'empty'" aria-live="polite">
          <p class="comparison-summary">{{ comparisonText }}</p>
          <p class="comparison-warning">普通步行参考，不可用于当前辅助设备导航。</p>
          <table v-if="walkingReference">
            <caption>同一起终点，本次候选的登记数据对照</caption>
            <thead><tr><th scope="col">指标</th><th scope="col">当前所选路线</th><th scope="col">普通步行参考</th></tr></thead>
            <tbody><tr v-for="[key, label] in comparisonMetrics" :key="key"><th scope="row">{{ label }}</th><td>{{ currentFacts[key] }}</td><td>{{ walkingFacts[key] }}</td></tr></tbody>
          </table>
          <template v-if="walkingReference">
            <h3>接口返回的参考路段排除理由</h3>
            <ul v-if="referenceBlocked.length" class="reference-blocked">
              <li v-for="segment in referenceBlocked" :key="segment.segment_code"><strong>{{ segment.name || segment.segment_code }}</strong><ul><li v-for="reason in segment.reasons" :key="reason">{{ reason }}</li></ul></li>
            </ul>
            <p v-else>接口未返回可归因到此参考路线的排除原因。这不表示参考路线适用于当前辅助设备，也不表示没有障碍。</p>
          </template>
          <p>参考仅为本次普通步行、最短距离策略返回候选中距离最短的一条，不代表全局最短。此表不能单独证明推荐绕行的原因，部分指标也可能更大。</p>
          <p>数据来自路段登记：路宽取最窄值、坡度取最大值、台阶数合计。任一路段缺少指标则显示“未记录”，不是零。登记数据不保证当前现场通行安全，请核对实际路况。</p>
        </div>
      </section>

      <section v-if="avoidedSegments.length" class="avoidance-panel" aria-label="需要注意的路段">
        <h2>路线风险提示</h2>
        <article v-for="segment in avoidedSegments.slice(0, 8)" :key="segment.segment_code" class="avoidance-card">
          <strong>{{ segment.name || segment.segment_code }}</strong>
          <ul><li v-for="reason in segment.reasons" :key="reason">{{ reason }}</li></ul>
        </article>
      </section>

      <EvidenceGallery
        v-if="selectedRoute"
        :feature="selectedEvidenceFeature"
        :route-features="routeEvidenceFeatures"
        :api-base-url="apiBaseUrl"
        @select-segment="emit('select-segment', $event)"
      />

      <div class="route-options-actions">
        <button class="secondary-action" type="button" @click="emit('open-conditions')">修改出行条件</button>
        <button class="primary-action" type="button" :disabled="!selectedRoute" @click="emit('start-navigation')">开始导航</button>
      </div>
    </section>

    <details class="routes-panel route-options-map-panel" :open="!isMobile" aria-label="路线地图与文字指引">
      <summary>路线地图与文字指引</summary>
      <div class="route-options-map-content">
      <p class="section-kicker">路线地图</p>
      <p v-if="mapFailure" class="map-fallback-notice" role="status">
        <span>{{ mapFailure }}，文字路线仍可使用。</span>
        <button type="button" :disabled="mapRetrying" @click="emit('retry-map')">{{ mapRetrying ? '重试中…' : '重试地图' }}</button>
      </p>
      <p v-else-if="mapLoading" class="map-fallback-notice" role="status">地图数据加载中…</p>
      <AmapRouteMap
        v-if="pilotArea && !mapFailure"
        :area="pilotArea"
        :features="mapFeatures"
        :route-segment-codes="routeSegmentCodes"
        :selected-segment-code="selectedSegmentCode"
        @select-segment="emit('select-segment', $event)"
        @map-error="emit('map-error', $event)"
      />
      <FallbackRouteMap
        v-else
        :features="mapFeatures"
        :route-segment-codes="routeSegmentCodes"
        :selected-segment-code="selectedSegmentCode"
        @select-segment="emit('select-segment', $event)"
      />
      <section v-if="selectedRoute" class="route-text-directions" aria-label="路线文字指引">
        <h2>沿途指引</h2>
        <ol>
          <li v-for="segment in selectedRoute.segments ?? []" :key="segment.segment_code">
            <strong>{{ segment.name }}</strong>
            <span>{{ segment.explanation }}</span>
            <span v-if="segment.step_count > 0" class="route-direction-warning">前方有 {{ segment.step_count }} 级台阶</span>
          </li>
        </ol>
      </section>
      </div>
    </details>
  </main>
</template>

<style scoped>
.route-comparison { margin: 18px 0; padding: 18px; border: 1px solid #b7ccc0; border-left: 5px solid #427459; border-radius: 10px; background: #f3f8f4; color: #203c2b; line-height: 1.7; }
.route-comparison h2 { margin: 0; font-size: 1.2rem; }
.route-comparison p { margin: 12px 0; }
.route-comparison .comparison-summary { font-size: 1.12rem; font-weight: 750; }
.route-comparison .comparison-warning { color: #794714; font-weight: 700; }
.route-comparison table { width: 100%; border-collapse: collapse; table-layout: fixed; background: white; }
.route-comparison caption { text-align: left; padding: 8px 0; }
.route-comparison th, .route-comparison td { padding: 10px 7px; border-bottom: 1px solid #cfdbd2; text-align: left; overflow-wrap: anywhere; }
.route-comparison thead th { background: #e5efe7; }
.route-comparison button { min-height: 48px; white-space: normal; }
.route-comparison button:focus-visible { outline: 3px solid #916322; outline-offset: 3px; }
.reference-blocked { padding-left: 22px; }
@media (max-width: 480px) { .route-comparison { padding: 14px; } .route-comparison th, .route-comparison td { padding: 10px 5px; } }
.route-options-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 18px; }
.route-options-map-panel { align-self: start; min-width: 0; }
.route-options-map-panel > summary { display: none; }
.route-options-map-content { display: grid; gap: 12px; }
.route-text-directions ol { display: grid; gap: 12px; padding-left: 24px; }
.route-text-directions li { display: grid; gap: 5px; line-height: 1.5; }
.route-direction-warning { color: #8b4a16; font-weight: 700; }
@media (max-width: 680px) {
  .route-options-actions { grid-template-columns: 1fr; }
}
@media (max-width: 767px) {
  .route-options-map-panel > summary {
    display: flex;
    min-height: 48px;
    align-items: center;
    padding: 0.75rem 1rem;
    color: var(--color-blue, #286887);
    font-size: 1.0625rem;
    font-weight: 700;
    cursor: pointer;
  }
  .route-options-map-panel[open] > summary { border-bottom: 1px solid #d8e1e6; }
  .route-options-map-content { padding: 1rem; }
}
</style>
