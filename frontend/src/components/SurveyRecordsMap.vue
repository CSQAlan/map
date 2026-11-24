<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { loadAmap } from '../services/amapLoader';
import '../styles/survey-browser.css';

const props = defineProps({
  features: { type: Array, default: () => [] },
  center: { type: Array, default: () => [] },
  selectedRecordCode: { type: String, default: null },
  placementMode: { type: Boolean, default: false },
  pendingCoordinate: { type: Array, default: null },
});
const emit = defineEmits(['select-record', 'map-error', 'map-click', 'search-result']);
const container = ref(null);
const status = ref('loading');
const failure = ref('');
const requiresReload = ref(false);
const keyword = ref('');
const searchMessage = ref('');
const searching = ref(false);
let AMap;
let map;
let markers = [];
let placementMarker;
let timer;
let generation = 0;
let searchGeneration = 0;
let disposed = false;

function cleanup() {
  clearTimeout(timer);
  searchGeneration++;
  searching.value = false;
  if (map) map.destroy();
  map = null;
  markers = [];
  placementMarker = null;
}

function fail(attempt, message, reloadRequired = false) {
  if (disposed || attempt !== generation) return;
  generation++;
  cleanup();
  status.value = 'error';
  failure.value = message;
  requiresReload.value = reloadRequired;
  emit('map-error', message);
}

async function initialize() {
  if (disposed) return;
  const attempt = ++generation;
  cleanup();
  status.value = 'loading';
  failure.value = '';
  requiresReload.value = false;
  searchMessage.value = '';
  emit('map-error', '');
  timer = setTimeout(() => fail(attempt, '地图加载超时，可刷新页面重试，或继续从列表查看照片。', true), 12000);
  try {
    const sdk = await loadAmap();
    if (disposed || attempt !== generation) return;
    AMap = sdk;
    map = new AMap.Map(container.value, {
      center: props.center.length === 2 ? props.center : [106.31, 29.60],
      zoom: 16, zooms: [12, 20], viewMode: '2D',
      mapStyle: 'amap://styles/whitesmoke', showIndoorMap: false, resizeEnable: true,
    });
    map.on('complete', () => {
      if (disposed || attempt !== generation) return;
      clearTimeout(timer);
      status.value = 'ready';
    });
    map.on('error', () => fail(attempt, '地图暂时无法显示，请检查网络后重试。'));
    map.addControl(new AMap.Scale({ position: 'LB' }));
    map.addControl(new AMap.ToolBar({ position: 'RT', liteStyle: true }));
    map.on('click', event => {
      if (props.placementMode && status.value === 'ready') {
        emit('map-click', [event.lnglat.getLng(), event.lnglat.getLat()]);
      }
    });
    renderMarkers();
    showPlacement();
  } catch (error) {
    fail(attempt, error?.name === 'TimeoutError'
      ? '地图加载超时，可刷新页面重试，或继续从列表查看照片。'
      : '地图暂时无法显示，您可以重试，或继续从列表查看照片。', Boolean(error?.requiresPageReload));
  }
}

function recover() {
  if (requiresReload.value) window.location.reload();
  else initialize();
}

onMounted(initialize);
onBeforeUnmount(() => { disposed = true; generation++; cleanup(); AMap = null; });
watch(() => [props.features, props.selectedRecordCode], renderMarkers, { deep: true });
watch(() => props.pendingCoordinate, showPlacement, { deep: true });
watch(() => props.center, center => {
  if (map && center.length === 2 && !props.selectedRecordCode) map.setCenter(center);
}, { deep: true });

function renderMarkers() {
  if (!map || !AMap) return;
  if (markers.length) map.remove(markers);
  markers = [];
  const located = props.features.filter(feature => feature.geometry?.type === 'Point');
  for (const feature of located) {
    const code = feature.properties.record_code;
    const selected = code === props.selectedRecordCode;
    const marker = new AMap.Marker({
      position: feature.geometry.coordinates, anchor: 'bottom-center',
      zIndex: selected ? 120 : 80,
      content: markerButton(feature.properties.title, selected),
    });
    marker.on('click', () => emit('select-record', code));
    markers.push(marker);
  }
  if (markers.length) map.add(markers);
  const selected = located.find(feature => feature.properties.record_code === props.selectedRecordCode);
  if (selected && !props.placementMode) map.panTo(selected.geometry.coordinates);
  else if (markers.length) map.setFitView(markers, false, [58, 40, 90, 40], 16);
}

function markerButton(title, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `survey-map-pin${selected ? ' selected' : ''}`;
  button.setAttribute('aria-label', `待核查记录：${title}`);
  button.textContent = '!';
  return button;
}

function showPlacement() {
  if (!map || !AMap) return;
  if (placementMarker) map.remove(placementMarker);
  placementMarker = null;
  if (!props.placementMode || !props.pendingCoordinate) return;
  const pin = document.createElement('div');
  pin.className = 'survey-placement-pin';
  pin.setAttribute('aria-label', '待保存位置');
  pin.textContent = '＋';
  placementMarker = new AMap.Marker({
    position: props.pendingCoordinate, anchor: 'center', zIndex: 200, content: pin,
  });
  map.add(placementMarker);
  map.panTo(props.pendingCoordinate);
}

function searchPlace() {
  const query = keyword.value.trim();
  if (!query || !AMap || !map || status.value !== 'ready') return;
  const instance = map;
  const attempt = generation;
  const search = ++searchGeneration;
  searching.value = true;
  searchMessage.value = '正在查找地点…';
  const placeSearch = new AMap.PlaceSearch({ city: '重庆', pageSize: 1 });
  placeSearch.search(query, (resultStatus, result) => {
    if (disposed || attempt !== generation || search !== searchGeneration || instance !== map) return;
    searching.value = false;
    const location = result?.poiList?.pois?.[0]?.location;
    if (resultStatus !== 'complete' || !location) {
      searchMessage.value = '没有找到该地点，可直接拖动地图定位。';
      emit('search-result', null);
      return;
    }
    const position = [location.lng, location.lat];
    map.setZoomAndCenter(17, position);
    searchMessage.value = `地图已移动到“${result.poiList.pois[0].name}”，请再点选准确位置。`;
    emit('search-result', position);
  });
}
defineExpose({ searchPlace });
</script>

<template>
  <div class="survey-map-shell">
    <form v-if="placementMode" class="survey-map-search" @submit.prevent="searchPlace">
      <input v-model="keyword" aria-label="搜索地图地点" placeholder="搜索街道、校区或地点" :disabled="status !== 'ready'" />
      <button type="submit" :disabled="status !== 'ready' || !keyword.trim() || searching">{{ searching ? '查找中…' : '搜索' }}</button>
      <span v-if="searchMessage" role="status">{{ searchMessage }}</span>
    </form>
    <div v-show="status !== 'error'" ref="container" class="survey-records-map" :aria-busy="status === 'loading'" :aria-label="placementMode ? '选择踩点记录位置的地图' : '待核查踩点记录地图'"></div>
    <div v-if="status === 'loading'" class="survey-map-loading" role="status">正在加载地图，照片资料可以先查看…</div>
    <div v-if="status === 'error'" class="survey-map-recovery" role="status">
      <strong>地图暂不可用</strong>
      <p>{{ failure }}</p>
      <button type="button" class="secondary-action" @click="recover">{{ requiresReload ? '刷新页面重试地图' : '重新加载地图' }}</button>
    </div>
    <div v-if="status === 'ready'" class="survey-map-legend"><span class="survey-legend-dot">!</span> 待核查记录 <span>{{ placementMode ? '点击地图选择新位置' : '也可从记录列表查看照片' }}</span></div>
  </div>
</template>
