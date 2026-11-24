<script setup>
import { computed, onBeforeUnmount, watch } from 'vue';
import { API_BASE_URL } from '../../config/api.js';
import { getCurrentCoordinates } from '../../services/deviceLocation.js';
import { createCurrentOrigin } from '../../composables/useCurrentOrigin.js';
import { useRoutePlanner } from '../../composables/useRoutePlanner.js';
import AppIcon from '../ui/AppIcon.vue';

const planner = useRoutePlanner();
const { currentOrigin, mobilityType, startName } = planner;
const workflow = createCurrentOrigin({
  capture: getCurrentCoordinates,
  getMobility: () => mobilityType.value,
  onConfirm: planner.setCurrentOrigin,
  async lookup(fix, mobility, signal) {
    const params = new URLSearchParams({ longitude: fix.longitude, latitude: fix.latitude, accuracy: fix.accuracy, timestamp_ms: fix.timestamp, mobility_type: mobility });
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; request.abort(); }, 12000);
    try {
      const response = await fetch(`${API_BASE_URL}/api/routes/start-options?${params}`, { signal: request.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof payload.detail === 'string' ? payload.detail : '附近道路暂时无法读取，请重试。');
      return payload;
    } catch (failure) {
      if (timedOut) throw new Error('附近道路读取超时，请稍后重试或手动选择起点。');
      throw failure;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  },
});
const { state, error, candidates, selectedCode, sample, confirm, cancel } = workflow;
const busy = computed(() => ['locating', 'matching'].includes(state.value));
function locate() { planner.beginCurrentOrigin(); workflow.start(); }
watch(mobilityType, cancel, { flush: 'sync' });
watch(startName, () => { if (['locating', 'matching', 'ready'].includes(state.value)) cancel(); }, { flush: 'sync' });
watch(currentOrigin, value => { if (!value && state.value === 'confirmed') cancel(); });
onBeforeUnmount(cancel);
</script>

<template>
  <section class="current-origin-picker" aria-label="当前位置作为起点">
    <div class="current-origin-actions"><button type="button" class="current-origin-locate" :disabled="busy" @click="locate"><AppIcon name="pin" :size="19" />{{ busy ? (state === 'locating' ? '正在定位…' : '查找附近道路…') : (currentOrigin ? '重新获取位置' : '使用当前位置') }}</button><button v-if="busy" type="button" @click="cancel">取消定位</button></div>
    <p v-if="error" role="status">{{ error }}</p>
    <div v-if="state === 'ready'" class="current-origin-confirmation">
      <label>请核对您所在的道路<select v-model="selectedCode" aria-label="附近已收录道路"><option value="" disabled>请选择您实际所在的道路</option><option v-for="candidate in candidates" :key="candidate.segment_code" :value="candidate.segment_code" :disabled="!candidate.allowed">{{ candidate.name }}（约距 {{ candidate.distance_m }} 米{{ candidate.allowed ? '' : '，不符合出行条件' }}）</option></select></label>
      <p>定位精度约 {{ Math.round(sample.accuracy) }} 米。请确认就在该道路上；系统无法判断围墙、楼层或路口另一侧。</p>
      <ul v-if="candidates.some(item => !item.allowed)"><li v-for="candidate in candidates.filter(item => !item.allowed)" :key="candidate.segment_code">{{ candidate.name }}：{{ candidate.reasons.join('、') }}</li></ul>
      <button type="button" :disabled="!selectedCode" @click="confirm">确认我在这条道路上</button>
    </div>
    <p v-if="currentOrigin" class="current-origin-chosen" role="status">已确认：{{ currentOrigin.label }}。路线从已收录道路接入点开始。</p>
    <p v-else-if="state === 'idle'" class="current-origin-help">也可定位到已收录道路的中途，不必先选一个地名。</p>
  </section>
</template>

<style scoped>
.current-origin-picker { margin: 0; padding: 12px 0; font-size: 15px; line-height: 1.8; }
.current-origin-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.current-origin-picker button { min-height: 48px; padding: 9px 13px; border: 1px solid #a7bfb1; border-radius: 11px; color: #245c4c; background: #f2f8f4; font-size: 16px; }
.current-origin-picker button:disabled { opacity: .55; }
.current-origin-locate { display: inline-flex; gap: 7px; align-items: center; }
.current-origin-picker p { margin: 9px 0 0; color: #526a5d; overflow-wrap: anywhere; }
.current-origin-confirmation { margin-top: 12px; padding: 14px; border: 1px solid #c9dbcf; border-radius: 12px; background: #f4f8f5; }
.current-origin-confirmation label { display: grid; gap: 8px; }
.current-origin-confirmation select { min-width: 0; width: 100%; padding: 8px; border: 1px solid #b3cabb; border-radius: 8px; background: white; font-size: 16px; }
.current-origin-confirmation > button { margin-top: 12px; background: #24685b; color: white; }
.current-origin-confirmation ul { padding-left: 22px; color: #84521f; }
.current-origin-help { font-size: 14px; }
</style>
