import { ref } from 'vue';

export function createCurrentOrigin({ capture, lookup, getMobility, onConfirm }) {
  const state = ref('idle');
  const error = ref('');
  const sample = ref(null);
  const candidates = ref([]);
  const selectedCode = ref('');
  let generation = 0;
  let controller;

  function cancel() {
    generation++;
    controller?.abort();
    state.value = 'idle'; candidates.value = []; selectedCode.value = ''; sample.value = null; error.value = '';
  }
  async function start() {
    cancel();
    const attempt = generation;
    const mobility = getMobility();
    state.value = 'locating';
    try {
      const fix = await capture();
      if (attempt !== generation) return;
      if (![fix.longitude, fix.latitude, fix.accuracy, fix.timestamp].every(Number.isFinite) || fix.accuracy < 0 || fix.accuracy > 30) {
        throw new Error('定位精度不足，请到开阔处重试，或手动选择起点。');
      }
      controller = new AbortController();
      state.value = 'matching';
      const payload = await lookup(fix, mobility, controller.signal);
      if (attempt !== generation || getMobility() !== mobility) return;
      candidates.value = payload.candidates ?? [];
      sample.value = fix;
      selectedCode.value = '';
      state.value = candidates.value.length ? 'ready' : 'uncovered';
      if (!candidates.value.length) error.value = payload.message || '当前位置附近没有已收录道路，请手动选择起点。';
    } catch (failure) {
      if (attempt !== generation) return;
      state.value = 'error';
      error.value = failure?.code === 1 ? '未获得定位权限，请在设备设置中允许定位，或手动选择起点。'
        : failure?.code === 3 ? '定位超时，请到开阔处重试，或手动选择起点。'
          : failure?.code === 2 ? '暂时无法定位，请检查设备位置服务，或到开阔处重试。'
          : failure instanceof TypeError ? '暂时连接不到路线服务，请检查网络后重试。'
            : failure?.message || '暂时无法获取位置，请重试或手动选择起点。';
    }
  }
  function confirm() {
    const selected = candidates.value.find(candidate => candidate.segment_code === selectedCode.value && candidate.allowed);
    if (state.value !== 'ready' || !selected || !sample.value) return;
    if (Date.now() - sample.value.timestamp > 60000 || sample.value.timestamp > Date.now() + 5000) {
      state.value = 'error'; error.value = '当前位置已过期，请重新定位。'; return;
    }
    state.value = 'confirmed';
    onConfirm(sample.value, selected);
  }
  return { state, error, candidates, sample, selectedCode, start, cancel, confirm };
}
