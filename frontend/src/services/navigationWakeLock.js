import { computed, ref } from 'vue';

// Only enable() requests a lock. Lifecycle changes invalidate consent, never renew it.
export function createNavigationWakeLock({ navigator = globalThis.navigator, document = globalThis.document, eligible = () => true } = {}) {
  const supported = typeof navigator?.wakeLock?.request === 'function';
  const state = ref(supported ? 'off' : 'unsupported');
  const busy = ref(false);
  let revision = 0, sentinel = null, disposed = false;
  const message = computed(() => ({
    off: '未开启，点击后才会申请。',
    pending: '正在申请屏幕常亮…',
    active: '屏幕常亮已开启。',
    releasing: '正在关闭屏幕常亮…',
    released: '屏幕常亮已释放；需要时请再次点击开启。',
    unsupported: '当前浏览器不支持屏幕常亮，请按设备原有设置使用。',
    rejected: '未能开启屏幕常亮，可能被设备或权限设置拒绝；可再次点击尝试。',
    'release-error': '关闭请求未完成，请将页面切到后台或关闭页面。',
  })[state.value]);
  const allowed = () => !disposed && eligible() && document?.visibilityState === 'visible';
  async function release(lock) {
    try { await lock.release(); return true; } catch { return false; }
  }
  function disable() {
    revision++;
    if (sentinel) {
      const lock = sentinel;
      sentinel = null;
      state.value = 'releasing'; busy.value = true;
      void release(lock).then(ok => {
        busy.value = false;
        if (!ok && !lock.released) sentinel = lock;
        state.value = ok || lock.released ? 'released' : 'release-error';
      });
    } else if (state.value === 'pending' || state.value === 'active') {
      state.value = 'released';
    }
  }
  async function enable() {
    if (!supported || !allowed() || busy.value || sentinel || state.value === 'release-error') return;
    const scope = ++revision;
    busy.value = true; state.value = 'pending';
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        if (sentinel !== lock) return;
        sentinel = null; revision++; state.value = 'released';
      }, { once: true });
      if (scope !== revision || !allowed()) {
        const ok = await release(lock);
        if (!ok && !lock.released) sentinel = lock;
        state.value = ok || lock.released ? 'released' : 'release-error';
        return;
      }
      if (lock.released) { state.value = 'released'; return; }
      sentinel = lock;
      state.value = 'active';
    } catch {
      if (scope === revision) state.value = 'rejected';
    } finally { busy.value = false; }
  }
  const visibilityChanged = () => { if (document.visibilityState !== 'visible') disable(); };
  document?.addEventListener('visibilitychange', visibilityChanged);
  function dispose() {
    disposed = true; disable();
    document?.removeEventListener('visibilitychange', visibilityChanged);
  }
  return { state, message, busy, supported, enable, disable, dispose };
}
