import { computed, ref } from 'vue';

const named = value => typeof value === 'string' && value.trim().length > 0;
const copy = value => JSON.parse(JSON.stringify(value));
const point = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
// Phase A keeps the source segment code on clipped edges. Reject aliases too;
// never interpret an unrecognized derived code as evidence of exclusion.
export const excludedAlias = (value, code) => !named(value) || value.includes(code);
export function completeDetourRoute(route, code) {
  const codes = route?.segment_codes, rows = route?.segments;
  return Number.isFinite(route?.distance_m) && route.distance_m > 0
    && Array.isArray(codes) && codes.length > 0 && new Set(codes).size === codes.length
    && codes.every(value => !excludedAlias(value, code))
    && Array.isArray(rows) && rows.length === codes.length
    && rows.every((row, i) => row?.segment_code === codes[i] && !excludedAlias(row.segment_code, code)
      && named(row.name) && Number.isFinite(row.length_m) && row.length_m > 0
      && Array.isArray(row.geometry_coordinates) && row.geometry_coordinates.length >= 2
      && row.geometry_coordinates.every(point)
      && row.geometry_coordinates.some(p => p[0] !== row.geometry_coordinates[0][0] || p[1] !== row.geometry_coordinates[0][1]));
}

export function createDetourJourney({ fetcher, getContext, getApiBase = () => '', now = Date.now, timeoutMs = 12000,
  validatePausedLock = () => null, canContinueNavigation = () => false }) {
  const session = ref(null), phase = ref('idle'), route = ref(null), pending = ref(null);
  const candidates = ref([]), message = ref('');
  let generation = 0, fix = null, lastTimestamp = -Infinity;
  const contextMatches = () => {
    const current = getContext(), locked = session.value;
    return locked && (locked.source !== 'navigation-obstruction' || canContinueNavigation())
      && ['endName', 'mobilityType', 'strategy', 'scope'].every(key => current[key] === locked[key]);
  };
  const guiding = computed(() => Boolean(session.value && phase.value === 'active' && route.value && contextMatches()));
  function pause(reason = '绕行引导已暂停，请停在安全处，重新定位并确认路线。') {
    if (!session.value) return;
    generation++;
    route.value = null; pending.value = null; candidates.value = []; fix = null;
    phase.value = 'paused'; message.value = reason;
    session.value = { ...session.value, generation };
  }
  function activate(preview) {
    if (session.value || !preview?.navigationContext || !named(preview.code) || preview.code.length > 100
        || !named(preview.name) || !Number.isFinite(preview.createdAt) || now() - preview.createdAt > 60000
        || preview.createdAt > now() || !completeDetourRoute(preview.route, preview.code)) return false;
    const context = getContext();
    if (!['startName', 'endName', 'mobilityType', 'strategy', 'scope'].every(key => preview.navigationContext[key] === context[key])) return false;
    generation++;
    session.value = { ...copy(context), code: preview.code, name: preview.name, confirmedSegment: null, generation };
    route.value = { ...copy(preview.route), mobility_type: context.mobilityType };
    phase.value = 'active'; message.value = '已明确启用绕行；中途重算仍保留本次排除。';
    return true;
  }
  // This entry has no route candidate and cannot reuse a predeparture preview.
  // The planner resolves the exact live trip/step again, even for direct callers.
  function lockPaused(choice) {
    if (session.value) return false;
    const trusted = validatePausedLock(choice);
    const context = getContext();
    if (!trusted || !named(trusted.code) || trusted.code.length > 100 || !named(trusted.name)
        || !['startName', 'endName', 'mobilityType', 'strategy', 'scope']
          .every(key => trusted.navigationContext?.[key] === context[key])) return false;
    generation++;
    route.value = null; pending.value = null; candidates.value = []; fix = null; lastTimestamp = -Infinity;
    session.value = { ...copy(context), code: trusted.code, name: trusted.name,
      source: 'navigation-obstruction', confirmedSegment: null, generation };
    phase.value = 'paused';
    message.value = `已标记要绕开“${trusted.name}”，导航已暂停，尚未找到新路线。请按“从当前位置重新规划绕行”，再核对道路和新路线。`;
    return true;
  }
  function validFix(sample) {
    return sample && [sample.longitude, sample.latitude, sample.accuracy, sample.timestamp].every(Number.isFinite)
      && Math.abs(sample.longitude) <= 180 && Math.abs(sample.latitude) <= 90
      && sample.accuracy >= 0 && sample.accuracy <= 30
      && now() - sample.timestamp <= 60000 && sample.timestamp <= now() + 5000;
  }
  async function timed(task) {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('请求超时，保持排除并暂停引导，请重试。')), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  }
  async function request(path, params) {
    const response = await timed(() => fetcher(`${getApiBase()}/api/routes/${path}?${new URLSearchParams(params)}`));
    const payload = await timed(() => response.json());
    if (!response.ok) throw new Error(payload?.detail?.message || '绕行暂未确认，可能无符合条件的路线或网络失败，请停在安全处重试。');
    if (payload?.excluded_segment_code !== session.value?.code) throw new Error('排除码回显不匹配，已暂停，不能使用该结果。');
    return payload;
  }
  async function replan(capture) {
    if (!session.value) return false;
    pause();
    if (!contextMatches()) { message.value = '行程上下文已改变，请恢复原出行条件或明确取消本次绕行。'; return false; }
    const version = generation;
    phase.value = 'locating';
    try {
      const sample = await timed(capture);
      if (version !== generation) return false;
      if (!contextMatches()) { pause('行程上下文已改变，保持暂停，请核对出行条件。'); return false; }
      if (!validFix(sample) || sample.timestamp <= lastTimestamp) throw new Error('位置缺失、精度不足、重复或已过期，请重新获取新鲜位置。');
      lastTimestamp = sample.timestamp;
      fix = copy(sample);
      const locked = session.value;
      phase.value = 'matching';
      const payload = await request('start-options', { longitude: fix.longitude, latitude: fix.latitude,
        accuracy: fix.accuracy, timestamp_ms: fix.timestamp, mobility_type: locked.mobilityType,
        area_code: 'SHIDAYUAN', exclude_segment_code: locked.code });
      if (version !== generation) return false;
      if (!validFix(fix) || !contextMatches() || !Array.isArray(payload.candidates)
          || payload.candidates.length === 0
          || new Set(payload.candidates.map(row => row?.segment_code)).size !== payload.candidates.length
          || (locked.source === 'navigation-obstruction'
            && new Set(payload.candidates.map(row => row?.name)).size !== payload.candidates.length)
          || payload.candidates.some(row => !row || excludedAlias(row.segment_code, locked.code)
            || !named(row.name) || typeof row.allowed !== 'boolean'
            || !Number.isFinite(row.distance_m) || row.distance_m < 0 || row.distance_m > 20 || !point(row.snapped_coordinates))) {
        throw new Error('附近替代路段资料不足或位置已过期，已暂停，请重试。');
      }
      candidates.value = copy(payload.candidates.filter(row => row.allowed));
      if (!candidates.value.length) throw new Error('没有符合当前画像的替代接入段，不能回到被排除段。');
      phase.value = 'confirm-start'; message.value = '请明确确认您实际所在的替代路段；还未开始新路线。';
      return true;
    } catch (error) {
      if (version === generation) pause(error?.message || '定位失败，已暂停绕行引导，请重试。');
      return false;
    }
  }
  async function confirmStart(code) {
    if (!session.value || phase.value !== 'confirm-start') return false;
    const selected = candidates.value.find(row => row.segment_code === code);
    if (!selected || !validFix(fix) || !contextMatches()) { pause('路段未确认或位置过期，请重新定位。'); return false; }
    const version = ++generation, locked = session.value, sample = copy(fix);
    session.value = { ...locked, confirmedSegment: code, generation };
    phase.value = 'planning'; candidates.value = [];
    try {
      const payload = await request('recommend', { start_longitude: sample.longitude, start_latitude: sample.latitude,
        start_accuracy: sample.accuracy, start_timestamp_ms: sample.timestamp, start_segment_code: code,
        end_name: locked.endName, mobility_type: locked.mobilityType, strategy: locked.strategy,
        area_code: 'SHIDAYUAN', exclude_segment_code: locked.code });
      if (version !== generation) return false;
      if (!contextMatches() || !validFix(sample) || payload.end_name !== locked.endName
          || payload.mobility_type !== locked.mobilityType || payload.strategy !== locked.strategy
          || payload.start_context?.segment_code !== code
          || (locked.source === 'navigation-obstruction' && payload.start_context?.name !== selected.name)
          || !named(payload.start_context?.name) || !point(payload.start_context?.snapped_coordinates)
          || !Number.isFinite(payload.start_context?.distance_m) || payload.start_context.distance_m < 0
          || payload.start_context.distance_m > 20
          || !payload.start_context.snapped_coordinates.every((value, i) => value === selected.snapped_coordinates[i])
          || !Array.isArray(payload.routes) || !payload.routes.length
          || !payload.routes.every(candidate => completeDetourRoute(candidate, locked.code)
            && candidate.segments[0].geometry_coordinates[0].every((value, i) => value === payload.start_context.snapped_coordinates[i]))) {
        throw new Error('新路线、目的地或排除条件未确认，保持暂停，不使用旧路线。');
      }
      pending.value = { ...copy(payload.routes[0]), start_context: copy(payload.start_context), mobility_type: locked.mobilityType };
      phase.value = 'confirm-route'; message.value = '新方案已查询，请明确使用后再继续；旧引导仍暂停。';
      return true;
    } catch (error) {
      if (version === generation) pause(error?.message || '绕行重算失败，请重试。');
      return false;
    }
  }
  function confirmRoute() {
    if (phase.value !== 'confirm-route' || !contextMatches() || !validFix(fix)
        || !completeDetourRoute(pending.value, session.value.code)) {
      if (session.value) pause('候选已失效，请重新定位并确认。');
      return false;
    }
    route.value = pending.value; pending.value = null; phase.value = 'active';
    message.value = '已明确使用最新绕行路线。';
    return true;
  }
  function cancel() {
    generation++;
    route.value = null; pending.value = null; candidates.value = []; fix = null;
    session.value = null; phase.value = 'idle'; message.value = ''; lastTimestamp = -Infinity;
  }
  return { session, phase, route, pending, candidates, message, guiding, activate, lockPaused, pause, replan, confirmStart, confirmRoute, cancel };
}
