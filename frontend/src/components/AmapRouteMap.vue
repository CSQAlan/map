<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { registeredRoadFeatures, routePartState, segmentGeometry } from '../utils/navigationMap.js';
import { restWaypointLabel } from '../utils/navigationRestWaypoint.js';

import { loadAmap } from '../services/amapLoader';

const props = defineProps({
  area: { type: Object, required: true },
  features: { type: Array, default: () => [] },
  routeSegmentCodes: { type: Object, required: true },
  currentSegmentCode: { type: String, default: null },
  position: { type: Object, default: null },
  selectedSegmentCode: { type: String, default: null },
  activeNavigation: Boolean,
  restWaypoint: { type: Object, default: null },
  following: Boolean,
  cameraRequest: Object,
  orderedSegmentCodes: { type: Array, default: () => [] },
  manualIndex: { type: Number, default: 0 },
});

const emit = defineEmits(['select-segment', 'map-error', 'browse']);

const container = ref(null);
let disposed = false;
let hasFitted = false;
let locationMarker;
let accuracyCircle;
let AMap;
let map;
let overlays = [];
let roadOverlays = new Map();
let navigationLabels = [];
let restMarker;

onMounted(async () => {
  try {
    AMap = await loadAmap();
    if (disposed) return;
    map = new AMap.Map(container.value, {
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
    renderOverlays(); renderPosition(); renderRestWaypoint(); applyCameraRequest();
  } catch (error) {
    if (!disposed) emit('map-error', error instanceof Error ? error.message : '高德地图加载失败');
  }
});

onBeforeUnmount(() => {
  disposed = true;
  map?.destroy();
  map = null;
  AMap = null;
});

watch(
  () => [props.features],
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
      if (props.activeNavigation && !registeredRoadFeatures([feature]).length) continue;
      const road = createRoadOverlay(feature);
      overlays.push(road);
      roadOverlays.set(feature.properties.segment_code, road);
    } else if (feature.properties?.kind === 'poi') {
      overlays.push(createPoiOverlay(feature));
    }
  }
  map.add(overlays);
  updateRoadStyles();
  if (!hasFitted && roadOverlays.size) { hasFitted=true; fitCurrentRoute(); }
}

watch(() => [props.routeSegmentCodes, props.selectedSegmentCode], updateRoadStyles, { deep: true });
watch(() => [props.manualIndex, props.orderedSegmentCodes], updateRoadStyles, { deep: true });
watch(() => props.position, renderPosition, { deep: true });
watch(() => props.following, () => { if (props.activeNavigation && props.following) focusPosition(); });
watch(() => props.cameraRequest, applyCameraRequest);
watch(() => [props.restWaypoint, props.activeNavigation], renderRestWaypoint, { deep: true });
function renderRestWaypoint() {
  if (!map || !AMap) return;
  if (restMarker) map.remove(restMarker);
  restMarker = null;
  if (!props.activeNavigation || !props.restWaypoint) return;
  const label = document.createElement('span');
  label.className = 'navigation-rest-waypoint';
  label.setAttribute('role', 'img');
  label.setAttribute('aria-label', restWaypointLabel(props.restWaypoint));
  label.title = restWaypointLabel(props.restWaypoint);
  const symbol = document.createElement('span');
  symbol.textContent = '休';
  symbol.setAttribute('aria-hidden', 'true');
  label.append(symbol);
  restMarker = new AMap.Marker({ position: props.restWaypoint.point, content: label, anchor: 'center', zIndex: 120 });
  map.add(restMarker);
}
function applyCameraRequest() {
  if (!props.activeNavigation || !map) return;
  const request = props.cameraRequest;
  if (request?.kind === 'overview') fitCurrentRoute();
  else if (request?.kind === 'current') focusSelectedSegment();
  else if (request?.kind === 'follow' && props.following) focusPosition();
  else if (request?.kind === 'rest' && props.restWaypoint?.nodeCode === request.nodeCode) {
    map.setZoomAndCenter(18, props.restWaypoint.point);
  }
  else if (request?.kind === 'segment' && segmentGeometry(props.features,request.code)) {
    const overlay=roadOverlays.get(request.code);
    if (overlay) map.setFitView([overlay],false,[90,90,90,90],19);
  }
}
let pointerStart;
function pointerDown(event) { pointerStart=[event.clientX,event.clientY]; }
function pointerMove(event) { if (pointerStart && Math.hypot(event.clientX-pointerStart[0],event.clientY-pointerStart[1])>4) { userBrowse(); pointerStart=null; } }
function userBrowse() { if (props.activeNavigation) emit('browse'); }
function keyboardBrowse(event) { if (['+','-','=','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) userBrowse(); }
function updateRoadStyles() {
  for (const [code, overlay] of roadOverlays) {
    const selected=code === props.selectedSegmentCode, inRoute=props.routeSegmentCodes.has(code);
    if (props.activeNavigation) {
      const state=routePartState(code,props.orderedSegmentCodes,props.manualIndex);
      const inspected=selected && state!=='current';
      overlay.setOptions({strokeColor:inspected?'#c26413':state==='current'?'#176b57':state==='completed'?'#607d73':state==='upcoming'?'#477eab':'#71847d',
        strokeWeight:state==='current'?12:inspected?9:state==='context'?4:7,
        strokeStyle:state==='completed'||state==='upcoming'?'dashed':'solid',strokeDasharray:state==='completed'?[4,6]:[12,8],
        strokeOpacity:state==='context'?.5:1,zIndex:state==='current'?45:inspected?40:30});
      continue;
    }
    const feature=props.features.find(f => f.properties?.segment_code === code);
    const risky=feature?.properties.step_count>0 || !feature?.properties.wheelchair_accessible;
    overlay.setOptions({ strokeColor:selected?'#d9771f':inRoute?'#176b57':risky?'#c7543d':'#71847d', strokeWeight:selected?10:inRoute?8:5, strokeOpacity:(selected||inRoute) ? .96 : .68, strokeStyle:risky&&!inRoute?'dashed':'solid', zIndex:selected?40:inRoute?30:20 });
  }
  if (props.activeNavigation) renderNavigationLabels();
}
function renderNavigationLabels() {
  if (navigationLabels.length) map.remove(navigationLabels);
  navigationLabels=[];
  for (const feature of registeredRoadFeatures(props.features)) {
    const code=feature.properties.segment_code;
    const current=code===props.currentSegmentCode;
    if (!current && code!==props.selectedSegmentCode) continue;
    const label=document.createElement('span');
    label.className='navigation-road-label';
    label.textContent=current?`当前 第${props.manualIndex+1}段`:'查看（不计进度）';
    const points=feature.geometry.coordinates;
    navigationLabels.push(new AMap.Marker({position:points[Math.floor(points.length/2)],content:label,anchor:'bottom-center',zIndex:110}));
  }
  if (navigationLabels.length) map.add(navigationLabels);
}
function renderPosition() {
  if (!map || !AMap) return;
  if (!props.position?.point) { if (locationMarker) map.remove(locationMarker); if (accuracyCircle) map.remove(accuracyCircle); locationMarker=null; accuracyCircle=null; return; }
  const point=props.position.point;
  if (!locationMarker) {
    const dot=document.createElement('span'); dot.className='journey-location-dot'; dot.setAttribute('aria-label','我的位置');
    locationMarker=new AMap.Marker({ position:point,content:dot,anchor:'center',zIndex:100 });
    accuracyCircle=new AMap.Circle({ center:point,radius:props.position.accuracy,strokeColor:'#307bc2',fillColor:'#4d92d6',fillOpacity:.12,strokeOpacity:.4,zIndex:5 });
    map.add([accuracyCircle,locationMarker]);
  } else { locationMarker.setPosition(point); accuracyCircle.setCenter(point); accuracyCircle.setRadius(Math.max(0,props.position.accuracy || 0)); }
  if (props.activeNavigation && props.following) focusPosition();
}
function focusPosition() { if (map && props.position?.point) map.setZoomAndCenter(18,props.position.point); }
function focusSelectedSegment() {
  if (!map) return;
  const code = props.currentSegmentCode || props.selectedSegmentCode;
  if (props.currentSegmentCode && !props.activeNavigation) emit('select-segment', code);
  const overlay = roadOverlays.get(code);
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
    <div ref="container" class="amap-route-map" aria-label="师大苑真实地图" @pointerdown.capture="pointerDown" @pointermove.capture="pointerMove" @pointerup.capture="pointerStart=null" @pointercancel.capture="pointerStart=null" @wheel.capture.passive="userBrowse" @touchmove.capture.passive="userBrowse" @dblclick.capture="userBrowse" @click.capture="userBrowse" @keydown.capture="keyboardBrowse"></div>
    <div v-if="!activeNavigation" class="amap-map-actions"><button type="button" :disabled="!position" @click="focusPosition">我的位置</button>
      <button type="button" @click="focusSelectedSegment">查看当前路段</button>
      <button type="button" @click="fitCurrentRoute">回到完整路线</button>
    </div>
  </div>
</template>

<style>
.navigation-rest-waypoint { display:grid; place-items:center; width:36px; height:36px; border:3px solid white; border-radius:6px; background:#69418a; color:white; box-shadow:0 0 0 2px #69418a; transform:rotate(45deg); }
.navigation-rest-waypoint > span { transform:rotate(-45deg); font-size:20px; font-weight:750; line-height:1; }
</style>
