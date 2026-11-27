import { computed, ref, shallowRef, watch } from 'vue';
import { shortestReturnedCandidate } from '../utils/routeComparison.js';
import { completeDetourRoute, createDetourJourney } from './useDetourJourney.js';
import { snapshotRegisteredRoute } from '../utils/detourRestBudget.js';

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
  if (!normalizedInput) return null;
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
  const journeyScope = shallowRef(() => 'local');
  const startName = ref('');
  const currentOrigin = ref(null);
  const startContext = ref(null);
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
  const comparisonState = ref('idle');
  const comparisonError = ref('');
  const walkingReference = ref(null);
  const plannedEndpoints = ref(null);
  let comparisonVersion = 0;
  const restPreview = ref(null);
  const restPreviewState = ref('idle');
  let restPreviewVersion = 0;
  const exclusionState = ref('idle');
  const exclusionPreview = ref(null);
  let exclusionVersion = 0;
  let provenNamedRoutes = new WeakSet();
  let namedRouteEvidence = new WeakMap();
  const navigationContextGetter = shallowRef(() => ({ allowed: false, active: false, index: -1 }));
  const predepartureContextGetter = shallowRef(() => ({ allowed: false, active: false, session: null }));
  const predepartureEpoch = ref(0);
  const navigationTrip = shallowRef(null);
  let tripVersion = 0;
  const sameContext = (a, b) => a && b && ['startName', 'endName', 'mobilityType', 'strategy', 'scope']
    .every(key => a[key] === b[key]);
  const routeIdentity = route => JSON.stringify([route?.distance_m, route?.segment_codes, route?.segments]);

  const selectedProfile = computed(() => currentProfileOptions.find((item) => item.value === mobilityType.value));
  const selectedStrategy = computed(() => currentStrategyOptions.find((item) => item.value === routeStrategy.value));
  const journeyContext = () => ({ startName: startName.value, endName: endName.value,
    mobilityType: mobilityType.value, strategy: routeStrategy.value, scope: journeyScope.value() });
  // Local revocation only; never changes routes, sorting or navigation state.
  // Capture this at request time so late responses cannot authorize a new session.
  watch([() => journeyContext().scope, () => predepartureContextGetter.value().session,
    () => predepartureContextGetter.value().allowed], () => { predepartureEpoch.value++; }, { flush: 'sync' });
  const detour = createDetourJourney({ fetcher, getContext: journeyContext, getApiBase: () => currentApiBaseUrl,
    validatePausedLock: validateNavigationObstruction,
    canContinueNavigation: () => {
      const live = navigationContextGetter.value();
      return live.allowed === true && live.active === true;
    } });
  const selectedRoute = computed(() => detour.session.value
    ? (detour.guiding.value ? detour.route.value : null) : routes.value[selectedRouteIndex.value] ?? null);
  watch(selectedRoute, route => { if (detour.session.value) selectedSegmentCode.value = route?.segment_codes?.[0] ?? null; }, { flush: 'sync' });
  const comparisonAvailable = computed(() => Boolean(selectedRoute.value && plannedEndpoints.value
    && !detour.session.value && !currentOrigin.value && mobilityType.value !== 'INDEPENDENT'));
  const restPreviewAvailable = computed(() => Boolean(selectedRoute.value && plannedEndpoints.value
    && !detour.session.value && !loading.value && !currentOrigin.value && mobilityType.value === 'SLOW_WALKER'));
  const exclusionOptions = computed(() => {
    if (detour.session.value || !plannedEndpoints.value || currentOrigin.value || loading.value) return [];
    const rows = selectedRoute.value?.segments;
    const codes = selectedRoute.value?.segment_codes;
    if (!Array.isArray(rows) || !Array.isArray(codes)) return [];
    return rows.filter(row => codes.includes(row.segment_code) && typeof row.name === 'string' && row.name.trim()
      && codes.filter(code => code === row.segment_code).length === 1
      && rows.filter(other => other.segment_code === row.segment_code).length === 1);
  });

  // Provenance only: the memo builder separately checks registered names and lengths.
  // A manual rest pause does not end the explicitly started ordinary journey.
  const textMemoRouteVerified = computed(() => {
    const live = navigationContextGetter.value(), trip = navigationTrip.value, target = selectedRoute.value;
    if (live.allowed !== true || live.active !== true || loading.value || detour.session.value
        || currentOrigin.value || startContext.value || target?.start_context || !trip || trip.route !== target) return false;
    const context = journeyContext(), evidence = target && namedRouteEvidence.get(target);
    if (!provenNamedRoutes.has(target) || !sameContext(trip.context, context)
        || !sameContext(evidence?.context, context) || trip.identity !== evidence?.identity) return false;
    try {
      if (evidence.identity !== routeIdentity(target)) return false;
    } catch {
      return false;
    }
    return startOptionsGetter().filter(option => option?.value === startName.value).length === 1
      && endOptionsGetter().filter(option => option?.value === endName.value).length === 1;
  });

  const predepartureRouteSource = computed(() => {
    const live = predepartureContextGetter.value(), target = selectedRoute.value;
    if (live.allowed !== true || live.active !== true || loading.value || detour.session.value
        || currentOrigin.value || startContext.value || target?.start_context != null) return null;
    const evidence = target && namedRouteEvidence.get(target);
    if (!provenNamedRoutes.has(target) || evidence?.predepartureEpoch !== predepartureEpoch.value
        || !sameContext(evidence?.context, journeyContext())) return null;
    try {
      if (evidence.identity !== routeIdentity(target)) return null;
    } catch { return null; }
    return startOptionsGetter().filter(option => option?.value === startName.value).length === 1
      && endOptionsGetter().filter(option => option?.value === endName.value).length === 1 ? target : null;
  });

  function navigationObstructionState() {
    const live = navigationContextGetter.value(), trip = navigationTrip.value, target = selectedRoute.value;
    const unavailable = reason => ({ options: [], reason });
    if (detour.session.value) return unavailable('本次绕行已锁定，请在绕行面板操作，不能再排除其他路段。');
    if (live.allowed !== true || live.active !== true) return unavailable('仅老人或游客本次正在进行的导航可使用此操作。');
    const evidence = target && namedRouteEvidence.get(target);
    if (loading.value || currentOrigin.value || startContext.value || target?.start_context || !trip
        || trip.route !== target || !provenNamedRoutes.has(target) || !sameContext(trip.context, journeyContext())
        || !sameContext(evidence?.context, journeyContext()) || evidence?.identity !== routeIdentity(target)
        || trip.identity !== evidence.identity) return unavailable('当前不是已确认开始的可信命名起点路线，请返回规划页核对。');
    if (startOptionsGetter().filter(option => option?.value === startName.value).length !== 1
        || endOptionsGetter().filter(option => option?.value === endName.value).length !== 1) {
      return unavailable('本次起点或目的地登记已变化，请返回规划页核对。');
    }
    const codes = target.segment_codes, rows = target.segments;
    if (!Array.isArray(codes) || !Array.isArray(rows) || !Number.isInteger(live.index)
        || live.index < 0 || live.index >= codes.length) return unavailable('当前手动路线步骤未确认，无法选择要绕开的登记路段。');
    const options = [live.index, live.index + 1].flatMap(index => {
      const code = codes[index], matches = rows.filter(row => row?.segment_code === code);
      if (typeof code !== 'string' || !code.trim() || code.length > 100
          || codes.filter(value => value === code).length !== 1 || matches.length !== 1) return [];
      const row = matches[0];
      if (typeof row.name !== 'string' || !row.name.trim() || rows.filter(other => other?.name === row.name).length !== 1
          || !completeDetourRoute({ distance_m: row.length_m, segment_codes: [code], segments: [row] }, '\u0000')) return [];
      return [{ route: target, trip: trip.version, manualIndex: live.index, index,
        segment_code: code, name: row.name, kind: index === live.index ? 'current' : 'next' }];
    });
    return { options, reason: options.length ? '' : '当前和下一路线步骤没有名称、编号唯一且图形完整的登记路段，不能确认绕开。' };
  }
  const obstructionState = computed(navigationObstructionState);
  function validateNavigationObstruction(choice) {
    // Recompute, rather than trusting the UI's cached options or selected map road.
    const match = navigationObstructionState().options.find(option => option.route === choice?.route
      && ['trip', 'manualIndex', 'index', 'segment_code', 'name', 'kind'].every(key => option[key] === choice[key]));
    return match ? { code: match.segment_code, name: match.name, navigationContext: journeyContext() } : null;
  }
  function lockNavigationObstruction(choice) {
    if (!detour.lockPaused(choice)) return false;
    requestVersion++;
    clearResults(); loading.value = false;
    actionStatus.value = detour.message.value;
    return true;
  }
  watch([selectedRoute, () => journeyContext().scope,
    () => navigationContextGetter.value().allowed, () => navigationContextGetter.value().active],
    () => { navigationTrip.value = null; }, { flush: 'sync' });

  let requestVersion = 0;
  const canUseExclusion = computed(() => Boolean(!detour.session.value && exclusionPreview.value?.navigationContext
    && completeDetourRoute(exclusionPreview.value.route, exclusionPreview.value.code)));
  function useExclusionRoute() {
    if (!detour.activate(exclusionPreview.value)) {
      actionStatus.value = '绕行候选已失效或资料不足，请重新查询并确认；尚未替换当前路线。';
      return false;
    }
    requestVersion++;
    clearRestPreview(); clearComparison();
    avoidedSegments.value = [];
    actionStatus.value = '已使用绕行路线；请明确开始导航，中途重算仍会保留排除条件。';
    return true;
  }
  function cancelDetour() {
    if (!detour.session.value) return;
    detour.pause();
    requestVersion++;
    clearResults();
    detour.cancel();
    actionStatus.value = '已明确取消本次绕行，请重新规划；没有自动开始普通导航。';
  }

  function clearExclusionPreview() {
    exclusionVersion++;
    exclusionState.value = 'idle';
    exclusionPreview.value = null;
  }

  watch(selectedRoute, clearExclusionPreview, { flush: 'sync' });

  async function previewExclusion(code) {
    const segment = exclusionOptions.value.find(row => row.segment_code === code);
    clearExclusionPreview();
    if (!segment) return false;
    const version = exclusionVersion, planVersion = requestVersion;
    const baselineDistance = selectedRoute.value?.distance_m;
    const baselineRoute = snapshotRegisteredRoute(selectedRoute.value);
    const baselineVerified = provenNamedRoutes.has(selectedRoute.value);
    const context = journeyContext();
    exclusionState.value = 'loading';
    try {
      const params = new URLSearchParams({ ...plannedEndpoints.value, mobility_type: mobilityType.value,
        strategy: routeStrategy.value, exclude_segment_code: code });
      const response = await fetcher(`${currentApiBaseUrl}/api/routes/recommend?${params}`);
      const payload = await response.json();
      if (version !== exclusionVersion || planVersion !== requestVersion) return false;
      if (!response.ok) {
        if (response.status === 404 && payload?.detail?.code === 'NO_ROUTE_WITH_EXCLUSION') {
          exclusionState.value = 'empty';
          return false;
        }
        throw new Error('unconfirmed');
      }
      if (payload.excluded_segment_code !== code || !Array.isArray(payload.routes) || !payload.routes.length
          || !Number.isFinite(baselineDistance) || baselineDistance < 0
          || !payload.routes.every(route => Number.isFinite(route.distance_m) && route.distance_m > 0
            && Array.isArray(route.segment_codes) && route.segment_codes.length > 0
            && !route.segment_codes.includes(code) && route.segment_codes.every(value => typeof value === 'string' && value)
            && Array.isArray(route.segments) && route.segments.length === route.segment_codes.length
            && new Set(route.segment_codes).size === route.segment_codes.length
            && route.segment_codes.every(value => route.segments.filter(row => row.segment_code === value).length === 1)
            && !route.segments.some(row => row.segment_code === code))) throw new Error('invalid exclusion data');
      const verified = payload.start_name === context.startName && payload.end_name === context.endName
        && payload.mobility_type === context.mobilityType && payload.strategy === context.strategy;
      exclusionPreview.value = { code, name: segment.name, route: payload.routes[0], baselineDistance,
        restBudgetEvidence: { baselineRoute, contextVerified: baselineVerified && verified && !payload.start_context,
          startName: context.startName, endName: context.endName },
        createdAt: Date.now(), navigationContext: verified ? context : null };
      exclusionState.value = 'ready';
      return true;
    } catch {
      if (version !== exclusionVersion || planVersion !== requestVersion) return false;
      exclusionState.value = 'error';
      return false;
    }
  }

  function clearRestPreview() {
    restPreviewVersion++;
    restPreview.value = null;
    restPreviewState.value = 'idle';
  }

  async function previewRestRoute() {
    if (!restPreviewAvailable.value) return false;
    clearRestPreview();
    const version = restPreviewVersion;
    const planVersion = requestVersion;
    restPreviewState.value = 'loading';
    try {
      const params = new URLSearchParams({ ...plannedEndpoints.value,
        mobility_type: mobilityType.value, strategy: routeStrategy.value, prefer_rest: 'true' });
      const response = await fetcher(`${currentApiBaseUrl}/api/routes/recommend?${params}`);
      const payload = await response.json();
      if (version !== restPreviewVersion || planVersion !== requestVersion) return false;
      if (!response.ok || !Array.isArray(payload?.routes) || !payload.routes.length) throw new Error('unconfirmed');
      if (payload.rest_preview === null) {
        restPreviewState.value = 'empty';
        return false;
      }
      const preview = payload.rest_preview;
      const named = value => typeof value === 'string' && value.trim().length > 0;
      const steps = value => value === null || (Number.isInteger(value) && value >= 0);
      if (!preview || !named(preview.stop_name)
          || !Number.isFinite(preview.distance_m) || preview.distance_m <= 0
          || !Number.isFinite(preview.baseline_distance_m) || preview.baseline_distance_m <= 0
          || !steps(preview.steps) || !steps(preview.baseline_steps)
          || !Array.isArray(preview.segment_codes) || preview.segment_codes.length < 2
          || !preview.segment_codes.every(named) || new Set(preview.segment_codes).size !== preview.segment_codes.length
          || !Array.isArray(preview.segment_names) || preview.segment_names.length !== preview.segment_codes.length
          || !preview.segment_names.every(named) || !Number.isInteger(preview.stop_after_segment_index)
          || preview.stop_after_segment_index < 0 || preview.stop_after_segment_index >= preview.segment_codes.length - 1
          || typeof preview.matches_baseline !== 'boolean') throw new Error('incomplete preview');
      const budgetContextConfirmed = payload.start_name === plannedEndpoints.value.start_name
        && payload.end_name === plannedEndpoints.value.end_name && payload.mobility_type === mobilityType.value
        && payload.strategy === routeStrategy.value && !payload.start_context
        && payload.routes[0]?.distance_m === preview.baseline_distance_m;
      restPreview.value = { ...preview, segment_lengths_m: budgetContextConfirmed ? preview.segment_lengths_m : null };
      restPreviewState.value = 'ready';
      return true;
    } catch {
      if (version !== restPreviewVersion || planVersion !== requestVersion) return false;
      restPreviewState.value = 'error';
      return false;
    }
  }

  function clearComparison() {
    comparisonVersion++;
    walkingReference.value = null;
    comparisonState.value = 'idle';
    comparisonError.value = '';
  }

  async function compareWalkingRoute() {
    if (!comparisonAvailable.value) return false;
    clearComparison();
    const version = comparisonVersion;
    const planVersion = requestVersion;
    comparisonState.value = 'loading';
    try {
      const params = new URLSearchParams({ ...plannedEndpoints.value, mobility_type: 'INDEPENDENT', strategy: 'SHORTEST' });
      const response = await fetcher(`${currentApiBaseUrl}/api/routes/recommend?${params}`);
      const payload = await response.json();
      if (version !== comparisonVersion || planVersion !== requestVersion) return false;
      if (!response.ok) throw new Error('reference unavailable');
      walkingReference.value = shortestReturnedCandidate(payload.routes);
      comparisonState.value = walkingReference.value ? 'ready' : 'empty';
      return Boolean(walkingReference.value);
    } catch {
      if (version !== comparisonVersion || planVersion !== requestVersion) return false;
      comparisonError.value = '普通步行参考暂时无法获取，可重试；当前路线与导航不受影响。';
      comparisonState.value = 'error';
      return false;
    }
  }

  function clearResults() {
    provenNamedRoutes = new WeakSet();
    namedRouteEvidence = new WeakMap();
    navigationTrip.value = null;
    clearExclusionPreview();
    clearRestPreview();
    clearComparison();
    plannedEndpoints.value = null;
    routes.value = [];
    avoidedSegments.value = [];
    selectedRouteIndex.value = 0;
    selectedSegmentCode.value = null;
    errorMessage.value = '';
    startContext.value = null;
  }

  function clearCurrentOrigin() {
    const previous = currentOrigin.value;
    currentOrigin.value = null;
    if (previous && startName.value === previous.label) startName.value = '';
  }

  function setCurrentOrigin(sample, candidate) {
    if (detour.session.value) { detour.pause('绕行中请使用专用重新定位入口，排除条件仍保留。'); return; }
    const label = `当前位置附近 · ${candidate.name}`;
    startName.value = label;
    currentOrigin.value = { ...sample, segmentCode: candidate.segment_code, label, mobilityType: mobilityType.value };
  }

  function beginCurrentOrigin() {
    if (detour.session.value) { detour.pause('绕行中请使用专用重新定位入口，排除条件仍保留。'); return; }
    clearCurrentOrigin();
    requestVersion++;
    clearResults();
    loading.value = false;
    actionStatus.value = '正在获取当前位置，请确认道路后重新查询路线。';
  }

  watch([startName, mobilityType], () => {
    if (currentOrigin.value && (startName.value !== currentOrigin.value.label || mobilityType.value !== currentOrigin.value.mobilityType)) {
      clearCurrentOrigin();
    }
  }, { flush: 'sync' });

  // Inputs are also assigned directly by v-model and session restoration.
  // Invalidate synchronously so navigation cannot observe an obsolete route.
  watch([startName, endName, mobilityType, routeStrategy, currentOrigin], () => {
    if (detour.session.value) detour.pause('出行条件已变化，绕行约束仍保留；请恢复原条件或明确取消。');
    requestVersion += 1;
    clearResults();
    loading.value = false;
    actionStatus.value = '出行条件已更新，请重新生成路线。';
  }, { flush: 'sync' });

  async function planRoutes() {
    if (detour.session.value) {
      detour.pause('绕行中不能从旧命名起点重算，请在绕行面板重新定位并确认。');
      return false;
    }
    let version = ++requestVersion;
    clearResults();
    loading.value = false;
    actionStatus.value = '正在根据老人画像重新计算适老路线。';

    try {
      const origin = currentOrigin.value;
      if (origin && (Date.now() - origin.timestamp > 60000 || origin.timestamp > Date.now() + 5000)) {
        throw new Error('当前位置已过期，请重新点击“使用当前位置”。');
      }
      const resolvedStart = origin?.label || resolvePilotLocation(startName.value, startOptionsGetter());
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
      // Normalization may trigger the input watcher; claim this request only
      // after both normalized values have been committed.
      version = ++requestVersion;
      loading.value = true;
      actionStatus.value = '正在根据老人画像重新计算适老路线。';
      const queryPredepartureEpoch = predepartureEpoch.value;
      const params = new URLSearchParams({
        ...(!origin ? { start_name: resolvedStart } : {}),
        end_name: resolvedEnd,
        mobility_type: mobilityType.value,
        strategy: routeStrategy.value,
      });
      if (origin) {
        params.set('start_longitude', origin.longitude);
        params.set('start_latitude', origin.latitude);
        params.set('start_accuracy', origin.accuracy);
        params.set('start_timestamp_ms', origin.timestamp);
        params.set('start_segment_code', origin.segmentCode);
      }
      const response = await fetcher(`${currentApiBaseUrl}/api/routes/recommend?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (version !== requestVersion) return false;

      if (!response.ok) {
        const detail = payload.detail;
        if (detail?.avoided_segments) avoidedSegments.value = detail.avoided_segments;
        throw new Error(
          typeof detail === 'string' ? detail : detail?.message ?? '路线接口暂时不可用'
        );
      }

      routes.value = (payload.routes ?? []).map(route => ({ ...route, mobility_type: mobilityType.value }));
      startContext.value = payload.start_context ?? null;
      if (startContext.value) {
        routes.value = routes.value.map(route => ({ ...route, start_context: startContext.value }));
      }
      if (!origin && !startContext.value && payload.start_name === resolvedStart && payload.end_name === resolvedEnd
          && payload.mobility_type === mobilityType.value && payload.strategy === routeStrategy.value) {
        routes.value.forEach(route => {
          provenNamedRoutes.add(route);
          namedRouteEvidence.set(route, { context: journeyContext(), identity: routeIdentity(route),
            predepartureEpoch: queryPredepartureEpoch });
        });
      }
      avoidedSegments.value = payload.avoided_segments ?? [];
      selectedRouteIndex.value = 0;
      plannedEndpoints.value = !origin ? { start_name: resolvedStart, end_name: resolvedEnd } : null;
      selectedSegmentCode.value = routes.value[0]?.segment_codes?.[0] ?? null;
      actionStatus.value = routes.value.length
        ? `已按“${selectedProfile.value?.label}”生成路线，请比较方案后再开始导航。`
        : '没有找到可用路线，请更换目的地或老人画像。';
      return routes.value.length > 0;
    } catch (error) {
      if (version !== requestVersion) return false;
      errorMessage.value = error instanceof TypeError
        ? '暂时无法连接路线服务，请检查网络后重试。'
        : error instanceof Error
        ? error.message
        : '无法连接后端服务，请确认 FastAPI 已启动。';
      actionStatus.value = '未能生成路线，请查看提示并调整出行条件。';
      return false;
    } finally {
      if (version === requestVersion) loading.value = false;
    }
  }

  function selectRoute(index) {
    if (detour.session.value) { detour.pause('不能切回普通方案；请重新确认绕行或明确取消。'); return; }
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
    actionStatus.value = `已切换为“${selectedStrategy.value?.label}”，请重新生成路线。`;
  }

  function selectMobility(mobilityValue) {
    if (mobilityType.value === mobilityValue) return;
    mobilityType.value = mobilityValue;
    actionStatus.value = `已切换为“${selectedProfile.value?.label}”，请重新生成路线。`;
  }

  async function startNavigation() {
    if (detour.session.value && !detour.guiding.value) return false;
    if (!selectedRoute.value) {
      actionStatus.value = '请先生成一条路线。';
      await currentRouter?.push('/elder/plan');
      return false;
    }
    const target = selectedRoute.value, context = journeyContext(), evidence = namedRouteEvidence.get(target);
    const version = ++tripVersion;
    navigationTrip.value = null;
    actionStatus.value = '导航已开始，请按语音提示慢行。';
    await currentRouter?.push('/elder/navigation');
    if (version === tripVersion && selectedRoute.value === target && sameContext(context, journeyContext())
        && evidence && sameContext(evidence.context, context) && evidence.identity === routeIdentity(target)) {
      navigationTrip.value = { route: target, context, identity: evidence.identity, version };
    }
    return true;
  }

  async function returnToOptions({ ended = false } = {}) {
    navigationTrip.value = null;
    if (ended && detour.session.value) cancelDetour();
    if (ended) actionStatus.value = '导航已结束，您可以重新选择路线。';
    await currentRouter?.replace('/elder/routes');
  }

  return {
    startName, currentOrigin, startContext, setCurrentOrigin, clearCurrentOrigin, beginCurrentOrigin, endName, mobilityType, routeStrategy, routes, avoidedSegments,
    selectedRouteIndex, selectedSegmentCode, loading, errorMessage, actionStatus,
    selectedProfile, selectedStrategy, selectedRoute, textMemoRouteVerified, predepartureRouteSource,
    comparisonAvailable, comparisonState, comparisonError, walkingReference, compareWalkingRoute,
    restPreviewAvailable, restPreviewState, restPreview, previewRestRoute, clearRestPreview,
    exclusionOptions, exclusionState, exclusionPreview, previewExclusion, clearExclusionPreview,
    detour, canUseExclusion, useExclusionRoute, cancelDetour, obstructionState, lockNavigationObstruction,
    planRoutes, selectRoute, selectSegment, selectStrategy, selectMobility,
    startNavigation, returnToOptions,
    configure(nextOptions = {}) {
      if (nextOptions.getStartOptions) startOptionsGetter = nextOptions.getStartOptions;
      if (nextOptions.getEndOptions) endOptionsGetter = nextOptions.getEndOptions;
      if (nextOptions.profileOptions) currentProfileOptions = nextOptions.profileOptions;
      if (nextOptions.strategyOptions) currentStrategyOptions = nextOptions.strategyOptions;
      if (nextOptions.router) currentRouter = nextOptions.router;
      if (nextOptions.apiBaseUrl !== undefined) currentApiBaseUrl = nextOptions.apiBaseUrl;
      if (nextOptions.getJourneyScope) journeyScope.value = nextOptions.getJourneyScope;
      if (nextOptions.getNavigationContext) navigationContextGetter.value = nextOptions.getNavigationContext;
      if (nextOptions.getPredepartureContext) predepartureContextGetter.value = nextOptions.getPredepartureContext;
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
