import { onScopeDispose, ref, watch } from 'vue';

const emptyMonitor = () => ({ navigation: { status: 'IDLE' } });

export function useFamilyMonitor({ currentUser, activeMode, apiBaseUrl, onDenied = () => {}, sessionKey }) {
  const monitor = ref(emptyMonitor());
  const elder = ref(null);
  const unavailable = ref('');
  let deniedUserId = null;
  let timer = null;
  let monitoredUserId = null;
  let requestSequence = 0;
  let sessionGeneration = 0;

  async function refresh() {
    const user = currentUser.value;
    if (!user?.id || user.role !== 'family' || activeMode.value !== 'family' || deniedUserId === user.id) return;
    const requestedUserId = user.id;
    const requestId = ++requestSequence;
    const generation = sessionGeneration;
    const session = sessionKey?.value;
    try {
      const response = await fetch(`${apiBaseUrl}/api/auth/family/${requestedUserId}/monitor`);
      if (session !== sessionKey?.value || generation !== sessionGeneration || currentUser.value?.id !== requestedUserId || activeMode.value !== 'family') return;
      if (response.status === 403) {
        deny(requestedUserId);
        return;
      }
      if (!response.ok) return;
      const payload = await response.json();
      if (
        requestId !== requestSequence ||
        session !== sessionKey?.value ||
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

  function deny(userId = currentUser.value?.id) {
    if (!userId || currentUser.value?.role !== 'family' || currentUser.value?.id !== userId) return;
    stop();
    deniedUserId = userId;
    monitor.value = emptyMonitor();
    elder.value = null;
    unavailable.value = '家属位置共享演示未开启或访问被拒绝，无法登录、绑定或查看共享信息。手机号不是可信认证。';
    currentUser.value = { ...currentUser.value, boundElder: null, bindingStatus: null };
    try {
      const cached = JSON.parse(globalThis.localStorage?.getItem('familyMapUser') || '{}');
      const safe = { boundElder: null, bindingStatus: null };
      for (const key of ['id', 'role', 'phone', 'nickname', 'username', 'account', 'mobilityType', 'createdAt']) {
        if (Object.hasOwn(cached, key)) safe[key] = cached[key];
      }
      globalThis.localStorage?.setItem('familyMapUser', JSON.stringify(safe));
    } catch { /* Memory is already cleared. */ }
    onDenied();
  }

  function stop() {
    sessionGeneration += 1;
    requestSequence += 1;
    if (timer !== null) globalThis.window?.clearInterval(timer);
    timer = null;
  }

  function start() {
    stop();
    if (deniedUserId === currentUser.value?.id) return;
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
    if (deniedUserId !== currentUser.value?.id) {
      deniedUserId = null;
      unavailable.value = '';
    }
  }

  watch([activeMode, () => currentUser.value?.id, () => currentUser.value?.role, () => sessionKey?.value], ([mode, userId, role, session], previous) => {
    if (previous && session !== previous[3]) {
      deniedUserId = null;
      unavailable.value = '';
      reset();
    }
    if (mode === 'family' && userId && role === 'family') start();
    else reset();
  }, { immediate: true });

  onScopeDispose(stop);

  return { monitor, elder, unavailable, deny, refresh, start, stop, reset };
}
