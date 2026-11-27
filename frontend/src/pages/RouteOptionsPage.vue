<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import RouteCard from '../components/RouteCard.vue';
import EvidenceGallery from '../components/EvidenceGallery.vue';
import PredepartureFirstLegPhoto from '../components/PredepartureFirstLegPhoto.vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';
import { comparisonSummary, formatMetric, registeredRouteFacts, referenceBlockedSegments } from '../utils/routeComparison.js';
import { mapFeaturesForBottleneck, registeredRoadConditions } from '../utils/routeBottleneck.js';
import { WALKING_BUDGETS, walkingBudgetFacts } from '../utils/walkingBudget.js';
import { detourRestBudgetFacts } from '../utils/detourRestBudget.js';
import { arrivalBoundaryText } from '../utils/arrivalBoundary.js';

const props = defineProps({
  predepartureRouteSource: { type: Object, default: null },
  predepartureScope: { type: [Number, String], default: 0 },
  arrivalReceipt: { type: Object, default: null },
  returnDraft: { type: Object, default: null },
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
  restPreviewAvailable: Boolean,
  restPreviewState: { type: String, default: 'idle' },
  restPreview: { type: Object, default: null },
  exclusionOptions: { type: Array, default: () => [] },
  exclusionState: { type: String, default: 'idle' },
  exclusionPreview: { type: Object, default: null },
  canUseExclusion: Boolean,
  detourActive: Boolean,
});

const emit = defineEmits([
  'prepare-return',
  'select-route', 'select-segment', 'open-conditions', 'start-navigation',
  'retry-map', 'map-error', 'compare-walking',
  'preview-rest', 'clear-rest-preview',
  'preview-exclusion', 'clear-exclusion',
  'use-exclusion',
]);
const isMobile = ref(typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
const galleryOpen = ref(false);
const startingNavigation = ref(false);
watch([() => props.selectedRoute, () => props.predepartureScope, () => props.mapFeatures],
  () => { galleryOpen.value = false; }, { deep: true, flush: 'sync' });
function startSelectedNavigation() {
  startingNavigation.value = true;
  galleryOpen.value = false;
  emit('start-navigation');
}
const currentFacts = computed(() => registeredRouteFacts(props.selectedRoute));
const walkingFacts = computed(() => registeredRouteFacts(props.walkingReference));
const comparisonText = computed(() => comparisonSummary(props.selectedRoute, props.walkingReference));
const referenceBlocked = computed(() => referenceBlockedSegments(props.avoidedSegments, props.walkingReference));
const comparisonMetrics = [['distance', '距离'], ['width', '登记最窄路宽'], ['slope', '登记最大坡度'], ['steps', '登记台阶总数']];
const formatRegisteredWidth = value => value > 0 && value < 0.01 ? '不足 0.01' : formatMetric(value);
const restDifference = computed(() => {
  if (!props.restPreview) return '';
  const difference = Math.round((props.restPreview.distance_m - props.restPreview.baseline_distance_m) * 100) / 100;
  return difference === 0 ? '与默认首选登记距离相同（差值 0 米）'
    : `比默认首选${difference > 0 ? '长' : '短'} ${formatMetric(Math.abs(difference))} 米（差值 ${difference > 0 ? '+' : '−'}${formatMetric(Math.abs(difference))} 米）`;
});
const registeredSteps = value => Number.isInteger(value) && value >= 0 ? `${value} 级` : '未记录';
const continuousBudget = ref('');
const budgetFacts = computed(() => walkingBudgetFacts(props.restPreview, continuousBudget.value));
const detourBudgetFacts = computed(() => detourRestBudgetFacts(props.exclusionPreview, continuousBudget.value));
const detourOverLimitText = computed(() => {
  const interval = detourBudgetFacts.value?.candidate.firstOverLimit;
  if (!interval) return '';
  const excess = detourBudgetFacts.value.candidate.firstOverLimitExcess;
  return `候选首个超预算区间：${interval.from} → ${interval.to}，登记连续 ${formatMetric(interval.distance)} 米，超出 ${formatMetric(excess)} 米。`;
});
watch(() => props.restPreviewAvailable || props.exclusionOptions.length > 0,
  available => { if (!available) continuousBudget.value = ''; }, { flush: 'sync' });
const exclusionCode = ref('');
watch([() => props.selectedRoute, () => props.exclusionOptions], () => { exclusionCode.value = ''; }, { flush: 'sync' });
const exclusionDifference = computed(() => {
  const preview = props.exclusionPreview;
  if (!preview) return '';
  const delta = Math.round((preview.route.distance_m - preview.baselineDistance) * 100) / 100;
  return delta === 0 ? '较原所选路线登记距离不变（0 米）'
    : `较原所选路线${delta > 0 ? '增加' : '减少'} ${formatMetric(Math.abs(delta))} 米（${delta > 0 ? '+' : '−'}${formatMetric(Math.abs(delta))} 米）`;
});

const mapPanel = ref(null);
const focusedKind = ref(null);
let focusVersion = 0;

const bottlenecks = computed(() => {
  const row = (kind, label, route) => {
    const conditions = registeredRoadConditions(route);
    return { kind, label, facts: conditions.width, steps: conditions.steps };
  };
  const rows = [row('current', '当前所选路线', props.selectedRoute)];
  if (props.comparisonAvailable && props.comparisonState === 'ready' && props.walkingReference) {
    rows.push(row('reference', '普通步行参考', props.walkingReference));
  }
  return rows;
});
const focusedBottleneck = computed(() => bottlenecks.value.find(row => row.kind === focusedKind.value) ?? null);
const focusedSegment = computed(() => focusedBottleneck.value?.facts.segment ?? null);
const displayedMapFeatures = computed(() => mapFeaturesForBottleneck(props.mapFeatures, focusedSegment.value));
const displayedSelectedCode = computed(() => focusedSegment.value?.code ?? props.selectedSegmentCode);

function clearBottleneckFocus() {
  focusVersion += 1;
  focusedKind.value = null;
}
watch([
  () => props.selectedRoute, () => props.walkingReference,
  () => props.comparisonAvailable, () => props.comparisonState,
  () => props.selectedSegmentCode,
], clearBottleneckFocus, { flush: 'sync', deep: true });

async function locateBottleneck(kind) {
  if (!bottlenecks.value.find(row => row.kind === kind)?.facts.segment?.coordinates) return;
  const version = ++focusVersion;
  focusedKind.value = kind;
  if (mapPanel.value) mapPanel.value.open = true;
  await nextTick();
  if (version === focusVersion) mapPanel.value?.scrollIntoView?.({ block: 'nearest' });
}

function selectMapSegment(code) {
  clearBottleneckFocus();
  emit('select-segment', code);
}

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
onBeforeUnmount(() => emit('clear-rest-preview'));
onBeforeUnmount(() => emit('clear-exclusion'));
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
      <section v-if="arrivalReceipt && !detourActive" class="arrival-receipt" aria-labelledby="arrival-receipt-title" data-testid="arrival-receipt" tabindex="0">
        <h2 id="arrival-receipt-title">这次行程回执</h2>
        <p><strong>{{ arrivalReceipt.outcome === 'arrived' ? '我已到达（本人确认）' : '结束但未确认到达' }}</strong></p>
        <p>这次手动标记确认了 {{ arrivalReceipt.confirmed }} 段 / 共 {{ arrivalReceipt.total }} 段。</p>
        <p>仅记录您的手动选择，不代表实际经过或位置。未确认到达，不表示没有到达。段数与到达确认分别记录。</p>
        <p>仅本次页面内可见，不发送给家属；换路线、开始新行程、切换身份、离开路线页或刷新后清除。</p>
      </section>
      <p v-if="arrivalBoundaryText(selectedRoute)" class="status-line" aria-label="路线到达边界">{{ arrivalBoundaryText(selectedRoute) }}</p>

      <section v-if="returnDraft && !detourActive" class="return-journey" aria-labelledby="return-journey-title" data-testid="return-journey">
        <h2 id="return-journey-title">准备返程</h2>
        <p>拟定起点：{{ returnDraft.start }}<br>拟定目的地：{{ returnDraft.end }}</p>
        <p>请确认您确实位于所选起点，或先修改起点，再点击“查询适合的路线”。返程会重新查询，结果请确认后再开始导航。</p>
        <button class="secondary-action" type="button" @click="emit('prepare-return')">填入返程地点</button>
      </section>

      <div v-if="routes.length" class="route-candidates-panel">
        <RouteCard
          v-for="(route, index) in routes"
          :key="`${route.rank}-${route.route_score}`"
          :route="route"
          :selected="selectedRouteIndex === index"
          :selected-segment-code="selectedSegmentCode"
          @select="!detourActive && emit('select-route', index)"
          @select-segment="emit('select-segment', $event)"
        />
      </div>
      <div v-else class="empty-state">
        <span>{{ detourActive ? '绕行引导已暂停，原排除条件仍保留。' : '暂时没有可显示的路线方案。' }}</span>
        <strong>{{ detourActive ? '请在绕行面板重新定位并明确确认，不会显示旧路线。' : '您可以返回修改起点、目的地或出行条件。' }}</strong>
      </div>

      <PredepartureFirstLegPhoto v-if="predepartureRouteSource && !detourActive && !mapLoading && !mapRetrying && !startingNavigation"
        :route-source="predepartureRouteSource" :scope="predepartureScope" :map-features="mapFeatures"
        :api-base-url="apiBaseUrl" :pilot-area="pilotArea" />

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

      <label v-if="restPreviewAvailable || exclusionOptions.length" class="walking-budget-choice">出发前，您愿意连续走的最长距离（两种预览共用）
        <select v-model="continuousBudget" aria-label="连续步行预算">
          <option value="">请主动选择（可不设置）</option>
          <option v-for="budget in WALKING_BUDGETS" :key="budget" :value="budget">{{ budget }} 米</option>
        </select>
      </label>

      <section v-if="exclusionOptions.length" class="route-comparison" aria-label="本次避开路段预览">
        <h2>本次想避开哪一段？</h2>
        <label for="exclude-segment">从当前所选路线选择路段</label>
        <select id="exclude-segment" v-model="exclusionCode" @change="emit('clear-exclusion')">
          <option value="">请选择路段</option>
          <option v-for="segment in exclusionOptions" :key="segment.segment_code" :value="segment.segment_code">{{ segment.name }}</option>
        </select>
        <button type="button" class="secondary-action" :disabled="!exclusionCode || exclusionState === 'loading'" @click="emit('preview-exclusion', exclusionCode)">{{ exclusionState === 'loading' ? '正在查询…' : '本次避开此路段' }}</button>
        <div aria-live="polite">
          <p v-if="exclusionState === 'empty'">当前路网内，避开此路段后暂无符合相同出行条件的完整路线。</p>
          <p v-else-if="exclusionState === 'error'">暂未确认避开方案，可能请求失败或资料不足。请重试；未回退为原路线。</p>
          <template v-else-if="exclusionState === 'ready' && exclusionPreview">
            <h3>本次排除：{{ exclusionPreview.name }}</h3>
            <p>候选登记距离 {{ formatMetric(exclusionPreview.route.distance_m) }} 米；原所选 {{ formatMetric(exclusionPreview.baselineDistance) }} 米。</p>
            <p>{{ exclusionDifference }}</p>
            <p v-if="arrivalBoundaryText(exclusionPreview.route)">{{ arrivalBoundaryText(exclusionPreview.route) }}</p>
            <ol><li v-for="segment in exclusionPreview.route.segments" :key="segment.segment_code">{{ segment.name || segment.segment_code }}</li></ol>
            <section class="walking-budget-result" aria-label="绕行前后连续步行对比" data-testid="detour-rest-budget">
              <h3>绕行前后连续步行对比</h3>
              <template v-if="detourBudgetFacts">
                <p>同一命名起终点：{{ exclusionPreview.restBudgetEvidence.startName }} → {{ exclusionPreview.restBudgetEvidence.endName }}。</p>
                <dl>
                  <dt>原所选路线 · 最长连续登记步行：</dt><dd>{{ formatMetric(detourBudgetFacts.original.longest) }} 米</dd>
                  <dt>绕行候选 · 最长连续登记步行：</dt><dd>{{ formatMetric(detourBudgetFacts.candidate.longest) }} 米</dd>
                  <dt>登记全程（原所选 / 候选）</dt><dd>{{ formatMetric(detourBudgetFacts.original.total) }} 米 / {{ formatMetric(detourBudgetFacts.candidate.total) }} 米</dd>
                </dl>
                <p v-if="detourBudgetFacts.continuousDifference < 0">候选最长连续登记步行缩短 {{ formatMetric(-detourBudgetFacts.continuousDifference) }} 米。</p>
                <p v-else-if="detourBudgetFacts.continuousDifference > 0">候选最长连续登记步行增加 {{ formatMetric(detourBudgetFacts.continuousDifference) }} 米，连续步行距离没有改善。</p>
                <p v-else>候选最长连续登记步行相同，没有缩短。</p>
                <p v-if="detourBudgetFacts.candidate.meetsBudget === null">尚未设置预算，请主动选择后查看是否达标。</p>
                <template v-else>
                  <p>按 {{ continuousBudget }} 米预算：原所选路线{{ detourBudgetFacts.original.meetsBudget ? '未超过预算' : '超过预算' }}；绕行候选{{ detourBudgetFacts.candidate.meetsBudget ? '未超过预算' : '超过预算' }}。恰好等于预算也算未超过。</p>
                  <p v-if="detourOverLimitText" data-testid="detour-first-over-limit">{{ detourOverLimitText }}</p>
                </template>
              </template>
              <p v-else role="status">连续步行对比暂不可用：两条路线的起终点、登记长度或休息点资料尚未完整确认，无法判断最长连续步行距离。</p>
              <p>仅按各自路线登记中途休息点分段，起终点登记不拆分；明确登记无中途休息点时，按全程一段计算。登记点不保证有座位，也不保证适合休息；请核对实际条件。预算达标不代表路线更好或安全，不改变路线排序或导航。</p>
            </section>
            <button v-if="canUseExclusion" type="button" class="primary-action" @click="emit('use-exclusion')">使用这条绕行路线</button>
            <p v-else>候选资料不足或上下文未完整确认，暂不能启用绕行导航。</p>
          </template>
        </div>
        <p>确认前仅预览，不切换当前路线；资料不足时不提供此候选导航。普通导航仍使用原所选路线，可能包含该路段。只有明确使用合法最新候选才启用绕行，本次排除仅针对这一有向路段，不登记公共封路，也不保证现场安全。</p>
      </section>

      <section v-if="restPreviewAvailable" class="route-comparison" aria-label="途经休息点方案预览" data-testid="rest-preview">
        <h2>途中想找个休息点？</h2>
        <p>按同一起终点、慢行画像和策略，单独查看途经登记休息点的候选。</p>
        <button class="secondary-action" type="button" :disabled="restPreviewState === 'loading'" @click="emit('preview-rest')">{{ restPreviewState === 'loading' ? '正在查询休息点方案…' : '查看途经休息点方案' }}</button>
        <div aria-live="polite">
          <p v-if="restPreviewState === 'empty'">本次搜索候选中未找到兼容的途经休息点方案（仅本次有界搜索），不表示其他路线不存在。</p>
          <p v-else-if="restPreviewState === 'error'">休息点方案暂未确认，可能连接失败或资料不足。可重试，当前路线和导航不受影响。</p>
          <template v-else-if="restPreviewState === 'ready' && restPreview">
            <h3>途经 {{ restPreview.stop_name }}</h3>
            <p>登记全程 {{ formatMetric(restPreview.distance_m) }} 米；默认首选 {{ formatMetric(restPreview.baseline_distance_m) }} 米。</p>
            <p class="comparison-summary">{{ restDifference }}</p>
            <p>登记台阶：此方案 {{ registeredSteps(restPreview.steps) }}；默认首选 {{ registeredSteps(restPreview.baseline_steps) }}。未记录不是零。</p>
            <p v-if="restPreview.matches_baseline">默认首选本身已途经该登记休息点。</p>
            <ol aria-label="休息点方案的有序路段">
              <li v-for="(name, index) in restPreview.segment_names" :key="restPreview.segment_codes[index]">第 {{ index + 1 }} 段：{{ name }}<strong v-if="index === restPreview.stop_after_segment_index">；此段之后经过 {{ restPreview.stop_name }}</strong></li>
            </ol>
            <section class="walking-budget-result" aria-label="出发前连续步行预算" data-testid="walking-budget">
              <h3>分两段走，最长一段有多远？</h3>
              <template v-if="budgetFacts">
                <dl>
                  <dt>起点 → {{ restPreview.stop_name }}（登记中途休息点）</dt><dd>{{ formatMetric(budgetFacts.first) }} 米</dd>
                  <dt>{{ restPreview.stop_name }} → 目的地</dt><dd>{{ formatMetric(budgetFacts.second) }} 米</dd>
                  <dt>最长连续一段</dt><dd>{{ formatMetric(budgetFacts.longest) }} 米</dd>
                  <dt>此方案总距离</dt><dd>{{ formatMetric(budgetFacts.total) }} 米</dd>
                  <dt>同条件默认直达，不设中途停靠</dt><dd>{{ formatMetric(budgetFacts.baseline) }} 米连续走完</dd>
                </dl>
                <p v-if="budgetFacts.meetsBudget === null">尚未设置预算，请主动选择后查看是否达标。</p>
                <p v-else><strong>预算 {{ continuousBudget }} 米：{{ budgetFacts.meetsBudget ? '达标（最长一段不超过预算，等于也达标）' : '不达标（最长一段超过预算）' }}</strong></p>
                <p v-if="budgetFacts.continuousDifference < 0">最长一段比默认不设停靠的连续距离短 {{ formatMetric(-budgetFacts.continuousDifference) }} 米；只说明连续距离减少，不代表更省力或安全。</p>
                <p v-else-if="budgetFacts.continuousDifference === 0">最长一段与默认不设停靠的连续距离相同，没有缩短。</p>
                <p v-else>最长一段比默认不设停靠的连续距离长 {{ formatMetric(budgetFacts.continuousDifference) }} 米，连续步行距离没有改善，即使预算达标也不表示更省力。</p>
                <p>预算达标与相对直达改善是两个问题；此结果不改变路线排序或普通导航。</p>
              </template>
              <p v-else role="status">两腿连续步行距离暂未确认：登记边长缺失、不完整、为零或与总距离矛盾，不补造距离，也不判断预算达标。</p>
            </section>
          </template>
        </div>
        <p>仅供预览，不替换当前所选路线，不提供此方案导航；本轮尚不支持保留停靠点的重新规划。登记数据未经现场核验，不保证有座位，也不表示此方案更好或通行安全。</p>
      </section>

      <section v-if="selectedRoute" class="route-comparison route-bottlenecks" aria-label="路线最窄路段" data-testid="route-bottleneck">
        <h2>出发前看路况</h2>
        <p>路线最窄路段与台阶，按各自路线的登记记录统计。不代表现场通行安全。</p>
        <article v-for="{ kind, label, facts, steps } in bottlenecks" :key="kind" class="bottleneck-result" :data-testid="'road-conditions-' + kind">
          <h3>{{ label }}</h3>
          <p v-if="kind === 'reference'" class="comparison-warning">仅作普通步行参考，不可用于当前辅助设备导航，不切换导航路线。</p>
          <h4>登记范围内最窄正路宽</h4>
          <p v-if="facts.segment"><strong>{{ formatRegisteredWidth(facts.segment.width) }} 米</strong> · {{ facts.segment.name }}</p>
          <p v-else>没有可比较的登记路宽。</p>
          <p v-if="facts.total">登记宽度 {{ facts.known }}/{{ facts.total }} 段<span v-if="facts.known < facts.total">；缺 {{ facts.total - facts.known }} 段有效记录，未登记路段可能更窄</span>。</p>
          <p v-else>路线段码清单缺失或为空，宽度覆盖范围未知。</p>
          <h4>登记台阶</h4>
          <p v-if="steps.count !== null"><strong>登记全程台阶：{{ steps.count }} 级</strong><span v-if="steps.count === 0">（登记无台阶）</span></p>
          <p v-else><strong>全程台阶总数未确认</strong>，未知不是零。</p>
          <p v-if="steps.total">台阶记录 {{ steps.known }}/{{ steps.total }} 段<span v-if="steps.known < steps.total">；缺 {{ steps.total - steps.known }} 段有效记录，不将已知小计当作全程总数</span>。</p>
          <p v-else>路线段码清单缺失或为空，台阶覆盖范围未知。</p>
          <ul v-if="steps.segments.length" aria-label="已明确登记台阶的路段">
            <li v-for="segment in steps.segments" :key="segment.code">{{ segment.name || `路段名称未记录（${segment.code}）` }}：登记 {{ segment.count }} 级</li>
          </ul>
          <button v-if="facts.segment?.coordinates" class="secondary-action" type="button"
            :data-testid="'locate-bottleneck-' + kind" @click="locateBottleneck(kind)">在地图查看{{ label }}最窄路段</button>
          <p v-else-if="facts.segment" role="status">缺少该路段登记图形，无法定位。</p>
        </article>
        <p>缺行、重复或坏值均按未知处理。以上仅为登记资料，不保证实地路况或通行安全。</p>
      </section>

      <section v-if="avoidedSegments.length" class="avoidance-panel" aria-label="需要注意的路段">
        <h2>路线风险提示</h2>
        <article v-for="segment in avoidedSegments.slice(0, 8)" :key="segment.segment_code" class="avoidance-card">
          <strong>{{ segment.name || segment.segment_code }}</strong>
          <ul><li v-for="reason in segment.reasons" :key="reason">{{ reason }}</li></ul>
        </article>
      </section>

      <details v-if="selectedRoute" class="predeparture-existing-gallery" :open="galleryOpen" @toggle="galleryOpen = $event.target.open">
        <summary>查看其他登记路段照片</summary>
        <EvidenceGallery
          v-if="galleryOpen"
          :feature="selectedEvidenceFeature"
          :route-features="routeEvidenceFeatures"
          :api-base-url="apiBaseUrl"
          @select-segment="emit('select-segment', $event)"
        />
      </details>

      <div class="route-options-actions">
        <button class="secondary-action" type="button" :disabled="detourActive" @click="emit('open-conditions')">修改出行条件</button>
        <button class="primary-action" type="button" :disabled="!selectedRoute" @click="startSelectedNavigation">{{ detourActive ? '开始绕行导航' : '开始导航' }}</button>
      </div>
    </section>

    <details ref="mapPanel" class="routes-panel route-options-map-panel" :open="!isMobile" aria-label="路线地图与文字指引">
      <summary>路线地图与文字指引</summary>
      <div class="route-options-map-content">
      <p class="section-kicker">路线地图</p>
      <div v-if="focusedSegment" class="bottleneck-map-focus" data-testid="bottleneck-map-focus" role="status">
        <span>地图高亮：{{ focusedBottleneck.label }} · {{ focusedSegment.name }}（登记 {{ formatRegisteredWidth(focusedSegment.width) }} 米）</span>
        <button class="secondary-action" type="button" @click="clearBottleneckFocus">清除高亮</button>
      </div>
      <p v-if="mapFailure" class="map-fallback-notice" role="status">
        <span>{{ mapFailure }}，文字路线仍可使用。</span>
        <button type="button" :disabled="mapRetrying" @click="emit('retry-map')">{{ mapRetrying ? '重试中…' : '重试地图' }}</button>
      </p>
      <p v-else-if="mapLoading" class="map-fallback-notice" role="status">地图数据加载中…</p>
      <AmapRouteMap
        v-if="pilotArea && !mapFailure"
        :area="pilotArea"
        :features="displayedMapFeatures"
        :route-segment-codes="routeSegmentCodes"
        :selected-segment-code="displayedSelectedCode"
        @select-segment="selectMapSegment"
        @map-error="emit('map-error', $event)"
      />
      <FallbackRouteMap
        v-else
        :features="displayedMapFeatures"
        :route-segment-codes="routeSegmentCodes"
        :selected-segment-code="displayedSelectedCode"
        @select-segment="selectMapSegment"
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
.arrival-receipt { min-width:0; max-width:100%; margin:16px 0; padding:16px; border:2px solid #245d47; border-radius:16px; background:#edf5ee; color:#264d3b; overflow-wrap:anywhere; font-size:1.125rem; line-height:1.8; }
.arrival-receipt h2 { font-size:1.5rem; margin:0; }
.arrival-receipt:focus-visible { outline:3px solid #245d47; outline-offset:3px; }
.return-journey { margin: 14px 0; padding: 14px; min-width: 0; border: 1px solid #b7ccc0; border-radius: 10px; background: #f3f8f4; line-height: 1.7; overflow-wrap: anywhere; }
.return-journey h2 { margin: 0; font-size: 1.25rem; }
.return-journey p { margin: 10px 0; }
.return-journey button { min-height: 48px; max-width: 100%; white-space: normal; }
.bottleneck-result { padding: 12px 0; border-top: 1px solid #b7ccc0; }
.walking-budget-choice { display: grid; gap: 8px; margin: 12px 0; font-size: 1.125rem; }
.walking-budget-choice select { min-height: 48px; max-width: 100%; font: inherit; padding: 8px; }
.walking-budget-result { border-top: 1px solid #b7ccc0; margin-top: 14px; font-size: 1.125rem; line-height: 1.8; }
.walking-budget-result dt { margin-top: 8px; }
.walking-budget-result dd { margin-left: 0; font-weight: 700; }
.bottleneck-result h3 { margin: 0; font-size: 1.1rem; }
.bottleneck-result strong { font-size: 1.2rem; }
.route-bottlenecks { font-size: 1.125rem; line-height: 1.8; }
.route-bottlenecks h2 { font-size: 1.4rem; }
.route-bottlenecks h3 { font-size: 1.25rem; }
.route-bottlenecks h4 { margin: 14px 0 0; font-size: 1.125rem; }
.route-bottlenecks ul { padding-left: 24px; }
.bottleneck-map-focus { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 12px; border-left: 4px solid #d9771f; background: #fff5e6; color: #593915; }
.bottleneck-map-focus button { min-height: 44px; }
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
.predeparture-existing-gallery { min-width: 0; margin-block: 1rem; }
.predeparture-existing-gallery > summary { min-height: 48px; padding: .75rem; font-size: 1rem; line-height: 1.5; overflow-wrap: anywhere; cursor: pointer; }
.predeparture-existing-gallery > summary:focus-visible { outline: 3px solid #254e8c; outline-offset: 3px; }
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
