<script setup>
import { computed, onMounted, ref } from 'vue';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:8000`;

const startOptions = [{ label: '重庆师范大学三号门', value: '重庆师范大学三号门' }];
const endOptions = [
  { label: '校医院', value: '重庆师范大学校医院' },
  { label: '食堂', value: '重庆师范大学食堂' },
];
const profileOptions = [
  { label: '轮椅老人', value: 'WHEELCHAIR', hint: '不走台阶，优先坡道、宽路和无障碍路段' },
  { label: '拐杖老人', value: 'CANE', hint: '台阶惩罚很高，优先扶手、平缓、安全路线' },
  { label: '慢行老人', value: 'SLOW_WALKER', hint: '优先休息点、树荫、低坡度，减少连续步行压力' },
  { label: '独立出行', value: 'INDEPENDENT', hint: '可接受普通步行路线，但仍避开高风险路段' },
  { label: '家属陪同', value: 'FAMILY_ASSISTED', hint: '兼顾陪同行走、安全提示和路线稳定性' },
];

const activeMode = ref('recommend');
const startName = ref(startOptions[0].value);
const endName = ref(endOptions[1].value);
const mobilityType = ref('WHEELCHAIR');
const routes = ref([]);
const avoidedSegments = ref([]);
const selectedRouteIndex = ref(0);
const loading = ref(false);
const mapLoading = ref(false);
const errorMessage = ref('');
const actionStatus = ref('尚未开始导航，请先确认路线。');
const mapFeatures = ref([]);
const collectionSegments = ref([]);
const pendingCollectionRecords = ref([]);
const collectionLoading = ref(false);
const collectionSubmitting = ref(false);
const auditLoadingIds = ref(new Set());
const collectionMessage = ref('手机端采集表已准备好，选择路段后即可提交待审核数据。');
const collectionError = ref('');
const collectionForm = ref({
  segment_code: '',
  collector: '采集员A',
  surface_type: 'CONCRETE',
  surface_level: 4,
  safety_level: 4,
  barrier_free_level: 4,
  rest_facility_score: 3,
  lighting_level: 4,
  crossing_safety_level: 4,
  width_m: 1.5,
  wheelchair_accessible: true,
  has_handrail: false,
  has_ramp: true,
  shade_coverage_percent: 30,
  bench_count: 0,
  step_count: 0,
  step_height_cm: 0,
  location_lat: null,
  location_lon: null,
  photo_urls: [],
  remark: '',
});

const selectedProfile = computed(() =>
  profileOptions.find((item) => item.value === mobilityType.value)
);
const selectedEnd = computed(() => endOptions.find((item) => item.value === endName.value));
const selectedRoute = computed(() => routes.value[selectedRouteIndex.value] ?? null);
const selectedCollectionSegment = computed(() =>
  collectionSegments.value.find((segment) => segment.segment_code === collectionForm.value.segment_code)
);
const hasRoutes = computed(() => routes.value.length > 0);
const selectedSegments = computed(() => selectedRoute.value?.segments ?? []);
const routeSegmentCodes = computed(() => new Set(selectedRoute.value?.segment_codes ?? []));
const roadFeatures = computed(() =>
  mapFeatures.value.filter((feature) => feature.properties?.kind === 'segment')
);
const poiFeatures = computed(() =>
  mapFeatures.value.filter((feature) => feature.properties?.kind === 'poi')
);
const mapBounds = computed(() => {
  const points = [];
  for (const feature of mapFeatures.value) {
    collectCoordinates(feature.geometry?.coordinates, points);
  }
  for (const segment of selectedSegments.value) {
    collectCoordinates(segment.geometry_coordinates, points);
  }
  if (!points.length) {
    return { minLon: 106.307, maxLon: 106.31, minLat: 29.6036, maxLat: 29.6051 };
  }
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return {
    minLon: Math.min(...lons),
    maxLon: Math.max(...lons),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
});
const nextStepText = computed(() => {
  const firstSegmentName = selectedSegments.value[0]?.name ?? selectedRoute.value?.segment_names?.[0];
  if (!firstSegmentName) return '请先在推荐模式生成一条路线。';
  return `第一步：沿“${firstSegmentName}”方向慢慢前进，注意观察地面和台阶。`;
});

onMounted(() => {
  fetchMapData();
  fetchCollectionSegments();
  fetchPendingCollectionRecords();
});

function collectCoordinates(coordinates, points) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    points.push(coordinates);
    return;
  }
  for (const item of coordinates) {
    collectCoordinates(item, points);
  }
}

function projectPoint(point) {
  const width = 760;
  const height = 360;
  const padding = 42;
  const bounds = mapBounds.value;
  const lonRange = bounds.maxLon - bounds.minLon || 0.001;
  const latRange = bounds.maxLat - bounds.minLat || 0.001;
  const x = padding + ((point[0] - bounds.minLon) / lonRange) * (width - padding * 2);
  const y = height - padding - ((point[1] - bounds.minLat) / latRange) * (height - padding * 2);
  return [x, y];
}

function pathForCoordinates(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) return '';
  return coordinates
    .map((point, index) => {
      const [x, y] = projectPoint(point);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

function pointForFeature(feature) {
  return projectPoint(feature.geometry.coordinates);
}

function isRouteFeature(feature) {
  return routeSegmentCodes.value.has(feature.properties?.segment_code);
}

async function fetchMapData() {
  mapLoading.value = true;
  try {
    const response = await fetch(`${API_BASE_URL}/api/map-data/geojson`);
    const payload = await response.json();
    mapFeatures.value = payload.features ?? [];
  } catch {
    mapFeatures.value = [];
  } finally {
    mapLoading.value = false;
  }
}

async function fetchCollectionSegments() {
  collectionLoading.value = true;
  try {
    const response = await fetch(`${API_BASE_URL}/api/collect/segments`);
    if (!response.ok) {
      throw new Error('路段列表接口暂时不可用。');
    }
    const payload = await response.json();
    collectionSegments.value = Array.isArray(payload) ? payload : [];
    if (!collectionForm.value.segment_code && collectionSegments.value.length) {
      useCollectionSegment(collectionSegments.value[0].segment_code);
    }
  } catch {
    collectionError.value = '无法加载可采集路段，请确认后端服务已启动。';
  } finally {
    collectionLoading.value = false;
  }
}

async function fetchPendingCollectionRecords() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/collect/pending`);
    pendingCollectionRecords.value = response.ok ? await response.json() : [];
  } catch {
    pendingCollectionRecords.value = [];
    collectionError.value = '待审核列表暂时无法加载，但不影响提交采集记录。';
  }
}

function useCollectionSegment(segmentCode) {
  collectionForm.value.segment_code = segmentCode;
  const segment = collectionSegments.value.find((item) => item.segment_code === segmentCode);
  if (!segment) return;
  collectionForm.value.width_m = Number(segment.width_m ?? collectionForm.value.width_m);
  collectionForm.value.surface_type = segment.surface_type ?? 'CONCRETE';
}

function captureCurrentLocation() {
  collectionError.value = '';
  if (!navigator.geolocation) {
    collectionError.value = '当前浏览器不支持定位，可以先手动提交采集数据。';
    return;
  }
  collectionMessage.value = '正在读取手机定位，请稍等。';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      collectionForm.value.location_lat = Number(position.coords.latitude.toFixed(6));
      collectionForm.value.location_lon = Number(position.coords.longitude.toFixed(6));
      collectionMessage.value = '已记录当前位置，会随采集备注一起提交。';
    },
    () => {
      collectionError.value = '定位失败，可以检查浏览器权限，或先不带定位提交。';
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

async function submitCollection() {
  collectionSubmitting.value = true;
  collectionError.value = '';
  collectionMessage.value = '正在提交采集记录...';
  try {
    const response = await fetch(`${API_BASE_URL}/api/collect/segments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collectionForm.value),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiError(payload.detail));
    }
    collectionMessage.value = `已提交记录 #${payload.id}，状态：${payload.status}，等待管理员审核。`;
    collectionForm.value.remark = '';
    collectionForm.value.location_lat = null;
    collectionForm.value.location_lon = null;
    await fetchPendingCollectionRecords();
  } catch (error) {
    collectionError.value = error instanceof Error ? error.message : '采集记录提交失败。';
    collectionMessage.value = '提交没有成功，请检查字段后再试一次。';
  } finally {
    collectionSubmitting.value = false;
  }
}

async function auditCollection(record, auditResult) {
  const nextLoadingIds = new Set(auditLoadingIds.value);
  nextLoadingIds.add(record.id);
  auditLoadingIds.value = nextLoadingIds;
  collectionError.value = '';
  collectionMessage.value = auditResult === 'APPROVED' ? '正在通过采集记录...' : '正在驳回采集记录...';
  try {
    const response = await fetch(`${API_BASE_URL}/api/collect/segments/${record.id}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audit_result: auditResult,
        auditor: '系统管理员',
        audit_comment: auditResult === 'APPROVED' ? '现场采集数据通过审核' : '演示驳回，需重新采集',
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiError(payload.detail));
    }
    collectionMessage.value = payload.message ?? '审核操作已完成。';
    await Promise.all([fetchPendingCollectionRecords(), fetchMapData()]);
  } catch (error) {
    collectionError.value = error instanceof Error ? error.message : '审核操作失败。';
    collectionMessage.value = '审核没有成功，请稍后再试。';
  } finally {
    const updatedLoadingIds = new Set(auditLoadingIds.value);
    updatedLoadingIds.delete(record.id);
    auditLoadingIds.value = updatedLoadingIds;
  }
}

function formatApiError(detail) {
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg ?? JSON.stringify(item)).join('；');
  }
  if (typeof detail === 'string') return detail;
  return '采集记录提交失败。';
}

async function fetchRoutes() {
  loading.value = true;
  errorMessage.value = '';
  avoidedSegments.value = [];
  actionStatus.value = '正在根据老人画像重新计算适老路线。';

  try {
    const params = new URLSearchParams({
      start_name: startName.value,
      end_name: endName.value,
      mobility_type: mobilityType.value,
    });
    const response = await fetch(`${API_BASE_URL}/api/routes/recommend?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail = payload.detail;
      if (detail?.avoided_segments) {
        avoidedSegments.value = detail.avoided_segments;
      }
      throw new Error(
        typeof detail === 'string'
          ? detail
          : detail?.message ?? '路线接口暂时不可用'
      );
    }

    routes.value = payload.routes ?? [];
    avoidedSegments.value = payload.avoided_segments ?? [];
    selectedRouteIndex.value = 0;
    actionStatus.value = routes.value.length
      ? `已按“${selectedProfile.value?.label}”生成路线，可切换到老人模式演示。`
      : '没有找到可用路线，请更换目的地或老人画像。';
  } catch (error) {
    routes.value = [];
    selectedRouteIndex.value = 0;
    errorMessage.value =
      error instanceof Error
        ? error.message
        : '无法连接后端服务，请确认 FastAPI 已启动。';
    actionStatus.value = '路线生成失败，请检查后端服务。';
  } finally {
    loading.value = false;
  }
}

function selectRoute(index) {
  selectedRouteIndex.value = index;
  actionStatus.value = `已选择推荐路线 ${index + 1}。`;
}

function startNavigation() {
  if (!selectedRoute.value) {
    activeMode.value = 'recommend';
    actionStatus.value = '请先生成一条路线。';
    return;
  }
  actionStatus.value = '导航已开始，请按下一步提示慢行。';
}

function reroute() {
  activeMode.value = 'recommend';
  fetchRoutes();
}

function sendSos() {
  actionStatus.value = '已模拟发送求助信息，演示版暂不连接真实告警。';
}
</script>

<template>
  <main class="app-shell">
    <section class="hero-panel">
      <p class="eyebrow">重庆师范大学试点</p>
      <div class="hero-copy">
        <h1>助老地图 H5 演示</h1>
        <p>不是普通最短路，而是根据老人身体能力动态筛路、算路、解释路线。</p>
      </div>
      <div class="mode-tabs" aria-label="页面模式切换">
        <button
          :class="{ active: activeMode === 'recommend' }"
          type="button"
          @click="activeMode = 'recommend'"
        >
          推荐模式
        </button>
        <button
          :class="{ active: activeMode === 'elder' }"
          type="button"
          @click="activeMode = 'elder'"
        >
          老人模式
        </button>
        <button
          :class="{ active: activeMode === 'collect' }"
          type="button"
          @click="activeMode = 'collect'"
        >
          采集模式
        </button>
      </div>
    </section>

    <section v-if="activeMode === 'recommend'" class="workspace-grid">
      <form class="control-panel" @submit.prevent="fetchRoutes">
        <div>
          <p class="section-kicker">老人画像</p>
          <div class="profile-grid">
            <button
              v-for="profile in profileOptions"
              :key="profile.value"
              class="profile-chip"
              :class="{ selected: mobilityType === profile.value }"
              type="button"
              @click="mobilityType = profile.value"
            >
              <strong>{{ profile.label }}</strong>
              <span>{{ profile.hint }}</span>
            </button>
          </div>
        </div>

        <label class="field-block">
          <span>起点</span>
          <select v-model="startName">
            <option v-for="option in startOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <label class="field-block">
          <span>目的地</span>
          <select v-model="endName">
            <option v-for="option in endOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>

        <button class="primary-action" type="submit" :disabled="loading">
          {{ loading ? '正在计算...' : '生成适老路线' }}
        </button>

        <p class="status-line">{{ actionStatus }}</p>
        <p v-if="errorMessage" class="error-line">{{ errorMessage }}</p>
      </form>

      <section class="routes-panel" aria-live="polite">
        <div class="map-panel">
          <div class="panel-heading">
            <p class="section-kicker">校园示意图</p>
            <h2>{{ mapLoading ? '正在加载路网' : '试点路网与推荐路线' }}</h2>
          </div>
          <svg class="campus-map" viewBox="0 0 760 360" role="img" aria-label="重庆师范大学试点路线示意图">
            <defs>
              <linearGradient id="routeGlow" x1="0" x2="1">
                <stop offset="0%" stop-color="#2f6f5e" />
                <stop offset="100%" stop-color="#e6a93c" />
              </linearGradient>
            </defs>
            <path
              v-for="feature in roadFeatures"
              :key="feature.properties.segment_code"
              :d="pathForCoordinates(feature.geometry.coordinates)"
              :class="['map-road', { active: isRouteFeature(feature), stair: feature.properties.step_count > 0 }]"
            />
            <g
              v-for="feature in poiFeatures"
              :key="feature.properties.id"
              class="map-poi"
              :transform="`translate(${pointForFeature(feature)[0]}, ${pointForFeature(feature)[1]})`"
            >
              <circle r="10" />
              <text x="14" y="5">{{ feature.properties.name }}</text>
            </g>
          </svg>
          <div class="map-legend">
            <span><i class="legend-route"></i>当前推荐路线</span>
            <span><i class="legend-road"></i>试点路网</span>
            <span><i class="legend-risk"></i>含台阶路段</span>
          </div>
        </div>

        <section v-if="avoidedSegments.length" class="avoidance-panel">
          <div class="panel-heading compact">
            <p class="section-kicker">不可通行与需注意路段</p>
            <h2>系统识别了哪些风险？</h2>
          </div>
          <article
            v-for="segment in avoidedSegments"
            :key="segment.segment_code"
            class="avoidance-card"
          >
            <div class="avoidance-card-top">
              <strong>{{ segment.name || segment.segment_code }}</strong>
              <span :class="['avoidance-badge', segment.avoidance_level === 'BLOCKED' ? 'blocked' : 'high-risk']">
                {{ segment.avoidance_level === 'BLOCKED' ? '系统已避开' : '可通行但需注意' }}
              </span>
            </div>
            <ul>
              <li v-for="reason in segment.reasons" :key="`${segment.segment_code}-${reason}`">
                {{ reason }}
              </li>
            </ul>
          </article>
        </section>

        <div class="panel-heading">
          <p class="section-kicker">候选路线</p>
          <h2>{{ hasRoutes ? `共 ${routes.length} 条推荐` : '等待生成路线' }}</h2>
        </div>

        <div v-if="!hasRoutes" class="empty-state">
          <span>从三号门出发，选择画像后生成路线。</span>
          <strong>轮椅、拐杖、慢行老人会得到不同路线排序。</strong>
        </div>

        <article
          v-for="(route, index) in routes"
          :key="`${route.rank}-${route.route_score}`"
          class="route-card"
          :class="{ chosen: selectedRouteIndex === index }"
          role="button"
          tabindex="0"
          @click="selectRoute(index)"
          @keydown.enter.prevent="selectRoute(index)"
          @keydown.space.prevent="selectRoute(index)"
        >
          <div class="route-card-top">
            <div>
              <p class="rank-label">推荐路线 {{ route.rank }}</p>
              <h3>{{ route.summary || '综合适老成本较低' }}</h3>
            </div>
            <strong>{{ route.route_score }} 分</strong>
          </div>
          <dl class="route-metrics">
            <div>
              <dt>距离</dt>
              <dd>{{ route.distance_m }} 米</dd>
            </div>
            <div>
              <dt>预计</dt>
              <dd>{{ route.estimated_minutes }} 分钟</dd>
            </div>
          </dl>
          <ol class="segment-flow">
            <li
              v-for="segment in route.segments"
              :key="segment.segment_code"
              class="segment-detail"
            >
              <div class="segment-title">
                <strong>{{ segment.name }}</strong>
                <span>{{ segment.length_m }} 米</span>
              </div>
              <p>{{ segment.explanation }}</p>
              <div class="tag-row">
                <span
                  v-for="tag in segment.benefit_tags"
                  :key="`${segment.segment_code}-good-${tag}`"
                  class="route-tag benefit"
                >
                  {{ tag }}
                </span>
                <span
                  v-for="tag in segment.risk_tags"
                  :key="`${segment.segment_code}-risk-${tag}`"
                  class="route-tag risk"
                >
                  {{ tag }}
                </span>
              </div>
            </li>
          </ol>
        </article>
      </section>
    </section>

    <section v-else-if="activeMode === 'elder'" class="elder-panel">
      <div class="elder-summary">
        <p class="section-kicker">当前路线</p>
        <h2>{{ selectedEnd?.label ?? '目的地' }}</h2>
        <p>{{ selectedRoute?.summary ?? '请先在推荐模式生成一条路线。' }}</p>
      </div>

      <div class="elder-next-step">
        <span>下一步</span>
        <strong>{{ nextStepText }}</strong>
      </div>

      <div v-if="selectedSegments.length" class="elder-route-note">
        <span>本段提醒</span>
        <strong>{{ selectedSegments[0].explanation }}</strong>
      </div>

      <div class="elder-metrics">
        <div>
          <span>距离</span>
          <strong>{{ selectedRoute?.distance_m ?? '--' }} 米</strong>
        </div>
        <div>
          <span>时间</span>
          <strong>{{ selectedRoute?.estimated_minutes ?? '--' }} 分钟</strong>
        </div>
        <div>
          <span>画像</span>
          <strong>{{ selectedProfile?.label }}</strong>
        </div>
      </div>

      <div class="elder-actions">
        <button class="big-action start" type="button" @click="startNavigation">开始导航</button>
        <button class="big-action refresh" type="button" @click="reroute">重新推荐</button>
        <button class="big-action sos" type="button" @click="sendSos">紧急求助</button>
      </div>

      <p class="elder-status">{{ actionStatus }}</p>
    </section>

    <section v-else class="collection-panel">
      <div class="collection-hero">
        <div>
          <p class="section-kicker">手机现场采集</p>
          <h2>路段适老数据录入</h2>
          <p>队友到现场后选择路段，记录坡度感受、路宽、台阶、坡道、扶手、照明和备注。提交后进入待审核队列，不会直接覆盖正式路线数据。</p>
        </div>
        <button class="secondary-action" type="button" @click="captureCurrentLocation">
          记录手机定位
        </button>
      </div>

      <form class="collection-form" @submit.prevent="submitCollection">
        <label class="field-block full-span">
          <span>选择采集路段</span>
          <select
            v-model="collectionForm.segment_code"
            :disabled="collectionLoading"
            @change="useCollectionSegment(collectionForm.segment_code)"
          >
            <option
              v-for="segment in collectionSegments"
              :key="segment.segment_code"
              :value="segment.segment_code"
            >
              {{ segment.name || segment.segment_code }}
            </option>
          </select>
        </label>

        <div v-if="selectedCollectionSegment" class="selected-segment-card full-span">
          <strong>{{ selectedCollectionSegment.name }}</strong>
          <span>{{ selectedCollectionSegment.segment_code }} · {{ selectedCollectionSegment.length_m }} 米 · 坡度 {{ selectedCollectionSegment.slope_percent }}%</span>
        </div>

        <label class="field-block">
          <span>采集人</span>
          <input v-model.trim="collectionForm.collector" maxlength="50" required />
        </label>

        <label class="field-block">
          <span>路面类型</span>
          <select v-model="collectionForm.surface_type">
            <option value="CONCRETE">水泥 / 混凝土</option>
            <option value="ASPHALT">沥青</option>
            <option value="BRICK">砖石</option>
            <option value="TILE">地砖</option>
            <option value="GRAVEL">碎石</option>
            <option value="COBBLESTONE">鹅卵石</option>
          </select>
        </label>

        <label class="field-block">
          <span>路宽（米）</span>
          <input v-model.number="collectionForm.width_m" min="0" max="20" step="0.1" type="number" required />
        </label>

        <label class="field-block">
          <span>路面平整度 1-5</span>
          <input v-model.number="collectionForm.surface_level" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>安全等级 1-5</span>
          <input v-model.number="collectionForm.safety_level" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>无障碍等级 1-5</span>
          <input v-model.number="collectionForm.barrier_free_level" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>休息设施评分 1-5</span>
          <input v-model.number="collectionForm.rest_facility_score" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>照明等级 1-5</span>
          <input v-model.number="collectionForm.lighting_level" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>过街安全 1-5</span>
          <input v-model.number="collectionForm.crossing_safety_level" min="1" max="5" type="number" required />
        </label>

        <label class="field-block">
          <span>树荫覆盖率 %</span>
          <input v-model.number="collectionForm.shade_coverage_percent" min="0" max="100" type="number" required />
        </label>

        <label class="field-block">
          <span>座椅数量</span>
          <input v-model.number="collectionForm.bench_count" min="0" type="number" required />
        </label>

        <label class="field-block">
          <span>台阶数量</span>
          <input v-model.number="collectionForm.step_count" min="0" type="number" required />
        </label>

        <label class="field-block">
          <span>台阶高度（厘米）</span>
          <input v-model.number="collectionForm.step_height_cm" min="0" max="100" step="0.5" type="number" required />
        </label>

        <div class="toggle-grid full-span">
          <label>
            <input v-model="collectionForm.wheelchair_accessible" type="checkbox" />
            轮椅可通行
          </label>
          <label>
            <input v-model="collectionForm.has_ramp" type="checkbox" />
            有坡道
          </label>
          <label>
            <input v-model="collectionForm.has_handrail" type="checkbox" />
            有扶手
          </label>
        </div>

        <label class="field-block full-span">
          <span>现场备注</span>
          <textarea
            v-model.trim="collectionForm.remark"
            maxlength="400"
            placeholder="例如：路面平整但下午人流较多；入口有 1 级小台阶。"
          ></textarea>
        </label>

        <div class="location-preview full-span">
          <span>定位</span>
          <strong v-if="collectionForm.location_lat !== null && collectionForm.location_lon !== null">
            {{ collectionForm.location_lon }}, {{ collectionForm.location_lat }}
          </strong>
          <strong v-else>暂未记录，可直接提交</strong>
        </div>

        <button class="primary-action full-span" type="submit" :disabled="collectionSubmitting || !collectionForm.segment_code">
          {{ collectionSubmitting ? '正在提交...' : '提交为待审核记录' }}
        </button>
      </form>

      <p class="status-line">{{ collectionMessage }}</p>
      <p v-if="collectionError" class="error-line">{{ collectionError }}</p>

      <section class="pending-panel">
        <div class="panel-heading">
          <p class="section-kicker">待审核数据</p>
          <h2>最近 {{ pendingCollectionRecords.length }} 条采集记录</h2>
        </div>
        <article
          v-for="record in pendingCollectionRecords"
          :key="record.id"
          class="pending-card"
        >
          <strong>{{ record.segment_name || record.segment_code }}</strong>
          <span>{{ record.collector_name }} · 平整 {{ record.surface_level }} · 安全 {{ record.safety_level }} · 无障碍 {{ record.barrier_free_level }}</span>
          <span>路宽 {{ record.width_m }} 米 · 坡道 {{ record.has_ramp ? '有' : '无' }} · 扶手 {{ record.has_handrail ? '有' : '无' }} · 台阶 {{ record.step_count }}</span>
          <p>{{ record.remark || '暂无备注' }}</p>
          <div class="pending-actions">
            <button
              class="audit-action approve"
              type="button"
              :disabled="auditLoadingIds.has(record.id)"
              @click="auditCollection(record, 'APPROVED')"
            >
              通过并更新路段
            </button>
            <button
              class="audit-action reject"
              type="button"
              :disabled="auditLoadingIds.has(record.id)"
              @click="auditCollection(record, 'REJECTED')"
            >
              驳回
            </button>
          </div>
        </article>
      </section>
    </section>
  </main>
</template>
