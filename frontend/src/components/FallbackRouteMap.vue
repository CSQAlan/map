<script setup>
import { computed } from 'vue';

const props = defineProps({
  features: { type: Array, default: () => [] },
  routeSegmentCodes: { type: Object, required: true },
  position: { type: Object, default: null },
  selectedSegmentCode: { type: String, default: null },
});

const emit = defineEmits(['select-segment']);

const roadFeatures = computed(() =>
  props.features.filter((feature) => feature.properties?.kind === 'segment')
);
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
  <div><p class="fallback-map-note" role="status">{{ roadFeatures.length ? '简化路网示意，非完整离线底图；蓝点为定位估计。' : '暂无路网图形，请使用上方文字指引。' }}</p><p v-if="positionOutside" class="fallback-map-note" role="status">您的位置在此示意图范围外，请核对当前地点。</p><svg class="campus-map" viewBox="0 0 760 360" role="img" aria-label="师大苑简化路网示意">
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
          active: routeSegmentCodes.has(feature.properties.segment_code),
          selected: selectedSegmentCode === feature.properties.segment_code,
          stair: feature.properties.step_count > 0,
        },
      ]"
      role="button"
      tabindex="0"
      @click="emit('select-segment', feature.properties.segment_code)"
      @keydown.enter="emit('select-segment', feature.properties.segment_code)"
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
  </svg></div>
</template>

<style scoped>.fallback-map-note { padding:10px 16px; margin:0; color:#5d7164; font-size:14px; line-height:1.6; }</style>
