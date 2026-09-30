import { onScopeDispose, ref, watch } from 'vue';

const emptyMonitor = () => ({ navigation: { status: 'IDLE' } });

export function useFamilyMonitor({ currentUser, activeMode, apiBaseUrl }) {
  const monitor = ref(emptyMonitor());
  const elder = ref(null);
  let timer = null;
  let monitoredUserId = null;
  let requestSequence = 0;

  async function refresh() {
    const user = currentUser.value;
    if (!user?.id || user.role !== 'family') return;
    const requestedUserId = user.id;
    const requestId = ++requestSequence;
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/family/${requestedUserId}/monitor`);
      if (!response.ok) return;
      const payload = await response.json();
      if (
        requestId !== requestSequence ||
        activeMode.value !== 'family' ||
        currentUser.value?.role !== 'family' ||
        currentUser.value?.id !== requestedUserId
      ) return;
      monitor.value = payload;
      elder.value = payload.elder;
    } catch {
      // Keep the last permitted snapshot when the network is temporarily unavailable.
    }
  }

  function stop() {
    requestSequence += 1;
    if (timer !== null) globalThis.window?.clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    if (activeMode.value !== 'family') return;
    if (monitoredUserId !== currentUser.value?.id) reset();
    monitoredUserId = currentUser.value?.id ?? null;
    void refresh();
    timer = globalThis.window?.setInterval(() => void refresh(), 5000) ?? null;
  }

  function reset() {
    stop();
    monitoredUserId = null;
    monitor.value = emptyMonitor();
    elder.value = null;
  }

  watch([activeMode, () => currentUser.value?.id, () => currentUser.value?.role], ([mode, userId, role]) => {
    if (mode === 'family' && userId && role === 'family') start();
    else reset();
  }, { immediate: true });

  onScopeDispose(stop);

  return { monitor, elder, refresh, start, stop, reset };
}
