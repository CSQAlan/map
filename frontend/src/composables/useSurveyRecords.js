import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue';

function readableError(error, label) {
  if (error.name === 'TimeoutError') return `${label}读取超时，请稍后重试。`;
  if (error.status === 401 || error.status === 403) return '登录状态已失效，请重新登录后再试。';
  if (error.status) return `${label}暂时无法读取，请稍后重试。`;
  return '暂时无法连接资料服务，请检查网络后重试。';
}

export function useSurveyRecords({ apiBaseUrl, accessToken = () => '', requestTimeoutMs = 15000 }) {
  const sites = ref([]);
  const features = ref([]);
  const selectedSiteCode = ref('');
  const selectedRecordCode = ref(null);
  const pendingCoordinate = ref(null);
  const loading = ref(false);
  const sitesLoading = ref(false);
  const saving = ref(false);
  const message = ref('');
  const errorMessage = ref('');
  const siteError = ref('');
  let disposed = false;
  let selectionRevision = 0;

  const selectedFeature = computed(() =>
    features.value.find(feature => feature.properties.record_code === selectedRecordCode.value) ?? null
  );
  const selectedPhotos = computed(() => selectedFeature.value?.properties.evidence_photos ?? []);
  const unlocatedFeatures = computed(() => features.value.filter(feature => !feature.geometry));
  const allLocatedCenter = computed(() => {
    const points = features.value.map(feature => feature.geometry?.coordinates)
      .filter(point => Array.isArray(point) && point.length >= 2 && point.slice(0, 2).every(Number.isFinite));
    return points.length ? [0, 1].map(axis => points.reduce((sum, point) => sum + point[axis], 0) / points.length) : [];
  });

  // Guard generations as well as AbortSignal: transports can ignore cancellation.
  function createReader(busy, errorRef, label, clear, apply) {
    let generation = 0;
    let cancel = () => {};
    function invalidate() { generation++; cancel(); busy.value = false; }
    async function read(path) {
      if (disposed) return;
      invalidate();
      const attempt = generation;
      const controller = new AbortController();
      busy.value = true;
      errorRef.value = '';
      clear();
      let timer;
      const interruption = new Promise((_, reject) => {
        cancel = () => { reject(new DOMException('Cancelled', 'AbortError')); controller.abort(); clearTimeout(timer); };
        timer = setTimeout(() => {
          reject(new DOMException('Timed out', 'TimeoutError'));
          controller.abort();
        }, requestTimeoutMs);
      });
      try {
        const request = (async () => {
          const response = await fetch(`${apiBaseUrl}${path}`, { signal: controller.signal });
          if (!response.ok) throw Object.assign(new Error('HTTP error'), { status: response.status });
          return response.json();
        })();
        const payload = await Promise.race([request, interruption]);
        if (!disposed && attempt === generation) apply(payload);
      } catch (error) {
        if (!disposed && attempt === generation && error.name !== 'AbortError') {
          errorRef.value = readableError(error, label);
        }
      } finally {
        clearTimeout(timer);
        if (attempt === generation) { busy.value = false; cancel = () => {}; }
      }
    }
    return { read, invalidate };
  }

  const siteReader = createReader(sitesLoading, siteError, '地点', () => {}, payload => {
    if (!Array.isArray(payload)) throw new Error('Invalid sites');
    sites.value = payload;
  });
  const recordReader = createReader(loading, errorMessage, '资料', () => {
    selectionRevision++;
    features.value = [];
    selectedRecordCode.value = null;
    pendingCoordinate.value = null;
    message.value = '';
  }, payload => {
    if (!Array.isArray(payload.features)) throw new Error('Invalid records');
    features.value = payload.features;
    selectedRecordCode.value = features.value[0]?.properties.record_code ?? null;
    pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
  });

  function loadSites() { return siteReader.read('/api/survey-records/sites'); }
  function loadRecords() {
    const query = new URLSearchParams({ coordinate_system: 'GCJ02' });
    if (selectedSiteCode.value) query.set('site_code', selectedSiteCode.value);
    return recordReader.read(`/api/survey-records?${query}`);
  }
  function reload() { return Promise.all([loadSites(), loadRecords()]); }

  function selectRecord(recordCode) {
    if (!features.value.some(feature => feature.properties.record_code === recordCode)) return;
    selectionRevision++;
    selectedRecordCode.value = recordCode;
    pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
    message.value = '';
    errorMessage.value = '';
  }

  async function saveLocation() {
    if (disposed || !selectedFeature.value || !pendingCoordinate.value || saving.value || loading.value) return;
    const code = selectedRecordCode.value;
    const site = selectedSiteCode.value;
    const coordinates = [...pendingCoordinate.value];
    const revision = selectionRevision;
    const current = () => !disposed && revision === selectionRevision;
    saving.value = true;
    message.value = '';
    errorMessage.value = '';
    const controller = new AbortController();
    let timer;
    try {
      const request = (async () => {
        const response = await fetch(`${apiBaseUrl}/api/survey-records/${encodeURIComponent(code)}/location`, {
          method: 'PATCH',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${typeof accessToken === 'function' ? accessToken() : accessToken}`,
          },
          body: JSON.stringify({ longitude: coordinates[0], latitude: coordinates[1], coordinate_system: 'GCJ02' }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error('Save failed'), { status: response.status });
        return payload;
      })();
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new DOMException('Timed out', 'TimeoutError'));
          controller.abort();
        }, requestTimeoutMs);
      });
      const payload = await Promise.race([request, deadline]);
      if (!disposed && site === selectedSiteCode.value) {
        features.value = features.value.map(feature => feature.properties.record_code === code ? {
          ...feature, geometry: payload.geometry ?? { type: 'Point', coordinates },
          properties: { ...feature.properties, location_source: payload.location_source ?? 'MANUAL' },
        } : feature);
      }
      if (current()) {
        // A new map click while saving remains an unsaved draft.
        if (pendingCoordinate.value?.every((value, index) => value === coordinates[index])) {
          pendingCoordinate.value = payload.geometry?.coordinates ?? coordinates;
          message.value = '位置已保存；记录仍处于待核查状态，不会用于路线推荐。';
        } else {
          message.value = '上一个位置已保存；您刚选择的新位置尚未保存。资料仍待核查。';
        }
      }
    } catch (error) {
      if (current()) errorMessage.value = error.status === 401 || error.status === 403
        ? '登录状态已失效，请重新登录后再试。'
        : '位置保存未确认，请检查网络并重新读取资料，核对位置后再保存。';
    } finally { clearTimeout(timer); if (!disposed) saving.value = false; }
  }

  const stop = watch(selectedSiteCode, loadRecords, { flush: 'sync' });
  function dispose() {
    disposed = true;
    selectionRevision++;
    stop(); siteReader.invalidate(); recordReader.invalidate();
  }
  if (getCurrentScope()) onScopeDispose(dispose);

  return {
    sites, features, selectedSiteCode, selectedRecordCode, pendingCoordinate,
    loading, sitesLoading, saving, message, errorMessage, siteError,
    selectedFeature, selectedPhotos, unlocatedFeatures, allLocatedCenter,
    loadSites, loadRecords, reload, dispose, selectRecord, saveLocation,
  };
}
