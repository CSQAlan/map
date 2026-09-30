<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { loadAmap } from '../services/amapLoader';

const props = defineProps({
  features: { type: Array, default: () => [] },
  center: { type: Array, default: () => [] },
  selectedRecordCode: { type: String, default: null },
  placementMode: { type: Boolean, default: false },
  pendingCoordinate: { type: Array, default: null },
});

const emit = defineEmits(['select-record', 'map-error', 'map-click', 'search-result']);
const keyword = ref('');
const searchMessage = ref('');
let AMap;
let map;
let markers = [];
let placementMarker;

onMounted(async () => {
  try {
    AMap = await loadAmap();
    map = new AMap.Map('survey-records-map', {
      center: props.center.length === 2 ? props.center : [106.31, 29.60],
      zoom: 16,
      zooms: [12, 20],
      viewMode: '2D',
      mapStyle: 'amap://styles/whitesmoke',
      showIndoorMap: false,
      resizeEnable: true,
    });
    map.addControl(new AMap.Scale({ position: 'LB' }));
    map.addControl(new AMap.ToolBar({ position: 'RT', liteStyle: true }));
    map.on('click', (event) => {
      if (props.placementMode) emit('map-click', [event.lnglat.getLng(), event.lnglat.getLat()]);
    });
    renderMarkers();
    if (props.placementMode && props.pendingCoordinate) showPlacement(props.pendingCoordinate);
  } catch (error) {
    emit('map-error', error instanceof Error ? error.message : '地图加载失败');
  }
});

onBeforeUnmount(() => {
  map?.destroy();
  map = null;
  AMap = null;
});

watch(
  () => [props.features, props.selectedRecordCode, props.pendingCoordinate],
  () => {
    renderMarkers();
    if (props.placementMode && props.pendingCoordinate) showPlacement(props.pendingCoordinate);
  },
  { deep: true }
);

watch(
  () => props.center,
  (center) => {
    if (map && Array.isArray(center) && center.length === 2) map.setCenter(center);
  },
  { deep: true }
);

function renderMarkers() {
  if (!map || !AMap) return;
  if (markers.length) map.remove(markers);
  markers = [];
  const located = props.features.filter((feature) => feature.geometry?.type === 'Point');
  for (const feature of located) {
    const code = feature.properties.record_code;
    const selected = code === props.selectedRecordCode;
    const marker = new AMap.Marker({
      position: feature.geometry.coordinates,
      anchor: 'bottom-center',
      zIndex: selected ? 120 : 80,
      content: markerButton(feature.properties.title, selected),
    });
    marker.on('click', () => emit('select-record', code));
    markers.push(marker);
  }
  if (markers.length) map.add(markers);
  const selectedFeature = located.find(
    (feature) => feature.properties.record_code === props.selectedRecordCode
  );
  if (selectedFeature?.geometry && !props.placementMode) {
    map.panTo(selectedFeature.geometry.coordinates);
  } else if (markers.length > 1) {
    map.setFitView(markers, false, [58, 40, 110, 40], 16);
  }
}

function markerButton(title, selected) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `survey-map-pin${selected ? ' selected' : ''}`;
  button.setAttribute('aria-label', `待核查记录：${title}`);
  button.textContent = '!';
  return button;
}

function showPlacement(position) {
  if (!map || !AMap || !Array.isArray(position)) return;
  if (placementMarker) map.remove(placementMarker);
  placementMarker = new AMap.Marker({
    position,
    anchor: 'center',
    zIndex: 200,
    content: '<div class="survey-placement-pin" aria-label="待保存位置">＋</div>',
  });
  map.add(placementMarker);
  map.panTo(position);
}

function searchPlace() {
  const query = keyword.value.trim();
  if (!query || !AMap || !map) return;
  searchMessage.value = '正在查找地点…';
  const search = new AMap.PlaceSearch({ city: '重庆', pageSize: 1 });
  search.search(query, (status, result) => {
    const location = result?.poiList?.pois?.[0]?.location;
    if (status !== 'complete' || !location) {
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
    <div v-if="placementMode" class="survey-map-search">
      <input v-model="keyword" aria-label="搜索地图地点" placeholder="搜索街道、校区或地点" @keyup.enter="searchPlace" />
      <button type="button" @click="searchPlace">搜索</button>
      <span v-if="searchMessage" role="status">{{ searchMessage }}</span>
    </div>
    <div id="survey-records-map" class="survey-records-map" :aria-label="placementMode ? '选择踩点记录位置的地图' : '大学城待核查踩点记录地图'"></div>
    <div class="survey-map-legend"><span class="survey-legend-dot">!</span> 待核查记录　<span v-if="placementMode">点击地图选择新位置</span><span v-else>点击标记查看照片</span></div>
  </div>
</template>
