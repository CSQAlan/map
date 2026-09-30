import { computed, ref, watch } from 'vue';

export function useSurveyRecords({ apiBaseUrl, accessToken = () => '' }) {
  const sites = ref([]);
  const features = ref([]);
  const selectedSiteCode = ref('');
  const selectedRecordCode = ref(null);
  const pendingCoordinate = ref(null);
  const loading = ref(false);
  const saving = ref(false);
  const message = ref('');
  const errorMessage = ref('');
  const siteError = ref('');

  const selectedFeature = computed(() =>
    features.value.find((feature) => feature.properties.record_code === selectedRecordCode.value) ?? null
  );
  const selectedPhotos = computed(() => selectedFeature.value?.properties.evidence_photos ?? []);
  const unlocatedFeatures = computed(() => features.value.filter((feature) => !feature.geometry));
  const allLocatedCenter = computed(() => {
    const points = features.value
      .map((feature) => feature.geometry?.coordinates)
      .filter((coordinates) => Array.isArray(coordinates) && coordinates.length >= 2);
    if (!points.length) return [];
    return [
      points.reduce((sum, point) => sum + point[0], 0) / points.length,
      points.reduce((sum, point) => sum + point[1], 0) / points.length,
    ];
  });

  async function loadSites() {
    siteError.value = '';
    try {
      const response = await fetch(`${apiBaseUrl}/api/survey-records/sites`);
      if (!response.ok) throw new Error('踩点地点暂时无法读取。');
      sites.value = await response.json();
    } catch (error) {
      siteError.value = error instanceof Error ? error.message : '踩点地点暂时无法读取。';
    }
  }

  async function loadRecords() {
    loading.value = true;
    errorMessage.value = '';
    const query = new URLSearchParams({ coordinate_system: 'GCJ02' });
    if (selectedSiteCode.value) query.set('site_code', selectedSiteCode.value);
    try {
      const response = await fetch(`${apiBaseUrl}/api/survey-records?${query}`);
      if (!response.ok) throw new Error('踩点资料暂时无法读取，请确认后端已初始化。');
      const payload = await response.json();
      features.value = payload.features ?? [];
      if (!features.value.some((feature) => feature.properties.record_code === selectedRecordCode.value)) {
        selectedRecordCode.value = features.value[0]?.properties.record_code ?? null;
      }
      pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
    } catch (error) {
      features.value = [];
      errorMessage.value = error instanceof Error ? error.message : '踩点资料暂时无法读取。';
    } finally {
      loading.value = false;
    }
  }

  function selectRecord(recordCode) {
    selectedRecordCode.value = recordCode;
    pendingCoordinate.value = selectedFeature.value?.geometry?.coordinates ?? null;
    message.value = '';
    errorMessage.value = '';
  }

  async function saveLocation() {
    if (!selectedFeature.value || !pendingCoordinate.value || saving.value) return;
    saving.value = true;
    message.value = '';
    errorMessage.value = '';
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/survey-records/${encodeURIComponent(selectedFeature.value.properties.record_code)}/location`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${typeof accessToken === 'function' ? accessToken() : accessToken}`,
          },
          body: JSON.stringify({
            longitude: pendingCoordinate.value[0],
            latitude: pendingCoordinate.value[1],
            coordinate_system: 'GCJ02',
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.detail || '位置保存失败，请重新登录后再试。');
      message.value = '位置已保存；记录仍处于待核查状态，不会用于路线推荐。';
      await loadRecords();
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '位置保存失败。';
    } finally {
      saving.value = false;
    }
  }

  watch(selectedSiteCode, loadRecords);
  return {
    sites, features, selectedSiteCode, selectedRecordCode, pendingCoordinate,
    loading, saving, message, errorMessage, siteError,
    selectedFeature, selectedPhotos, unlocatedFeatures, allLocatedCenter,
    loadSites, loadRecords, selectRecord, saveLocation,
  };
}
