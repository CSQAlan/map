<script setup>
import { computed } from 'vue';
const props = defineProps({ route: { type: Object, required: true } });
const segments = computed(() => props.route.segments ?? []);
const facts = computed(() => {
  const rows = segments.value;
  if (!rows.length) return [];
  const result = [];
  if (rows.every(row => Number.isFinite(row.step_count))) {
    const steps = rows.reduce((sum, row) => sum + row.step_count, 0);
    result.push(steps ? `登记台阶共 ${steps} 级` : '登记无台阶');
  }
  if (rows.every(row => Number.isFinite(row.slope_percent))) result.push(`路段登记最大坡度 ${Math.max(...rows.map(row => row.slope_percent))}%`);
  if (rows.every(row => Number.isFinite(row.width_m) && row.width_m > 0)) result.push(`登记最窄路宽 ${Math.min(...rows.map(row => row.width_m))} 米`);
  return result;
});
const preference = computed(() => ({
  WHEELCHAIR: '按轮椅通行条件筛选，重点考虑台阶、坡度和路宽。',
  CANE: '按拄杖出行条件筛选，重点考虑台阶、坡度和扶手。',
  SLOW_WALKER: '按慢行条件筛选，兼顾平缓程度和休息设施资料。',
  FAMILY_ASSISTED: '按家属陪同行走条件筛选，兼顾路线稳定性和通行条件。',
  INDEPENDENT: '按独立步行条件筛选，兼顾路程和道路通行资料。',
})[props.route.mobility_type] ?? '推荐依据为路段登记资料，请结合现场情况选择。');
</script>

<template>
  <section v-if="facts.length" class="route-accessibility-facts" aria-label="适老推荐依据">
    <h4>这条路线考虑了什么</h4><p>{{ preference }}</p>
    <ul><li v-for="fact in facts" :key="fact">{{ fact }}</li></ul>
    <p v-if="route.start_context" class="route-origin-notice">{{ route.start_context.notice }}</p>
    <small>登记指标用于辅助选择，不能保证当前现场通行条件。</small>
  </section>
</template>

<style scoped>
.route-accessibility-facts { padding: 15px; margin-block: 16px; background: #edf5ef; border-radius: 12px; line-height: 1.8; }
.route-accessibility-facts h4 { margin: 0; font-size: 17px; }
.route-accessibility-facts p { margin: 6px 0; color: #4c6757; font-size: 15px; }
.route-accessibility-facts ul { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 12px 0; }
.route-accessibility-facts li { padding: 5px 9px; background: white; border: 1px solid #d2e2d7; border-radius: 8px; font-size: 15px; }
.route-accessibility-facts small { display: block; font-size: 14px; color: #617768; }
.route-accessibility-facts .route-origin-notice { padding-top: 10px; border-top: 1px solid #cdded2; color: #765522; }
</style>
