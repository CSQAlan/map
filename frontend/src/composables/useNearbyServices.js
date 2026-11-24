import { ref, watch } from 'vue';

const SERVICES = new Set(['REST_AREA', 'SERVICE_ACCESS']);
const NO_PATH = '现有路网中没有符合当前出行条件的可达路线';
const MAX_SERVICES = 3;

function classify(response, body, start, end, mobility) {
  if (response.status === 404 && typeof body?.detail?.message === 'string'
      && body.detail.message.startsWith(NO_PATH) && Array.isArray(body.detail.avoided_segments)) {
    return { state: 'unreachable' };
  }
  const route = Array.isArray(body?.routes) ? body.routes[0] : null;
  if (response.ok && body?.start_name === start && body?.end_name === end
      && body?.mobility_type === mobility && Number.isFinite(route?.distance_m)
      && route.distance_m > 0 && Array.isArray(route.segment_codes) && route.segment_codes.length) {
    return { state: 'reachable', distance: route.distance_m };
  }
  return { state: 'unknown' };
}

export function createNearbyServices({
  origin, profile, pois, enabled, apiBaseUrl = '',
  fetcher = (...args) => fetch(...args), timeoutMs = 5000,
}) {
  const results = ref([]);
  const status = ref('idle');
  const message = ref('');
  let version = 0;
  let active;
  function clear() {
    ++version;
    active?.abort();
    active = undefined;
    results.value = [];
    status.value = 'idle';
    message.value = '';
  }
  watch([origin, profile, pois, enabled], clear, { flush: 'sync' });

  async function checkOne(poi, start, mobility, batchSignal) {
    const params = new URLSearchParams({
      area_code: 'SHIDAYUAN', start_name: start, end_name: poi.name,
      mobility_type: mobility, strategy: 'BALANCED',
    });
    let timer;
    const request = new AbortController();
    let completeAbort;
    const cancelled = new Promise(resolve => { completeAbort = resolve; });
    const onAbort = () => { request.abort(); completeAbort({ state: 'unknown' }); };
    batchSignal.addEventListener('abort', onAbort, { once: true });
    try {
      if (batchSignal.aborted) return { ...poi, state: 'unknown' };
      timer = setTimeout(onAbort, timeoutMs);
      const outcome = await Promise.race([
        (async () => {
          const response = await fetcher(apiBaseUrl + '/api/routes/recommend?' + params, { signal: request.signal });
          return classify(response, await response.json(), start, poi.name, mobility);
        })(),
        cancelled,
      ]);
      return { ...poi, ...outcome };
    } catch {
      return { ...poi, state: 'unknown' };
    } finally {
      clearTimeout(timer);
      batchSignal.removeEventListener('abort', onAbort);
    }
  }

  async function query() {
    clear();
    const ticket = version;
    const start = origin.value;
    const mobility = profile.value;
    const directory = pois.value;
    if (!enabled.value || !start) {
      message.value = '请先手动选择一个试点出发地点，再查附近服务。';
      return;
    }
    if (!Array.isArray(directory)) {
      message.value = '暂时无法读取试点服务名单，不能确认可达性。';
      return;
    }
    if (!mobility || !directory.some(row => row.name === start)) {
      message.value = '请选择服务端名单中的出发地点和出行方式。';
      return;
    }
    const candidates = [...new Map(directory
      .filter(row => row.name !== start && SERVICES.has(row.poi_type))
      .map(row => [row.name, { name: row.name, type: row.poi_type }])).values()].slice(0, MAX_SERVICES);
    if (!candidates.length) {
      message.value = '试点名单中暂无可查询的其他休息区或生活服务方向。';
      return;
    }
    const batch = new AbortController();
    active = batch;
    status.value = 'loading';
    const rows = await Promise.all(candidates.map(poi => checkOne(poi, start, mobility, batch.signal)));
    if (ticket !== version) return;
    const order = { reachable: 0, unreachable: 1, unknown: 2 };
    results.value = rows.sort((a, b) => order[a.state] - order[b.state]
      || (a.state === 'reachable' ? a.distance - b.distance : 0));
    status.value = 'ready';
    active = undefined;
  }

  function canChoose(name) {
    return status.value === 'ready' && results.value.some(row => row.name === name && row.state === 'reachable');
  }
  return { results, status, message, query, canChoose };
}
