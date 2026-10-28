<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AssistantPage from './pages/AssistantPage.vue';
import RecommendPage from './pages/RecommendPage.vue';
import ElderPage from './pages/ElderPage.vue';
import CollectPage from './pages/CollectPage.vue';
import LoginPage from './pages/LoginPage.vue';
import ProfilePage from './pages/ProfilePage.vue';
import GuestProfilePage from './pages/GuestProfilePage.vue';
import { buildSegmentInstruction } from './services/speechOutput.js';
import { createNavigationPublisher } from './services/navigationPublisher.js';
import { remainingDistance } from './services/navigationJourney.js';
import NavigationPage from './pages/NavigationPage.vue';
import RouteOptionsPage from './pages/RouteOptionsPage.vue';
import ProfilePrompt from './components/ProfilePrompt.vue';
import HealthQuestionnaire from './components/HealthQuestionnaire.vue';
import FamilyPage from './pages/FamilyPage.vue';
import FamilyBindingPage from './pages/FamilyBindingPage.vue';
import AdminLoginPage from './pages/AdminLoginPage.vue';
import AdminPage from './pages/AdminPage.vue';
import SurveyRecordsPage from './pages/SurveyRecordsPage.vue';
import AdminSurveyPlacementPage from './pages/AdminSurveyPlacementPage.vue';
import AuthLayout from './layouts/AuthLayout.vue';
import ElderLayout from './layouts/ElderLayout.vue';
import FamilyLayout from './layouts/FamilyLayout.vue';
import AdminLayout from './layouts/AdminLayout.vue';
import PassthroughLayout from './layouts/PassthroughLayout.vue';
import { API_BASE_URL, apiConfigurationError } from './config/api';
import { apiRequest } from './services/apiClient.js';
import { useAuthSession } from './composables/useAuthSession.js';
import { useRoutePlanner } from './composables/useRoutePlanner.js';
import { useMapData } from './composables/useMapData.js';
import { useFamilyMonitor } from './composables/useFamilyMonitor.js';
import { useCollectionWorkflow } from './composables/useCollectionWorkflow.js';
import { pathForLegacyMode } from './router/policy.js';
import { findOptionByValue } from './utils/options.js';
import { buildSosPayload } from './services/emergency.js';

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

const activeMode = ref('login');
const activeLayout = computed(() => {
  if (['login', 'guest-profile', 'admin-login'].includes(activeMode.value)) return AuthLayout;
  if (['family', 'family-binding'].includes(activeMode.value)) return FamilyLayout;
  if (activeMode.value === 'admin') return PassthroughLayout;
  if (['admin-collect', 'admin-survey'].includes(activeMode.value)) return AdminLayout;
  return ElderLayout;
});
const route = useRoute();
const router = useRouter();
const {
  startOptions, endOptions, mapFeatures, pilotArea, mapFailure, mapLoading,
  mapRetrying,
  loadPoiOptions, loadPilotArea, loadMapData, loadDiagnostics, retryMapData,
} = useMapData({ apiBaseUrl: API_BASE_URL });
const routePlanner = useRoutePlanner({
  getStartOptions: () => startOptions.value,
  getEndOptions: () => endOptions.value,
  profileOptions,
  strategyOptions,
  apiBaseUrl: API_BASE_URL,
  router,
});
const {
  startName, endName, mobilityType, routeStrategy, routes, avoidedSegments,
  selectedRouteIndex, selectedSegmentCode, loading, errorMessage, actionStatus,
  selectedProfile, selectedRoute,
  planRoutes, selectRoute: setSelectedRoute, selectSegment: setSelectedSegment,
  selectStrategy: setRouteStrategy, selectMobility: setMobilityType, startNavigation: beginRouteNavigation,
  returnToOptions,
} = routePlanner;
const {
  currentUser,
  isGuest,
  adminUser,
  adminAccessToken,
  restoreSession,
  loginElder,
  loginFamily,
  loginAdmin: authenticateAdmin,
  enterGuestMode: startGuestSession,
  clearCurrentUser,
  logout: endSession,
  updateProfile,
  bindFamily: bindFamilySession,
} = useAuthSession();
const questionnairePending = ref(false);

watch(
  () => route.meta.legacyMode,
  (mode) => {
    if (mode && activeMode.value !== mode) activeMode.value = mode;
  },
  { immediate: true }
);

watch(activeMode, (mode) => {
  const path = pathForLegacyMode(mode);
  if (path && route.path !== path) router.push(path);
});
const adminUsers = ref([]);
const loginError = ref('');
const familyBindingError = ref('');
const { monitor: familyMonitor, elder: boundElder, refresh: refreshFamilyMonitor, start: beginFamilyMonitoring, stop: stopFamilyMonitoring, reset: resetFamilyMonitor } = useFamilyMonitor({
  currentUser,
  activeMode,
  apiBaseUrl: API_BASE_URL,
});
const adminLoginError = ref('');
const adminActionError = ref('');
const profileSaving = ref(false);
const profilePromptOpen = computed(
  () => activeMode.value === 'elder' && !isGuest.value && Boolean(currentUser.value) && !currentUser.value.profileComplete
);
const questionnaireOpen = computed(() => activeMode.value === 'elder' && questionnairePending.value);
const sosSubmitting = ref(false);
const {
  collectionSegments,
  pendingCollectionRecords,
  collectionLoading,
  collectionSubmitting,
  auditLoadingIds,
  collectionMessage,
  collectionError,
  collectionForm,
  selectedCollectionSegment,
  loadSegments: fetchCollectionSegments,
  loadPendingReviewList: fetchPendingCollectionRecords,
  selectSegment: useCollectionSegment,
  captureGeolocation: captureCurrentLocation,
  submitCollection,
  auditCollection,
} = useCollectionWorkflow({
  apiBaseUrl: API_BASE_URL,
  adminAccessToken: () => adminAccessToken.value,
  auditAccessToken: () => adminUser.value?.access_token ?? '',
  loadMapData,
});

const assistantRouteContext = computed(() => selectedRoute.value ? ({
  mobility: selectedProfile.value?.label || '',
  start: startName.value || '',
  destination: endName.value || '',
  summary: String(selectedRoute.value?.summary || '').slice(0, 500),
  distance_m: Number.isFinite(Number(selectedRoute.value?.distance_m)) ? Number(selectedRoute.value.distance_m) : null,
}) : null);

const selectedEnd = computed(() => findOptionByValue(endOptions.value, endName.value));
const selectedSegments = computed(() => selectedRoute.value?.segments ?? []);
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
const navigationProgress = ref({ index:0, paused:false });
watch(selectedRoute, () => { navigationProgress.value={ index:0, paused:false }; }, { flush:'sync' });
const nextStepText = computed(() => {
  const segments=selectedRoute.value?.segments || [];
  return `${navigationProgress.value.paused ? '正在休息。' : ''}${buildSegmentInstruction(segments[navigationProgress.value.index], navigationProgress.value.index, segments.length)}`;
});
function updateNavigationProgress(progress) { navigationProgress.value=progress; publishNavigationStatus(); }
onMounted(() => {
  restoreSession();
  if (currentUser.value?.mobilityType) setMobilityType(currentUser.value.mobilityType);
  if (apiConfigurationError) {
    errorMessage.value = apiConfigurationError;
    mapFailure.value = apiConfigurationError;
    return;
  }
  loadPilotArea();
  loadPoiOptions();
  loadMapData();
  loadDiagnostics();
  fetchCollectionSegments();
  if (adminAccessToken.value) {
    Promise.allSettled([fetchAdminUsers(), fetchPendingCollectionRecords()]);
  }
});

function selectMapSegment(segmentCode) {
  setSelectedSegment(segmentCode);
  const feature = roadFeatures.value.find(
    (item) => item.properties.segment_code === segmentCode
  );
  if (feature) actionStatus.value = `正在查看“${feature.properties.name}”的现场信息。`;
}

function formatApiError(detail, fallback = '采集记录提交失败。') {
  if (Array.isArray(detail)) {
    return detail.map((item) => item.msg ?? JSON.stringify(item)).join('；');
  }
  if (typeof detail === 'string') return detail;
  return fallback;
}

function selectRoute(index) {
  setSelectedRoute(index);
  if (activeMode.value === 'navigation') publishNavigationStatus();
}

function reroute() {
  activeMode.value = 'recommend';
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
      body: JSON.stringify(buildSosPayload({
        user: currentUser.value,
        isGuest: isGuest.value,
        mobilityType: mobilityType.value,
        selectedRoute: selectedRoute.value,
        currentStep: nextStepText.value,
        destination: selectedEnd.value,
      })),
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

function handleSkipLogin() {
  // Guest mode is intentionally anonymous: never reuse or persist a registered account session.
  startGuestSession({ clearLastRole: true });
  questionnairePending.value = false;
  boundElder.value = null;
  stopFamilyMonitoring();
  activeMode.value = 'guest-profile';
}

function enterGuestMode(profile) {
  startGuestSession();
  setMobilityType(profile.mobilityType);
  questionnairePending.value = true;
  actionStatus.value = profile.healthCondition
    ? '已按本次出行情况为您调整推荐。'
    : '请选择起点和目的地，系统会为您推荐路线。';
  activeMode.value = 'elder';
}

function handleLogout() {
  const lastRole = endSession();
  resetFamilyMonitor();
  stopFamilyMonitoring();
  if (lastRole === 'family') boundElder.value = null;
  activeMode.value = 'login';
}

function handleSaveProfile(profileData) {
  profileSaving.value = true;
  try {
    updateProfile({
      ...profileData,
      profileComplete: true,
      updatedAt: new Date().toISOString()
    });

    // Update mobility type if changed
    if (profileData.mobilityType && profileData.mobilityType !== mobilityType.value) {
      setMobilityType(profileData.mobilityType);
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

function selectInitialProfile(profileValue) {
  setMobilityType(profileValue);
  updateProfile({
    mobilityType: profileValue,
    profileComplete: true,
    updatedAt: new Date().toISOString(),
  });
  questionnairePending.value = true;
  actionStatus.value = '已按您的出行情况选择推荐路线。';
}

function saveHealthQuestionnaire(answers) {
  questionnairePending.value = false;
  const notes = answers.concerns?.length ? `重点关注：${answers.concerns.join('、')}` : '已完成出行偏好问卷。';
  if (isGuest.value) {
    actionStatus.value = '已根据您的回答优化本次路线推荐。';
    return;
  }
  updateProfile({
    healthProfile: answers,
    healthConditions: currentUser.value?.healthConditions || notes,
    questionnaireComplete: true,
    updatedAt: new Date().toISOString(),
  });
  actionStatus.value = '出行画像已完善，路线会更贴合您的需要。';
}

function skipHealthQuestionnaire() {
  questionnairePending.value = false;
  if (!isGuest.value && currentUser.value) {
    updateProfile({ questionnaireSkipped: true, updatedAt: new Date().toISOString() });
  }
}

function openAdminLogin() {
  activeMode.value = 'admin-login';
}

function exitAdmin() {
  endSession('admin');
  activeMode.value = 'login';
}

const sendNavigationSnapshot = createNavigationPublisher();
async function publishNavigationStatus(nextStatus = 'NAVIGATING') {
  if (isGuest.value || currentUser.value?.role !== 'elder' || !currentUser.value?.id || !selectedRoute.value) return false;
  const route = selectedRoute.value;
  const status = {
    start_name: startName.value,
    end_name: endName.value,
    distance_m: Number(route.distance_m || 0),
    remaining_m: remainingDistance(route, navigationProgress.value.index),
    estimated_minutes: Number(route.estimated_minutes || 0),
    current_step: nextStatus === 'COMPLETED' ? '用户已结束导航，是否到达请本人确认。' : nextStepText.value,
    route_summary: route.summary || '',
    status: nextStatus,
  };
  return sendNavigationSnapshot(`${API_BASE_URL}/api/auth/elder/${currentUser.value.id}/navigation`, status);
}
async function startNavigation() {
  const started = await beginRouteNavigation();
  if (started) publishNavigationStatus();
}

async function planRouteFromElderHome() {
  if (await planRoutes()) await router.push('/elder/routes');
}

async function planRouteFromConditions() {
  if (await planRoutes()) await router.push('/elder/routes');
}

function openRouteOptions() {
  router.push('/elder/routes');
}

function openRouteConditions() {
  router.push('/elder/plan');
}

async function finishNavigation() {
  const endingUserId = currentUser.value?.id;
  const shouldSync = !isGuest.value && currentUser.value?.role === 'elder' && Boolean(currentUser.value?.id);
  const synchronization = publishNavigationStatus('COMPLETED');
  navigationProgress.value = { index:0, paused:false };
  await returnToOptions({ ended: true });
  const synchronized = await synchronization;
  if (shouldSync && !synchronized && currentUser.value?.id === endingUserId && activeMode.value !== 'navigation') {
    actionStatus.value = '导航已结束，但家属端状态暂未同步，请稍后重试。';
  }
}

async function handleLogin(credentials) {
  loading.value = true;
  loginError.value = '';
  try {
    const isFamily = credentials.role === 'family';
    if (isFamily) resetFamilyMonitor();
    const user = isFamily ? await loginFamily(credentials) : await loginElder(credentials);
    if (isFamily && user.bindingStatus !== 'ACTIVE') {
      resetFamilyMonitor();
      stopFamilyMonitoring();
    }
    if (isFamily && user.bindingStatus === 'ACTIVE') {
      boundElder.value = user.boundElder || null;
      beginFamilyMonitoring();
      await navigateAfterAuthentication('family');
    } else {
      await navigateAfterAuthentication(isFamily ? 'family-binding' : 'elder');
    }
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : '登录失败，请重试';
  } finally { loading.value = false; }
}

async function navigateAfterAuthentication(mode) {
  const path = pathForLegacyMode(mode);
  if (path && route.path !== path) await router.replace(path);
  activeMode.value = mode;
}

function handleRoleChange(nextRole) {
  if (currentUser.value?.role && currentUser.value.role !== nextRole) clearCurrentUser();
  loginError.value = '';
}

async function fetchAdminUsers() {
  adminUsers.value = await apiRequest('/api/auth/admin/users', {
    token: adminAccessToken.value,
    errorMessage: '用户数据读取失败',
  });
}

async function loginAdmin(payload) {
  try {
    await authenticateAdmin(payload);
    adminLoginError.value = '';
    await Promise.all([fetchAdminUsers(), fetchPendingCollectionRecords()]);
    await navigateAfterAuthentication('admin');
  } catch (error) { adminLoginError.value = error instanceof Error ? error.message : '管理员登录失败'; }
}

async function updateAdminUserStatus({ id, status }) {
  adminActionError.value = '';
  const previousUsers = adminUsers.value;
  adminUsers.value = adminUsers.value.map((user) => user.id === id ? { ...user, status } : user);
  try {
    const payload = await apiRequest(`/api/auth/admin/users/${id}/status`, {
      method: 'PATCH',
      token: adminAccessToken.value,
      body: { status },
      errorMessage: '账号状态更新失败',
    });
    adminUsers.value = adminUsers.value.map((user) => user.id === id ? { ...user, ...payload } : user);
    await fetchAdminUsers();
  } catch (error) {
    adminUsers.value = previousUsers;
    adminActionError.value = error instanceof Error ? error.message : '账号状态更新失败';
  }
}

async function bindFamilyToElder(payload) {
  try {
    const result = await bindFamilySession(payload);
    boundElder.value = result.elder;
    familyBindingError.value = '';
    beginFamilyMonitoring();
    activeMode.value = 'family';
  } catch (error) { familyBindingError.value = error instanceof Error ? error.message : '关联失败，请重试'; }
}
</script>

<template>
  <component :is="activeLayout">
    <div class="app-content">

    <LoginPage
      v-if="activeMode === 'login'"
      :loading="loading"
      :saved-user="currentUser"
      :error="loginError"
      @login="handleLogin"
      @role-change="handleRoleChange"
      @skip="handleSkipLogin"
      @admin="openAdminLogin"
    />

    <AdminLoginPage
      v-else-if="activeMode === 'admin-login'"
      :error-message="adminLoginError"
      @login="loginAdmin"
      @back="exitAdmin"
    />

    <AdminPage
      v-else-if="activeMode === 'admin'"
      :pending-records="pendingCollectionRecords"
      :audit-loading-ids="auditLoadingIds"
      :collection-segments="collectionSegments"
      :users="adminUsers"
      :action-error="adminActionError"
      @audit="auditCollection($event.record, $event.result)"
      @update-user-status="updateAdminUserStatus"
      @open-collect="activeMode = 'admin-collect'"
      @open-survey-placement="activeMode = 'admin-survey'"
      @logout="exitAdmin"
    />

    <SurveyRecordsPage
      v-else-if="activeMode === 'survey-records'"
      :api-base-url="API_BASE_URL"
    />

    <AdminSurveyPlacementPage
      v-else-if="activeMode === 'admin-survey'"
      :api-base-url="API_BASE_URL"
      :access-token="adminUser?.access_token ?? ''"
      @back="activeMode = 'admin'"
    />

    <FamilyBindingPage
      v-else-if="activeMode === 'family-binding'"
      :error-message="familyBindingError"
      @bind="bindFamilyToElder"
      @back="activeMode = currentUser?.role === 'family' ? 'family' : 'login'"
    />

    <FamilyPage
      v-else-if="activeMode === 'family'"
      :user="currentUser"
      :elder="currentUser?.boundElder || boundElder"
      :monitor="familyMonitor"
      @refresh="refreshFamilyMonitor"
      @manage-binding="resetFamilyMonitor(); familyBindingError = ''; activeMode = 'family-binding'"
      @logout="handleLogout"
    />

    <AssistantPage v-else-if="activeMode === 'assistant'" :route-context="assistantRouteContext" />

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
      v-else-if="activeMode === 'navigation'" :progress="navigationProgress" @progress="updateNavigationProgress"
      :selected-route="selectedRoute"
      :selected-profile="selectedProfile"
      :map-features="mapFeatures"
      :pilot-area="pilotArea"
      :map-failure="mapFailure"
      :map-retrying="mapRetrying"
      :selected-segment-code="selectedSegmentCode"
      :sos-submitting="sosSubmitting"
      @open-routes="openRouteOptions"
      @end-navigation="finishNavigation"
      @retry-map="retryMapData"
      @select-segment="selectMapSegment"
      @map-error="mapFailure = `地图加载失败：${$event}`"
      @send-sos="sendSos"
    />

    <RouteOptionsPage
      v-else-if="activeMode === 'route-options'"
      :routes="routes"
      :selected-route-index="selectedRouteIndex"
      :selected-route="selectedRoute"
      :avoided-segments="avoidedSegments"
      :map-features="mapFeatures"
      :pilot-area="pilotArea"
      :map-failure="mapFailure"
      :map-retrying="mapRetrying"
      :map-loading="mapLoading"
      :selected-segment-code="selectedSegmentCode"
      :api-base-url="API_BASE_URL"
      :error-message="errorMessage"
      :action-status="actionStatus"
      @select-route="selectRoute"
      @select-segment="selectMapSegment"
      @open-conditions="openRouteConditions"
      @start-navigation="startNavigation"
      @retry-map="retryMapData"
      @map-error="mapFailure = `高德底图加载失败：${$event}`"
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
      :loading="loading"
      :error-message="errorMessage"
      @update:mobility-type="setMobilityType($event)"
      @update:route-strategy="setRouteStrategy($event)"
      @update:start-name="startName = $event"
      @update:end-name="endName = $event"
      @plan-routes="planRouteFromConditions"
    />

    <ElderPage
      v-else-if="activeMode === 'elder'"
      :start-name="startName"
      :end-name="endName"
      :start-options="startOptions"
      :end-options="endOptions"
      :profile-options="profileOptions"
      :mobility-type="mobilityType"
      :action-status="actionStatus"
      :error-message="errorMessage"
      :sos-submitting="sosSubmitting"
      :loading="loading"
      :is-guest="isGuest"
      @update:start-name="startName = $event"
      @update:end-name="endName = $event"
      @update:mobility-type="setMobilityType($event)"
      @plan-route="planRouteFromElderHome"
      @open-route-options="openRouteOptions"
      @reroute="reroute"
      @send-sos="sendSos"
      @open-profile="openProfile"
      @open-assistant="activeMode = 'assistant'"
    />

    <section v-else-if="activeMode === 'admin-collect'" class="admin-collection-workspace">
      <div class="admin-collection-topbar"><div><p class="section-kicker">管理员后台 / 现场采集</p><h1>路段适老数据采集</h1></div><button class="secondary-action" type="button" @click="activeMode = 'admin'">返回管理后台</button></div>
    <CollectPage
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
    </section>

    <ProfilePrompt
      v-if="profilePromptOpen"
      :options="profileOptions"
      @select="selectInitialProfile"
    />

    <HealthQuestionnaire
      v-if="questionnaireOpen"
      @submit="saveHealthQuestionnaire"
      @skip="skipHealthQuestionnaire"
    />
    </div>
  </component>
</template>
