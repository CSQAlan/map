import { computed, ref } from 'vue';

const DEFAULT_PROFILE_OPTIONS = [
  { label: '轮椅老人', value: 'WHEELCHAIR', hint: '不走台阶，优先坡道、宽路和无障碍路段' },
  { label: '拐杖老人', value: 'CANE', hint: '台阶惩罚很高，优先扶手、平缓、安全路线' },
  { label: '慢行老人', value: 'SLOW_WALKER', hint: '优先休息点、树荫、低坡度，减少连续步行压力' },
  { label: '独立出行', value: 'INDEPENDENT', hint: '可接受普通步行路线，但仍避开高风险路段' },
  { label: '家属陪同', value: 'FAMILY_ASSISTED', hint: '兼顾陪同行走、安全提示和路线稳定性' },
];

const DEFAULT_STRATEGY_OPTIONS = [
  { label: '综合推荐', value: 'BALANCED', hint: '兼顾距离、坡度、安全、无障碍和休息条件' },
  { label: '最安全', value: 'SAFEST', hint: '优先安全等级、过街安全、照明和无障碍' },
  { label: '最平缓', value: 'FLATTEST', hint: '优先低坡度、少台阶、坡道和路宽' },
  { label: '最舒适', value: 'COMFORT', hint: '优先休息点、座椅、树荫和路面舒适度' },
  { label: '最短距离', value: 'SHORTEST', hint: '距离优先，但仍遵守老人画像硬约束' },
];

function resolvePilotLocation(input, options) {
  const normalizedInput = input.trim();
  const exact = options.find((option) => option.value === normalizedInput || option.label === normalizedInput);
  if (exact) return exact.value;
  const fuzzy = options.find(
    (option) => option.label.includes(normalizedInput) || normalizedInput.includes(option.label)
  );
  return fuzzy?.value ?? null;
}

export function createRoutePlanner({
  fetcher = (...args) => fetch(...args),
  getStartOptions = () => [],
  getEndOptions = () => [],
  profileOptions = DEFAULT_PROFILE_OPTIONS,
  strategyOptions = DEFAULT_STRATEGY_OPTIONS,
  apiBaseUrl = '',
  router = null,
} = {}) {
  let startOptionsGetter = getStartOptions;
  let endOptionsGetter = getEndOptions;
  let currentProfileOptions = profileOptions;
  let currentStrategyOptions = strategyOptions;
  let currentRouter = router;
  let currentApiBaseUrl = apiBaseUrl;
  const startName = ref('');
  const endName = ref('');
  const mobilityType = ref('WHEELCHAIR');
  const routeStrategy = ref('BALANCED');
  const routes = ref([]);
  const avoidedSegments = ref([]);
  const selectedRouteIndex = ref(0);
  const selectedSegmentCode = ref(null);
  const loading = ref(false);
  const errorMessage = ref('');
  const actionStatus = ref('尚未开始导航，请先确认路线。');

  const selectedProfile = computed(() => currentProfileOptions.find((item) => item.value === mobilityType.value));
  const selectedStrategy = computed(() => currentStrategyOptions.find((item) => item.value === routeStrategy.value));
  const selectedRoute = computed(() => routes.value[selectedRouteIndex.value] ?? null);

  async function planRoutes() {
    loading.value = true;
    errorMessage.value = '';
    avoidedSegments.value = [];
    actionStatus.value = '正在根据老人画像重新计算适老路线。';

    try {
      const resolvedStart = resolvePilotLocation(startName.value, startOptionsGetter());
      const resolvedEnd = resolvePilotLocation(endName.value, endOptionsGetter());
      if (!resolvedStart || !resolvedEnd) {
        throw new Error('请从输入框提示的试点地点中选择起点和目的地。');
      }
      if (resolvedStart === resolvedEnd) {
        throw new Error('起点和目的地不能相同，请选择不同地点后再生成路线。');
      }

      // Keep the normalized selections visible even when the backend rejects a route.
      startName.value = resolvedStart;
      endName.value = resolvedEnd;
      const params = new URLSearchParams({
        start_name: resolvedStart,
        end_name: resolvedEnd,
        mobility_type: mobilityType.value,
        strategy: routeStrategy.value,
      });
      const response = await fetcher(`${currentApiBaseUrl}/api/routes/recommend?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = payload.detail;
        if (detail?.avoided_segments) avoidedSegments.value = detail.avoided_segments;
        throw new Error(
          typeof detail === 'string' ? detail : detail?.message ?? '路线接口暂时不可用'
        );
      }

      routes.value = payload.routes ?? [];
      avoidedSegments.value = payload.avoided_segments ?? [];
      selectedRouteIndex.value = 0;
      selectedSegmentCode.value = routes.value[0]?.segment_codes?.[0] ?? null;
      actionStatus.value = routes.value.length
        ? `已按“${selectedProfile.value?.label}”生成路线，请比较方案后再开始导航。`
        : '没有找到可用路线，请更换目的地或老人画像。';
      return routes.value.length > 0;
    } catch (error) {
      routes.value = [];
      selectedRouteIndex.value = 0;
      errorMessage.value = error instanceof Error
        ? error.message
        : '无法连接后端服务，请确认 FastAPI 已启动。';
      actionStatus.value = '路线生成失败，请检查后端服务。';
      return false;
    } finally {
      loading.value = false;
    }
  }

  function selectRoute(index) {
    if (!routes.value[index]) return;
    selectedRouteIndex.value = index;
    selectedSegmentCode.value = routes.value[index]?.segment_codes?.[0] ?? null;
    actionStatus.value = `已选择推荐路线 ${index + 1}。`;
  }

  function selectSegment(segmentCode) {
    selectedSegmentCode.value = segmentCode;
  }

  function selectStrategy(strategyValue) {
    if (routeStrategy.value === strategyValue) return;
    routeStrategy.value = strategyValue;
    routes.value = [];
    avoidedSegments.value = [];
    selectedRouteIndex.value = 0;
    selectedSegmentCode.value = null;
    errorMessage.value = '';
    actionStatus.value = `已切换为“${selectedStrategy.value?.label}”，请重新生成路线。`;
  }

  function selectMobility(mobilityValue) {
    if (mobilityType.value === mobilityValue) return;
    mobilityType.value = mobilityValue;
    routes.value = [];
    avoidedSegments.value = [];
    selectedRouteIndex.value = 0;
    selectedSegmentCode.value = null;
    errorMessage.value = '';
    actionStatus.value = `已切换为“${selectedProfile.value?.label}”，请重新生成路线。`;
  }

  async function startNavigation() {
    if (!selectedRoute.value) {
      actionStatus.value = '请先生成一条路线。';
      await currentRouter?.push('/elder/plan');
      return false;
    }
    actionStatus.value = '导航已开始，请按语音提示慢行。';
    await currentRouter?.push('/elder/navigation');
    return true;
  }

  async function returnToOptions({ ended = false } = {}) {
    if (ended) actionStatus.value = '导航已结束，您可以重新选择路线。';
    await currentRouter?.replace('/elder/routes');
  }

  return {
    startName, endName, mobilityType, routeStrategy, routes, avoidedSegments,
    selectedRouteIndex, selectedSegmentCode, loading, errorMessage, actionStatus,
    selectedProfile, selectedStrategy, selectedRoute,
    planRoutes, selectRoute, selectSegment, selectStrategy, selectMobility,
    startNavigation, returnToOptions,
    configure(nextOptions = {}) {
      if (nextOptions.getStartOptions) startOptionsGetter = nextOptions.getStartOptions;
      if (nextOptions.getEndOptions) endOptionsGetter = nextOptions.getEndOptions;
      if (nextOptions.profileOptions) currentProfileOptions = nextOptions.profileOptions;
      if (nextOptions.strategyOptions) currentStrategyOptions = nextOptions.strategyOptions;
      if (nextOptions.router) currentRouter = nextOptions.router;
      if (nextOptions.apiBaseUrl !== undefined) currentApiBaseUrl = nextOptions.apiBaseUrl;
    },
  };
}

// A module-scoped instance keeps a planned route alive while legacy pages
// unmount during router navigation, including browser back/forward navigation.
const routePlanner = createRoutePlanner();

export function useRoutePlanner(options = {}) {
  routePlanner.configure(options);
  return routePlanner;
}
