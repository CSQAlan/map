import { ref } from 'vue';

const BUILT_IN_POIS = [
  '师大苑大学城西路入口',
  '师大苑荷塘水景休息区',
  '师大苑楼栋组团A',
  '师大苑楼栋组团B',
  '师大苑林下休闲步道',
  '师大苑外部商业街人行道',
];

const toOptions = (names) => names.map((name) => ({ label: name, value: name }));

export function createMapData({ fetcher = (...args) => fetch(...args), apiBaseUrl = '' } = {}) {
  let currentApiBaseUrl = apiBaseUrl;
  const startOptions = ref(toOptions(BUILT_IN_POIS));
  const endOptions = ref(toOptions(BUILT_IN_POIS));
  const mapFeatures = ref([]);
  const pilotArea = ref(null);
  const mapFailure = ref('');
  const mapLoading = ref(false);
  const mapRetrying = ref(false);
  const diagnosticSuggestions = ref([]);
  const diagnosticsLoading = ref(false);

  async function loadPoiOptions() {
    try {
      const response = await fetcher(`${currentApiBaseUrl}/api/map-data/pois?area_code=SHIDAYUAN`);
      if (!response.ok) throw new Error('地点列表接口不可用');
      const pois = await response.json();
      const options = pois
        .filter((poi) => poi?.name)
        .map((poi) => ({ label: poi.name, value: poi.name }));
      if (!options.length) throw new Error('地点列表为空');
      startOptions.value = options.map((option) => ({ ...option }));
      endOptions.value = options.map((option) => ({ ...option }));
    } catch (error) {
      console.warn('使用内置地点列表：', error);
    }
  }

  async function loadPilotArea() {
    try {
      const response = await fetcher(
        `${currentApiBaseUrl}/api/pilot-areas/SHIDAYUAN?coordinate_system=GCJ02`
      );
      if (!response.ok) throw new Error('无法读取师大苑试点边界');
      pilotArea.value = await response.json();
    } catch (error) {
      mapFailure.value = `试点边界加载失败：${error instanceof Error ? error.message : '未知错误'}`;
    }
  }

  async function loadMapData() {
    mapLoading.value = true;
    try {
      const response = await fetcher(
        `${currentApiBaseUrl}/api/map-data/geojson?area_code=SHIDAYUAN&coordinate_system=GCJ02`
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

  async function loadDiagnostics() {
    diagnosticsLoading.value = true;
    try {
      const response = await fetcher(`${currentApiBaseUrl}/api/diagnostics/segments?limit=5`);
      const payload = await response.json().catch(() => ({}));
      diagnosticSuggestions.value = response.ok ? payload.suggestions ?? [] : [];
    } catch {
      diagnosticSuggestions.value = [];
    } finally {
      diagnosticsLoading.value = false;
    }
  }

  async function retryMapData() {
    mapRetrying.value = true;
    mapFailure.value = '';
    pilotArea.value = null;
    try {
      await Promise.all([loadPilotArea(), loadMapData()]);
    } finally {
      mapRetrying.value = false;
    }
  }

  return {
    startOptions, endOptions, mapFeatures, pilotArea, mapFailure, mapLoading,
    mapRetrying, diagnosticSuggestions, diagnosticsLoading,
    loadPoiOptions, loadPilotArea, loadMapData, loadDiagnostics, retryMapData,
    configure(options = {}) {
      if (options.apiBaseUrl !== undefined) currentApiBaseUrl = options.apiBaseUrl;
    },
  };
}

const mapData = createMapData();

export function useMapData(options = {}) {
  mapData.configure(options);
  return mapData;
}
