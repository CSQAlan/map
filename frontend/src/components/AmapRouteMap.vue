<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue';

import { loadAmap } from '../services/amapLoader';

const props = defineProps({
  area: { type: Object, required: true },
  features: { type: Array, default: () => [] },
  routeSegmentCodes: { type: Object, required: true },
  selectedSegmentCode: { type: String, default: null },
});

const emit = defineEmits(['select-segment', 'map-error']);

let AMap;
let map;
let overlays = [];
let roadOverlays = new Map();

onMounted(async () => {
  try {
    AMap = await loadAmap();
    map = new AMap.Map('shidayuan-amap', {
      center: props.area.center,
      zoom: Math.max(props.area.min_zoom, 17),
      zooms: [props.area.min_zoom, props.area.max_zoom],
      viewMode: '2D',
      mapStyle: 'amap://styles/whitesmoke',
      showIndoorMap: false,
      resizeEnable: true,
    });
    const bounds = new AMap.Bounds(
      props.area.limit_bounds.south_west,
      props.area.limit_bounds.north_east
    );
    map.setLimitBounds(bounds);
    map.addControl(new AMap.Scale({ position: 'LB' }));
    map.addControl(new AMap.ToolBar({ position: 'RT', liteStyle: true }));
    renderOverlays();
  } catch (error) {
    emit('map-error', error instanceof Error ? error.message : '高德地图加载失败');
  }
});

onBeforeUnmount(() => {
  map?.destroy();
  map = null;
  AMap = null;
});

watch(
  () => [props.features, props.routeSegmentCodes, props.selectedSegmentCode],
  () => renderOverlays(),
  { deep: true }
);

function renderOverlays() {
  if (!map || !AMap) return;
  if (overlays.length) map.remove(overlays);
  overlays = [];
  roadOverlays = new Map();

  const boundary = new AMap.Polygon({
    path: props.area.boundary.coordinates[0],
    strokeColor: '#215f50',
    strokeWeight: 3,
    strokeOpacity: 0.9,
    fillColor: '#dce9df',
    fillOpacity: 0.12,
    zIndex: 10,
  });
  overlays.push(boundary);

  for (const feature of props.features) {
    if (feature.properties?.kind === 'segment') {
      const road = createRoadOverlay(feature);
      overlays.push(road);
      roadOverlays.set(feature.properties.segment_code, road);
    } else if (feature.properties?.kind === 'poi') {
      overlays.push(createPoiOverlay(feature));
    }
  }
  map.add(overlays);
  if (props.selectedSegmentCode) focusSelectedSegment();
}

function focusSelectedSegment() {
  if (!map) return;
  const overlay = roadOverlays.get(props.selectedSegmentCode);
  if (overlay) map.setFitView([overlay], false, [90, 90, 90, 90], 19);
}

function fitCurrentRoute() {
  if (!map) return;
  const routeOverlays = [...props.routeSegmentCodes]
    .map((code) => roadOverlays.get(code))
    .filter(Boolean);
  map.setFitView(routeOverlays.length ? routeOverlays : overlays, false, [70, 70, 70, 70], 18);
}

function createRoadOverlay(feature) {
  const code = feature.properties.segment_code;
  const selected = code === props.selectedSegmentCode;
  const inRoute = props.routeSegmentCodes.has(code);
  const risky = feature.properties.step_count > 0 || !feature.properties.wheelchair_accessible;
  const polyline = new AMap.Polyline({
    path: feature.geometry.coordinates,
    strokeColor: selected ? '#d9771f' : inRoute ? '#176b57' : risky ? '#c7543d' : '#71847d',
    strokeWeight: selected ? 10 : inRoute ? 8 : 5,
    strokeOpacity: selected || inRoute ? 0.96 : 0.68,
    strokeStyle: risky && !inRoute ? 'dashed' : 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: selected ? 40 : inRoute ? 30 : 20,
    cursor: 'pointer',
    extData: { segmentCode: code },
  });
  polyline.on('click', () => emit('select-segment', code));
  return polyline;
}

function createPoiOverlay(feature) {
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'amap-poi-label';
  label.textContent = feature.properties.name;
  return new AMap.Marker({
    position: feature.geometry.coordinates,
    content: label,
    anchor: 'bottom-center',
    zIndex: 50,
  });
}
</script>

<template>
  <div class="amap-map-shell">
    <div id="shidayuan-amap" class="amap-route-map" aria-label="师大苑真实地图"></div>
    <div class="amap-map-actions">
      <button type="button" @click="focusSelectedSegment">查看当前路段</button>
      <button type="button" @click="fitCurrentRoute">回到完整路线</button>
    </div>
  </div>
</template>
