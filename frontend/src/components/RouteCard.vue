<script setup>
defineProps({
  route: {
    type: Object,
    required: true
  },
  selected: {
    type: Boolean,
    default: false
  },
  selectedSegmentCode: {
    type: String,
    default: null
  }
});

defineEmits(['select', 'select-segment']);
</script>

<template>
  <article
    class="route-card"
    :class="{ chosen: selected }"
  >
    <div class="route-card-top">
      <div>
        <p class="rank-label">推荐路线 {{ route.rank }}</p>
        <h3>{{ route.summary || '综合适老成本较低' }}</h3>
      </div>
      <button class="route-card-select" type="button" :aria-pressed="selected" @click="$emit('select')">
        {{ selected ? '已选择' : '选择此路线' }} · {{ route.route_score }} 分
      </button>
    </div>
    <dl class="route-metrics">
      <div>
        <dt>距离</dt>
        <dd>{{ route.distance_m }} 米</dd>
      </div>
      <div>
        <dt>预计</dt>
        <dd>{{ route.estimated_minutes }} 分钟</dd>
      </div>
    </dl>
    <ol class="segment-flow">
      <li
        v-for="segment in route.segments"
        :key="segment.segment_code"
        class="segment-detail"
        :class="{ selected: selectedSegmentCode === segment.segment_code }"
        role="button"
        tabindex="0"
        @click.stop="$emit('select-segment', segment.segment_code)"
        @keydown.enter.stop.prevent="$emit('select-segment', segment.segment_code)"
      >
        <div class="segment-title">
          <strong>{{ segment.name }}</strong>
          <span>{{ segment.length_m }} 米</span>
        </div>
        <p>{{ segment.explanation }}</p>
        <div class="tag-row">
          <span
            v-for="tag in segment.benefit_tags"
            :key="`${segment.segment_code}-good-${tag}`"
            class="route-tag benefit"
          >
            {{ tag }}
          </span>
          <span
            v-for="tag in segment.risk_tags"
            :key="`${segment.segment_code}-risk-${tag}`"
            class="route-tag risk"
          >
            {{ tag }}
          </span>
        </div>
      </li>
    </ol>
  </article>
</template>

<style scoped>
.route-card-select {
  min-height: 44px;
  border: 1px solid var(--leaf-dark, #286887);
  border-radius: 12px;
  padding: 0 12px;
  color: var(--leaf-dark, #286887);
  background: #fff;
  font-weight: 800;
}

.route-card.chosen .route-card-select {
  color: #fff;
  background: var(--leaf-dark, #286887);
}
</style>
