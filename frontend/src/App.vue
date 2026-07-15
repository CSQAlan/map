<script setup>
import { computed, onMounted, ref } from 'vue';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

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
const selectedRouteIndex = ref(0);
const loading = ref(false);
const mapLoading = ref(false);
const errorMessage = ref('');
const actionStatus = ref('尚未开始导航，请先确认路线。');
const mapFeatures = ref([]);

const selectedProfile = computed(() =>
  profileOptions.find((item) => item.value === mobilityType.value)
);
const selectedEnd = computed(() => endOptions.find((item) => item.value === endName.value));
const selectedRoute = computed(() => routes.value[selectedRouteIndex.value] ?? null);
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

async function fetchRoutes() {
  loading.value = true;
  errorMessage.value = '';
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
      throw new Error(payload.detail ?? '路线接口暂时不可用');
    }

    routes.value = payload.routes ?? [];
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

    <section v-else class="elder-panel">
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
  </main>
</template>
