import { Capacitor } from '@capacitor/core';

export const ROUTE_MEMO_FILENAME = 'route-memo.txt';

// API presence cannot promise OS file handling. Known native/embedded WebViews
// get selectable text only, including Capacitor's native shell.
export function routeMemoDownloadSupported(env = globalThis) {
  try {
    const ua = env.navigator?.userAgent || '';
    if (Capacitor.isNativePlatform() || env.Capacitor?.isNativePlatform?.()
        || /\bwv\b|WebView|MicroMessenger|FBAN|FBAV|Instagram|;\s*Version\/4\.0/i.test(ua)
        || /iPhone|iPad|iPod/i.test(ua) && !/Safari\//i.test(ua)) return false;
    return Boolean(env.document?.body && typeof env.Blob === 'function'
      && typeof env.URL?.createObjectURL === 'function' && typeof env.URL?.revokeObjectURL === 'function'
      && typeof env.setTimeout === 'function' && typeof env.clearTimeout === 'function'
      && 'download' in env.document.createElement('a'));
  } catch { return false; }
}

// The URL exists only after a trusted click. Keep it briefly for the browser to
// consume, then revoke; explicit lifecycle disposal also revokes immediately.
export function createRouteMemoDownload(env = globalThis) {
  let pending = null;
  function dispose() {
    if (!pending) return;
    const item = pending; pending = null;
    try { env.clearTimeout(item.timer); } catch { /* still revoke below */ }
    try { item.anchor.remove(); } catch { /* still revoke below */ }
    try { env.URL.revokeObjectURL(item.url); } catch { /* no stale reference retained */ }
  }
  function download(text, event) {
    if (event?.isTrusted !== true || !text || typeof text !== 'string'
        || !routeMemoDownloadSupported(env) || env.navigator?.userActivation?.isActive === false) return 'unsupported';
    dispose();
    let anchor;
    try {
      const blob = new env.Blob([text], { type: 'text/plain;charset=utf-8' });
      anchor = env.document.createElement('a');
      pending = { anchor, url: env.URL.createObjectURL(blob), timer: null };
      anchor.href = pending.url; anchor.download = ROUTE_MEMO_FILENAME;
      anchor.hidden = true; env.document.body.appendChild(anchor);
      // No await or queued click: preserve the direct user activation.
      anchor.click(); anchor.remove();
      pending.timer = env.setTimeout(dispose, 1000);
      return 'requested';
    } catch {
      try { anchor?.remove(); } catch { /* dispose still runs */ }
      dispose(); return 'error';
    }
  }
  return { download, dispose };
}
