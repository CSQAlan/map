<script setup>
import { computed, nextTick, onMounted, ref, watch, onBeforeUnmount } from 'vue';
import { arrivalBoundaryText } from '../utils/arrivalBoundary.js';
const props = defineProps({ session: Object, phase: String, message: String, candidates: Array, pending: Object, canStart: Boolean, profileLabel: String, strategyLabel: String });
const emit = defineEmits(['replan', 'confirm-start', 'confirm-route', 'start', 'cancel', 'end', 'pause']);
const selected = ref('');
const replanButton = ref(null);
const nextInstruction = computed(() => {
  if (['paused', 'ready'].includes(props.phase)) return '下一步：点“从当前位置重新规划绕行”，获取当前位置。';
  if (props.phase === 'confirm-start') return '下一步：对照周围道路，选择实际所在路段，再点“确认此路段并查询绕行”。';
  if (props.phase === 'confirm-route' && props.pending) return '下一步：核对下方新路线，确认后点“使用这条绕行路线”。';
  return '';
});
onMounted(async () => {
  if (props.session?.source === 'navigation-obstruction') {
    await nextTick(); replanButton.value?.focus();
  }
});
watch(() => props.candidates, () => { selected.value = ''; }, { flush: 'sync' });
onBeforeUnmount(() => emit('pause'));
</script>
<template>
  <section class="detour-panel" aria-label="本次绕行行程" aria-live="polite">
    <h2>本次绕开：{{ session.name }}</h2>
    <p>目的地：{{ session.endName }}<template v-if="profileLabel">；出行选择：{{ profileLabel }}</template><template v-if="strategyLabel">；路线偏好：“{{ strategyLabel }}”</template>。</p>
    <p role="status">{{ message }}{{ phase !== 'active' ? ' 旧路线、语音和地图引导已暂停，请停在安全处。' : '' }}</p>
    <p>仅在这次行程中绕开所选路段，不代表公共封路；刷新页面后不会恢复导航。</p>
    <p v-if="nextInstruction" class="detour-next-step">{{ nextInstruction }}</p>
    <button ref="replanButton" type="button" @click="emit('replan')">{{ ['locating', 'matching', 'planning'].includes(phase) ? '重新尝试获取当前位置' : '从当前位置重新规划绕行' }}</button>
    <div v-if="phase === 'confirm-start'">
      <label>确认您实际所在的替代路段
        <select v-model="selected"><option value="">请选择并核对道路</option><option v-for="row in candidates" :key="row.segment_code" :value="row.segment_code">{{ row.name }}（约距 {{ row.distance_m }} 米）</option></select>
      </label>
      <button type="button" :disabled="!selected" @click="emit('confirm-start', selected)">确认此路段并查询绕行</button>
    </div>
    <div v-if="phase === 'confirm-route' && pending">
      <p>最新候选登记全程 {{ pending.distance_m }} 米，仍绕开 {{ session.name }}，前往 {{ session.endName }}。</p>
      <p v-if="arrivalBoundaryText(pending)">{{ arrivalBoundaryText(pending) }}</p>
      <ol><li v-for="row in pending.segments" :key="row.segment_code">{{ row.name }}</li></ol>
      <button type="button" @click="emit('confirm-route')">使用这条绕行路线</button>
    </div>
    <button v-if="canStart && phase === 'active'" type="button" @click="emit('start')">开始绕行导航</button>
    <button type="button" @click="emit('cancel')">取消本次绕行</button>
    <button type="button" @click="emit('end', $event)">结束本次行程</button>
  </section>
</template>
<style scoped>
.detour-panel { margin: 12px 0; padding: 18px; border: 2px solid #8a6225; border-radius: 12px; background: #fff8e9; color: #46391f; line-height: 1.7; }
.detour-panel h2 { margin: 0; font-size: 1.2rem; }
.detour-panel button, .detour-panel select { box-sizing:border-box; min-width:0; min-height: 48px; margin: 6px; padding: 8px 12px; font: inherit; max-width: calc(100% - 12px); white-space:normal; overflow-wrap:anywhere; }
.detour-panel button:focus-visible, .detour-panel select:focus-visible { outline:3px solid currentColor; outline-offset:3px; }
.detour-panel label { display: grid; }
</style>
