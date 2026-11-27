<script setup>
import { computed } from 'vue';
import { registeredRoadFeatures, routePartState, routePartLabel } from '../utils/navigationMap.js';
import { restWaypointLabel } from '../utils/navigationRestWaypoint.js';

const props = defineProps({
  features: { type: Array, default: () => [] },
  routeSegmentCodes: { type: Object, required: true },
  position: { type: Object, default: null },
  selectedSegmentCode: { type: String, default: null },
  activeNavigation: Boolean,
  restWaypoint: { type: Object, default: null },
  orderedSegmentCodes: { type: Array, default: () => [] },
  manualIndex: { type: Number, default: 0 },
});

const emit = defineEmits(['select-segment']);
const partState = code => routePartState(code,props.orderedSegmentCodes,props.manualIndex);
const inspection = code => code===props.selectedSegmentCode && partState(code)!=='current';

const roadFeatures = computed(() =>
  props.activeNavigation ? registeredRoadFeatures(props.features) : props.features.filter(feature => feature.properties?.kind === 'segment')
);
const labeledRoads = computed(() => roadFeatures.value.filter(feature => partState(feature.properties.segment_code)==='current' || inspection(feature.properties.segment_code)));
const poiFeatures = computed(() =>
  props.features.filter((feature) => feature.properties?.kind === 'poi')
);
const mapBounds = computed(() => {
  const points = [];
  for (const feature of props.features) collectCoordinates(feature.geometry?.coordinates, points);
  if (!points.length) {
    return { minLon: 106.307, maxLon: 106.31, minLat: 29.6036, maxLat: 29.6051 };
  }
  const lons = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const minLon=Math.min(...lons), maxLon=Math.max(...lons), minLat=Math.min(...lats), maxLat=Math.max(...lats);
  const lonPadding=Math.max((maxLon-minLon)*.08,.0001), latPadding=Math.max((maxLat-minLat)*.08,.0001);
  return { minLon:minLon-lonPadding,maxLon:maxLon+lonPadding,minLat:minLat-latPadding,maxLat:maxLat+latPadding };
});

const positionOutside = computed(() => { const point=props.position?.point; const b=mapBounds.value; return Boolean(point && (point[0]<b.minLon || point[0]>b.maxLon || point[1]<b.minLat || point[1]>b.maxLat)); });

function collectCoordinates(coordinates, points) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    points.push(coordinates);
    return;
  }
  for (const item of coordinates) collectCoordinates(item, points);
}

function projectPoint(point) {
  const width = 760;
  const height = 360;
  const padding = 42;
  const bounds = mapBounds.value;
  const lonRange = bounds.maxLon - bounds.minLon || 0.001;
  const latRange = bounds.maxLat - bounds.minLat || 0.001;
  return [
    padding + ((point[0] - bounds.minLon) / lonRange) * (width - padding * 2),
    height - padding - ((point[1] - bounds.minLat) / latRange) * (height - padding * 2),
  ];
}

function pathForCoordinates(coordinates) {
  return coordinates
    .map((point, index) => {
      const [x, y] = projectPoint(point);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}
</script>

<template>
  <div :class="{'navigation-schematic':activeNavigation}"><p class="fallback-map-note" role="status">{{ roadFeatures.length ? '简化路网示意，非完整离线底图；蓝点为定位估计。' : '暂无路网图形，请使用上方文字指引。' }}<template v-if="activeNavigation">固定示意图，不平移或缩放；可用位置仅更新蓝点，路段可高亮查看。</template></p><p v-if="positionOutside" class="fallback-map-note" role="status">您的位置在此示意图范围外，请核对当前地点。</p>
  <div v-if="activeNavigation" class="navigation-schematic-labels" aria-label="示意图路段标记"><p v-for="feature in labeledRoads" :key="feature.properties.segment_code">{{ partState(feature.properties.segment_code)==='current' ? `当前 第${manualIndex+1}段（粗实线）` : '临时查看（橙色，不计进度）' }}：{{ feature.properties.name || feature.properties.segment_code }}</p></div>
  <svg class="campus-map" viewBox="0 0 760 360" :role="activeNavigation ? 'group' : 'img'" aria-label="师大苑简化路网示意">
    <defs>
      <linearGradient id="fallbackRouteGlow" x1="0" x2="1">
        <stop offset="0%" stop-color="#2f6f5e" />
        <stop offset="100%" stop-color="#e6a93c" />
      </linearGradient>
    </defs>
    <path
      v-for="feature in roadFeatures"
      :key="feature.properties.segment_code"
      :d="pathForCoordinates(feature.geometry.coordinates)"
      :class="[
        'map-road',
        {
          [`nav-${partState(feature.properties.segment_code)}`]: activeNavigation,
          'nav-inspection': activeNavigation && inspection(feature.properties.segment_code),
          active: routeSegmentCodes.has(feature.properties.segment_code),
          selected: selectedSegmentCode === feature.properties.segment_code,
          stair: feature.properties.step_count > 0,
        },
      ]"
      role="button"
      :aria-label="activeNavigation ? `${feature.properties.name || feature.properties.segment_code}：${routePartLabel(partState(feature.properties.segment_code))}${inspection(feature.properties.segment_code) ? '，临时查看，不计进度' : ''}` : undefined"
      :data-route-state="activeNavigation ? partState(feature.properties.segment_code) : undefined"
      :aria-current="activeNavigation && partState(feature.properties.segment_code)==='current' ? 'step' : undefined"
      tabindex="0"
      @click="emit('select-segment', feature.properties.segment_code)"
      @keydown.enter="emit('select-segment', feature.properties.segment_code)"
      @keydown.space.prevent="emit('select-segment', feature.properties.segment_code)"
    />
    <g
      v-for="feature in poiFeatures"
      :key="feature.properties.id"
      class="map-poi"
      :transform="`translate(${projectPoint(feature.geometry.coordinates)[0]}, ${projectPoint(feature.geometry.coordinates)[1]})`"
    >
      <circle r="10" />
      <text x="14" y="5">{{ feature.properties.name }}</text>
    </g>
    <g v-if="position?.point && !positionOutside" :transform="`translate(${projectPoint(position.point)[0]}, ${projectPoint(position.point)[1]})`"><circle r="15" fill="#4288cb" opacity=".2" /><circle r="7" fill="#287ac2" stroke="white" stroke-width="3" /><title>我的位置估计，精度约{{ Math.round(position.accuracy) }}米</title></g>
    <g v-if="activeNavigation && restWaypoint" class="navigation-rest-waypoint-svg" role="img" :aria-label="restWaypointLabel(restWaypoint)" :transform="`translate(${projectPoint(restWaypoint.point)[0]}, ${projectPoint(restWaypoint.point)[1]})`">
      <title>{{ restWaypointLabel(restWaypoint) }}</title>
      <path d="M 0 -27 L 27 0 L 0 27 L -27 0 Z" fill="#69418a" stroke="white" stroke-width="3" />
      <text x="0" y="7" text-anchor="middle" fill="white" font-size="22" font-weight="750" aria-hidden="true">休</text>
    </g>
  </svg></div>
</template>

<style scoped>
.fallback-map-note { padding:10px 16px; margin:0; color:#5d7164; font-size:14px; line-height:1.6; }
.navigation-schematic .map-road { filter:none; }
.navigation-schematic .nav-completed { stroke:#607d73; stroke-width:7; stroke-dasharray:4 6; }
.navigation-schematic .nav-current { stroke:#176b57; stroke-width:12; stroke-dasharray:none; }
.navigation-schematic .nav-upcoming { stroke:#477eab; stroke-width:7; stroke-dasharray:12 8; }
.navigation-schematic .nav-context { stroke:#71847d; stroke-width:4; }
.navigation-schematic .nav-inspection { stroke:#c26413; stroke-width:9; }
.navigation-schematic .map-road:focus-visible { outline:3px solid #c26413; }
.navigation-schematic-labels { padding:0 12px; color:#173d2c; font-size:1.125rem; font-weight:700; overflow-wrap:anywhere; }
.navigation-schematic-labels p { margin:8px 0; }
</style>
