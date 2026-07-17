<script setup>
import { computed } from 'vue';
import LocationInput from '../components/LocationInput.vue';
import AmapRouteMap from '../components/AmapRouteMap.vue';
import FallbackRouteMap from '../components/FallbackRouteMap.vue';

const props = defineProps({
  startName: String,
  endName: String,
  startOptions: Array,
  endOptions: Array,
  selectedRoute: Object,
  routes: { type: Array, default: () => [] },
  selectedRouteIndex: { type: Number, default: 0 },
  selectedProfile: Object,
  actionStatus: String,
  sosSubmitting: Boolean,
  loading: Boolean,
  mapFeatures: Array,
  pilotArea: Object,
  mapFailure: String,
  mapRetrying: Boolean,
  selectedSegmentCode: String,
  isGuest: Boolean,
});

const emit = defineEmits([
  'update:startName', 'update:endName', 'plan-route', 'start-navigation', 'reroute', 'send-sos',
  'retry-map', 'select-segment', 'map-error', 'open-profile', 'select-route',
]);

const routeSegmentCodes = computed(() => new Set(props.selectedRoute?.segment_codes ?? []));
const nextStepText = computed(() => {
  const first = props.selectedRoute?.segments?.[0]?.name ?? props.selectedRoute?.segment_names?.[0];
  return first ? `请沿“${first}”方向慢慢前进` : '输入起点和目的地，系统会为您安排路线';
});

function submitPlan() {
  if (!props.startName?.trim() || !props.endName?.trim()) return;
  emit('plan-route');
}
</script>

<template>
  <section class="elder-home" aria-live="polite">
    <header class="elder-home-header">
      <div>
        <p class="section-kicker">助老出行</p>
        <h1>您好，准备去哪里？</h1>
      </div>
      <button v-if="!isGuest" class="profile-shortcut" type="button" aria-label="打开个人中心" @click="$emit('open-profile')">我的</button>
    </header>

    <form class="elder-trip-form" @submit.prevent="submitPlan">
      <LocationInput
        :model-value="startName"
        :options="startOptions"
        label="起点"
        icon="起"
        @update:model-value="$emit('update:startName', $event)"
      />
      <div class="trip-divider" aria-hidden="true"></div>
      <LocationInput
        :model-value="endName"
        :options="endOptions"
        label="目的地"
        icon="终"
        @update:model-value="$emit('update:endName', $event)"
      />
      <button class="elder-start-button" type="submit" :disabled="loading">
        {{ loading ? '正在为您规划…' : '开始导航' }}
      </button>
    </form>

    <section class="elder-map-section" aria-label="当前路线地图">
      <div class="elder-map-heading">
        <strong>{{ selectedRoute ? '为您推荐的最佳路线' : '校园路线地图' }}</strong>
        <button type="button" @click="$emit('reroute')">查看路线</button>
      </div>
      <AmapRouteMap
        v-if="pilotArea && !mapFailure"
        :area="pilotArea"
        :features="mapFeatures"
        :route-segment-codes="routeSegmentCodes"
        :selected-segment-code="selectedSegmentCode"
        @select-segment="$emit('select-segment', $event)"
        @map-error="$emit('map-error', $event)"
      />
      <div v-else>
        <p class="map-fallback-notice">
          <span>{{ mapFailure || '正在准备地图数据…' }}</span>
          <button type="button" :disabled="mapRetrying" @click="$emit('retry-map')">重试</button>
        </p>
        <FallbackRouteMap
          :features="mapFeatures"
          :route-segment-codes="routeSegmentCodes"
          :selected-segment-code="selectedSegmentCode"
          @select-segment="$emit('select-segment', $event)"
        />
      </div>
    </section>

    <section v-if="selectedRoute" class="elder-route-summary">
      <p>系统已按{{ selectedProfile?.label || '您的出行需要' }}优先推荐</p>
      <h2>{{ selectedRoute.distance_m }} 米 · 约 {{ selectedRoute.estimated_minutes }} 分钟</h2>
      <strong>{{ nextStepText }}</strong>
      <button class="elder-outline-button" type="button" @click="$emit('reroute')">修改地点或查看其他路线</button>
    </section>

    <section v-if="routes.length > 1" class="elder-route-choice">
      <strong>请选择更适合您的路线</strong>
      <button
        v-for="(route, index) in routes"
        :key="`${route.rank}-${route.route_score}`"
        type="button"
        :class="{ selected: selectedRouteIndex === index }"
        @click="$emit('select-route', index)"
      >
        <span>方案 {{ index + 1 }}</span>
        <strong>{{ route.distance_m }} 米 · {{ route.estimated_minutes }} 分钟</strong>
        <small>{{ route.summary }}</small>
      </button>
    </section>

    <div class="elder-quick-actions">
      <button type="button" @click="$emit('reroute')"><i>⌁</i>路线详情</button>
      <button v-if="!isGuest" type="button" @click="$emit('open-profile')"><i>⚙</i>出行设置</button>
      <button v-else type="button" @click="$emit('reroute')"><i>⌁</i>重新规划</button>
      <button class="emergency-action" type="button" :disabled="sosSubmitting" @click="$emit('send-sos')">
        <i>!</i>{{ sosSubmitting ? '发送中' : '紧急求助' }}
      </button>
    </div>
    <p class="elder-status">{{ actionStatus }}</p>
  </section>
</template>
