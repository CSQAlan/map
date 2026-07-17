<script setup>
import { computed, onMounted, ref } from 'vue';
import PageNavigation from './components/PageNavigation.vue';
import RecommendPage from './pages/RecommendPage.vue';
import ElderPage from './pages/ElderPage.vue';
import CollectPage from './pages/CollectPage.vue';
import LoginPage from './pages/LoginPage.vue';
import ProfilePage from './pages/ProfilePage.vue';
import GuestProfilePage from './pages/GuestProfilePage.vue';
import NavigationPage from './pages/NavigationPage.vue';
import ProfilePrompt from './components/ProfilePrompt.vue';
import HealthReminder from './components/HealthReminder.vue';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? `${window.location.protocol}//${window.location.hostname}:8000`;

const startOptions = [{ label: '师大苑大学城西路入口', value: '师大苑大学城西路入口' }];
const endOptions = [
  { label: '荷塘水景休息区', value: '师大苑荷塘水景休息区' },
  { label: '楼栋组团A', value: '师大苑楼栋组团A' },
  { label: '楼栋组团B', value: '师大苑楼栋组团B' },
  { label: '外部商业街人行道', value: '师大苑外部商业街人行道' },
];
const profileOptions = [
  { label: '轮椅老人', value: 'WHEELCHAIR', hint: '不走台阶，优先坡道、宽路和无障碍路段' },
  { label: '拐杖老人', value: 'CANE', hint: '台阶惩罚很高，优先扶手、平缓、安全路线' },
  { label: '慢行老人', value: 'SLOW_WALKER', hint: '优先休息点、树荫、低坡度，减少连续步行压力' },
  { label: '独立出行', value: 'INDEPENDENT', hint: '可接受普通步行路线，但仍避开高风险路段' },
  { label: '家属陪同', value: 'FAMILY_ASSISTED', hint: '兼顾陪同行走、安全提示和路线稳定性' },
];

const strategyOptions = [
  { label: '综合推荐', value: 'BALANCED', hint: '兼顾距离、坡度、安全、无障碍和休息条件' },
  { label: '最安全', value: 'SAFEST', hint: '优先安全等级、过街安全、照明和无障碍' },
  { label: '最平缓', value: 'FLATTEST', hint: '优先低坡度、少台阶、坡道和路宽' },
  { label: '最舒适', value: 'COMFORT', hint: '优先休息点、座椅、树荫和路面舒适度' },
  { label: '最短距离', value: 'SHORTEST', hint: '距离优先，但仍遵守老人画像硬约束' },
];

const databasePoiOptions = [
  { label: '师大苑大学城西路入口', value: '师大苑大学城西路入口' },
  { label: '师大苑荷塘水景休息区', value: '师大苑荷塘水景休息区' },
  { label: '师大苑楼栋组团A', value: '师大苑楼栋组团A' },
  { label: '师大苑楼栋组团B', value: '师大苑楼栋组团B' },
  { label: '师大苑林下休闲步道', value: '师大苑林下休闲步道' },
  { label: '师大苑外部商业街人行道', value: '师大苑外部商业街人行道' },
];
startOptions.splice(0, startOptions.length, ...databasePoiOptions.map((option) => ({ ...option })));
endOptions.splice(0, endOptions.length, ...databasePoiOptions.map((option) => ({ ...option })));

const activeMode = ref('login');
const currentUser = ref(null);
const isGuest = ref(false);
const profileSaving = ref(false);
const startName = ref(startOptions[0].value);
const endName = ref(endOptions[0].value);
const mobilityType = ref('WHEELCHAIR');
const routeStrategy = ref('BALANCED');
const routes = ref([]);
const avoidedSegments = ref([]);
const selectedRouteIndex = ref(0);
const loading = ref(false);
const mapLoading = ref(false);
const errorMessage = ref('');
const actionStatus = ref('尚未开始导航，请先确认路线。');
const mapFeatures = ref([]);
const pilotArea = ref(null);
const mapFailure = ref('');
const mapRetrying = ref(false);
const selectedSegmentCode = ref(null);
const diagnosticSuggestions = ref([]);
const diagnosticsLoading = ref(false);
const profilePromptOpen = computed(
  () => activeMode.value === 'elder' && !isGuest.value && Boolean(currentUser.value) && !currentUser.value.profileComplete
);
const healthReminderOpen = computed(
  () => activeMode.value === 'elder' && !isGuest.value && Boolean(currentUser.value?.profileComplete) && !currentUser.value?.healthConditions && !currentUser.value?.healthReminderDismissed
);
const sosSubmitting = ref(false);
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
const selectedStrategy = computed(() =>
  strategyOptions.find((item) => item.value === routeStrategy.value)
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
const selectedEvidenceFeature = computed(() =>
  roadFeatures.value.find(
    (feature) => feature.properties.segment_code === selectedSegmentCode.value
  ) ?? null
);
const routeEvidenceFeatures = computed(() => {
  const byCode = new Map(
    roadFeatures.value.map((feature) => [feature.properties.segment_code, feature])
  );
  return (selectedRoute.value?.segment_codes ?? [])
    .map((code) => byCode.get(code))
    .filter(Boolean);
});
const nextStepText = computed(() => {
  const firstSegmentName = selectedSegments.value[0]?.name ?? selectedRoute.value?.segment_names?.[0];
  if (!firstSegmentName) return '请先在推荐模式生成一条路线。';
  return `第一步：沿“${firstSegmentName}”方向慢慢前进，注意观察地面和台阶。`;
});

onMounted(() => {
  // Check for saved user session
  const savedUser = localStorage.getItem('elderMapUser');
  if (savedUser) {
    try {
      currentUser.value = JSON.parse(savedUser);
      // Apply user's mobility type preference
      if (currentUser.value?.mobilityType) {
        mobilityType.value = currentUser.value.mobilityType;
      }
    } catch (e) {
      console.error('Failed to parse saved user data');
      localStorage.removeItem('elderMapUser');
    }
  }

  fetchPilotArea();
  fetchPoiOptions();
  fetchMapData();
  fetchDiagnostics();
  fetchCollectionSegments();
  fetchPendingCollectionRecords();
});

async function fetchPoiOptions() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/map-data/pois?area_code=SHIDAYUAN`);
    if (!response.ok) throw new Error('地点列表接口不可用');
    const pois = await response.json();
    const options = pois
      .filter((poi) => poi?.name)
      .map((poi) => ({ label: poi.name, value: poi.name }));

    if (!options.length) throw new Error('地点列表为空');
    startOptions.splice(0, startOptions.length, ...options);
    endOptions.splice(0, endOptions.length, ...options);

    if (!options.some((option) => option.value === startName.value)) {
      startName.value = options[0].value;
    }
    if (!options.some((option) => option.value === endName.value)) {
      endName.value = options[Math.min(1, options.length - 1)].value;
    }
  } catch (error) {
    console.warn('使用内置地点列表：', error);
  }
}

async function fetchPilotArea() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/pilot-areas/SHIDAYUAN?coordinate_system=GCJ02`
    );
    if (!response.ok) throw new Error('无法读取师大苑试点边界');
    pilotArea.value = await response.json();
  } catch (error) {
    mapFailure.value = `试点边界加载失败：${error instanceof Error ? error.message : '未知错误'}`;
  }
}


async function fetchMapData() {
  mapLoading.value = true;
  try {
    const response = await fetch(
      `${API_BASE_URL}/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02`
    );
    if (!response.ok) throw new Error('无法读取师大苑地图数据');
    const payload = await response.json();
    mapFeatures.value = payload.features ?? [];
  } catch (error) {
    mapFeatures.value = [];
    mapFailure.value = `地图数据加载失败：${error instanceof Error ? error.message : '未知错误'}`;
  } finally {
    mapLoading.value = false;
  }
}

async function retryRealMap() {
  mapRetrying.value = true;
  mapFailure.value = '';
  pilotArea.value = null;
  await Promise.all([fetchPilotArea(), fetchMapData()]);
  mapRetrying.value = false;
}

function selectMapSegment(segmentCode) {
  selectedSegmentCode.value = segmentCode;
  const feature = roadFeatures.value.find(
    (item) => item.properties.segment_code === segmentCode
  );
  if (feature) actionStatus.value = `正在查看“${feature.properties.name}”的现场信息。`;
}

async function fetchDiagnostics() {
  diagnosticsLoading.value = true;
  try {
    const response = await fetch(`${API_BASE_URL}/api/diagnostics/segments?limit=5`);
    const payload = await response.json().catch(() => ({}));
    diagnosticSuggestions.value = response.ok ? payload.suggestions ?? [] : [];
  } catch {
    diagnosticSuggestions.value = [];
  } finally {
    diagnosticsLoading.value = false;
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

function formatApiError(detail, fallback = '采集记录提交失败。') {
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg ?? JSON.stringify(item)).join('；');
  }
  if (typeof detail === 'string') return detail;
  return fallback;
}

function resolvePilotLocation(input, options) {
  const normalizedInput = input.trim();
  const exact = options.find((option) => option.value === normalizedInput || option.label === normalizedInput);
  if (exact) return exact.value;
  const fuzzy = options.find(
    (option) => option.label.includes(normalizedInput) || normalizedInput.includes(option.label)
  );
  return fuzzy?.value ?? null;
}

async function fetchRoutes(returnToHome = false) {
  loading.value = true;
  errorMessage.value = '';
  avoidedSegments.value = [];
  actionStatus.value = '正在根据老人画像重新计算适老路线。';

  try {
    const resolvedStart = resolvePilotLocation(startName.value, startOptions);
    const resolvedEnd = resolvePilotLocation(endName.value, endOptions);
    if (!resolvedStart || !resolvedEnd) {
      throw new Error('请从输入框提示的试点地点中选择起点和目的地。');
    }
    if (resolvedStart === resolvedEnd) {
      throw new Error('起点和目的地不能相同，请选择不同地点后再生成路线。');
    }
    startName.value = resolvedStart;
    endName.value = resolvedEnd;
    const params = new URLSearchParams({
      start_name: resolvedStart,
      end_name: resolvedEnd,
      mobility_type: mobilityType.value,
      strategy: routeStrategy.value,
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
    selectedSegmentCode.value = routes.value[0]?.segment_codes?.[0] ?? null;
    actionStatus.value = routes.value.length
      ? `已按“${selectedProfile.value?.label}”生成路线，可切换到老人模式演示。`
      : '没有找到可用路线，请更换目的地或老人画像。';
    if (returnToHome && routes.value.length) activeMode.value = 'elder';
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
  selectedSegmentCode.value = routes.value[index]?.segment_codes?.[0] ?? null;
  actionStatus.value = `已选择推荐路线 ${index + 1}。`;
}

function selectStrategy(strategyValue) {
  if (routeStrategy.value === strategyValue) return;
  routeStrategy.value = strategyValue;
  routes.value = [];
  avoidedSegments.value = [];
  selectedRouteIndex.value = 0;
  errorMessage.value = '';
  actionStatus.value = `已切换为“${selectedStrategy.value?.label}”，请重新生成路线。`;
}

function startNavigation() {
  if (selectedRoute.value) activeMode.value = 'navigation';
  if (!selectedRoute.value) {
    activeMode.value = 'recommend';
    actionStatus.value = '请先生成一条路线。';
    return;
  }
  actionStatus.value = '导航已开始，请按下一步提示慢行。';
}

function reroute() {
  activeMode.value = 'recommend';
}

async function planRouteFromElderHome() {
  await fetchRoutes(false);
  if (routes.value.length) activeMode.value = 'navigation';
}

function openProfile() {
  activeMode.value = currentUser.value && !isGuest.value ? 'profile' : 'login';
}

async function sendSos() {
  sosSubmitting.value = true;
  actionStatus.value = '正在记录紧急求助事件...';
  try {
    const response = await fetch(`${API_BASE_URL}/api/emergency/sos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        elder_name: currentUser.value?.realName || (isGuest.value ? '访客' : '演示老人'),
        mobility_type: mobilityType.value,
        route_summary: selectedRoute.value?.summary ?? null,
        current_step: nextStepText.value,
        destination_name: selectedEnd.value?.label ?? null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(formatApiError(payload.detail, 'SOS 记录接口暂时不可用。'));
    }
    actionStatus.value =
      payload.message ?? `SOS 已记录为事件 #${payload.id}，已模拟通知联系人。`;
  } catch (error) {
    actionStatus.value =
      error instanceof Error
        ? `SOS 记录失败：${error.message}`
        : 'SOS 记录失败，请确认后端服务已启动。';
  } finally {
    sosSubmitting.value = false;
  }
}

function handleLogin(credentials) {
  // Simulate login/register - in production this would call an API
  isGuest.value = false;
  const userData = {
    username: credentials.username,
    realName: '',
    age: '',
    phone: '',
    mobilityType: 'INDEPENDENT',
    hasWheelchair: false,
    hasCane: false,
    healthConditions: '',
    emergencyContact: '',
    emergencyPhone: '',
    profileComplete: false,
    password: credentials.password,
    createdAt: new Date().toISOString()
  };

  currentUser.value = userData;
  localStorage.setItem('elderMapUser', JSON.stringify(userData));
  activeMode.value = 'elder';
}

function handleSkipLogin() {
  activeMode.value = 'guest-profile';
}

function enterGuestMode(profile) {
  isGuest.value = true;
  currentUser.value = null;
  mobilityType.value = profile.mobilityType;
  actionStatus.value = profile.healthCondition
    ? '已按本次出行情况为您调整推荐。'
    : '请选择起点和目的地，系统会为您推荐路线。';
  activeMode.value = 'elder';
}

function handleLogout() {
  currentUser.value = null;
  isGuest.value = false;
  localStorage.removeItem('elderMapUser');
  activeMode.value = 'login';
}

function handleSaveProfile(profileData) {
  profileSaving.value = true;
  try {
    const updatedUser = {
      ...currentUser.value,
      ...profileData,
      profileComplete: true,
      updatedAt: new Date().toISOString()
    };
    currentUser.value = updatedUser;
    localStorage.setItem('elderMapUser', JSON.stringify(updatedUser));

    // Update mobility type if changed
    if (profileData.mobilityType && profileData.mobilityType !== mobilityType.value) {
      mobilityType.value = profileData.mobilityType;
    }

    actionStatus.value = '个人信息已保存';
    setTimeout(() => {
      actionStatus.value = '尚未开始导航，请先确认路线。';
    }, 2000);
  } catch (error) {
    actionStatus.value = '保存失败，请重试';
  } finally {
    profileSaving.value = false;
  }
}

function loginWithSavedAccount() {
  if (!currentUser.value) return;
  isGuest.value = false;
  activeMode.value = 'elder';
}

function selectInitialProfile(profileValue) {
  mobilityType.value = profileValue;
  const updatedUser = {
    ...currentUser.value,
    mobilityType: profileValue,
    profileComplete: true,
    updatedAt: new Date().toISOString(),
  };
  currentUser.value = updatedUser;
  localStorage.setItem('elderMapUser', JSON.stringify(updatedUser));
  actionStatus.value = '已按您的出行情况选择推荐路线。';
}

function openHealthProfile() {
  activeMode.value = 'profile';
}

function skipHealthReminder() {
  const updatedUser = {
    ...currentUser.value,
    healthReminderDismissed: true,
    updatedAt: new Date().toISOString(),
  };
  currentUser.value = updatedUser;
  localStorage.setItem('elderMapUser', JSON.stringify(updatedUser));
}
</script>

<template>
  <main class="app-shell">
    <PageNavigation
      :active-mode="activeMode"
      :current-user="currentUser"
      :is-guest="isGuest"
      @update:active-mode="activeMode = $event"
    />

    <LoginPage
      v-if="activeMode === 'login'"
      :loading="loading"
      :saved-user="currentUser"
      @login="handleLogin"
      @quick-login="loginWithSavedAccount"
      @skip="handleSkipLogin"
    />

    <ProfilePage
      v-else-if="activeMode === 'profile'"
      :user="currentUser"
      :loading="profileSaving"
      @save="handleSaveProfile"
      @logout="handleLogout"
    />

    <GuestProfilePage
      v-else-if="activeMode === 'guest-profile'"
      @continue="enterGuestMode"
      @back="activeMode = 'login'"
    />

    <NavigationPage
      v-else-if="activeMode === 'navigation'"
      :routes="routes"
      :selected-route-index="selectedRouteIndex"
      :selected-route="selectedRoute"
      :selected-profile="selectedProfile"
      :map-features="mapFeatures"
      :pilot-area="pilotArea"
      :map-failure="mapFailure"
      :map-retrying="mapRetrying"
      :selected-segment-code="selectedSegmentCode"
      :sos-submitting="sosSubmitting"
      @select-route="selectRoute"
      @open-routes="activeMode = 'recommend'"
      @retry-map="retryRealMap"
      @select-segment="selectMapSegment"
      @map-error="mapFailure = `地图加载失败：${$event}`"
      @send-sos="sendSos"
    />

    <RecommendPage
      v-else-if="activeMode === 'recommend'"
      :mobility-type="mobilityType"
      :route-strategy="routeStrategy"
      :start-name="startName"
      :end-name="endName"
      :start-options="startOptions"
      :end-options="endOptions"
      :profile-options="profileOptions"
      :strategy-options="strategyOptions"
      :routes="routes"
      :avoided-segments="avoidedSegments"
      :selected-route-index="selectedRouteIndex"
      :loading="loading"
      :error-message="errorMessage"
      :action-status="actionStatus"
      :map-features="mapFeatures"
      :pilot-area="pilotArea"
      :map-failure="mapFailure"
      :map-retrying="mapRetrying"
      :map-loading="mapLoading"
      :selected-segment-code="selectedSegmentCode"
      :diagnostic-suggestions="diagnosticSuggestions"
      :diagnostics-loading="diagnosticsLoading"
      :api-base-url="API_BASE_URL"
      @update:mobility-type="mobilityType = $event"
      @update:route-strategy="selectStrategy($event)"
      @update:start-name="startName = $event"
      @update:end-name="endName = $event"
      @fetch-routes="fetchRoutes(false)"
      @start-navigation="startNavigation"
      @select-route="selectRoute"
      @select-strategy="selectStrategy"
      @select-segment="selectMapSegment"
      @retry-map="retryRealMap"
      @map-error="mapFailure = `高德底图加载失败：${$event}`"
    />

    <ElderPage
      v-else-if="activeMode === 'elder'"
      :start-name="startName"
      :end-name="endName"
      :start-options="startOptions"
      :end-options="endOptions"
      :selected-route="selectedRoute"
      :routes="routes"
      :selected-route-index="selectedRouteIndex"
      :selected-profile="selectedProfile"
      :action-status="actionStatus"
      :sos-submitting="sosSubmitting"
      :loading="loading"
      :map-features="mapFeatures"
      :pilot-area="pilotArea"
      :map-failure="mapFailure"
      :map-retrying="mapRetrying"
      :selected-segment-code="selectedSegmentCode"
      :is-guest="isGuest"
      @update:start-name="startName = $event"
      @update:end-name="endName = $event"
      @plan-route="planRouteFromElderHome"
      @select-route="selectRoute"
      @reroute="reroute"
      @send-sos="sendSos"
      @retry-map="retryRealMap"
      @select-segment="selectMapSegment"
      @map-error="mapFailure = `高德底图加载失败：${$event}`"
      @open-profile="openProfile"
    />

    <CollectPage
      v-else
      :collection-segments="collectionSegments"
      :collection-form="collectionForm"
      :selected-collection-segment="selectedCollectionSegment"
      :collection-loading="collectionLoading"
      :collection-submitting="collectionSubmitting"
      :collection-message="collectionMessage"
      :collection-error="collectionError"
      :pending-collection-records="pendingCollectionRecords"
      :audit-loading-ids="auditLoadingIds"
      @update:segment-code="collectionForm.segment_code = $event"
      @update:collector="collectionForm.collector = $event"
      @update:surface_type="collectionForm.surface_type = $event"
      @update:width_m="collectionForm.width_m = $event"
      @update:surface_level="collectionForm.surface_level = $event"
      @update:safety_level="collectionForm.safety_level = $event"
      @update:barrier_free_level="collectionForm.barrier_free_level = $event"
      @update:rest_facility_score="collectionForm.rest_facility_score = $event"
      @update:lighting_level="collectionForm.lighting_level = $event"
      @update:crossing_safety_level="collectionForm.crossing_safety_level = $event"
      @update:shade_coverage_percent="collectionForm.shade_coverage_percent = $event"
      @update:bench_count="collectionForm.bench_count = $event"
      @update:step_count="collectionForm.step_count = $event"
      @update:step_height_cm="collectionForm.step_height_cm = $event"
      @update:wheelchair_accessible="collectionForm.wheelchair_accessible = $event"
      @update:has_ramp="collectionForm.has_ramp = $event"
      @update:has_handrail="collectionForm.has_handrail = $event"
      @update:remark="collectionForm.remark = $event"
      @use-segment="useCollectionSegment"
      @capture-location="captureCurrentLocation"
      @submit-collection="submitCollection"
      @audit-collection="auditCollection"
    />

    <ProfilePrompt
      v-if="profilePromptOpen"
      :options="profileOptions"
      @select="selectInitialProfile"
    />

    <HealthReminder
      v-if="healthReminderOpen"
      @go-profile="openHealthProfile"
      @skip="skipHealthReminder"
    />
  </main>
</template>
