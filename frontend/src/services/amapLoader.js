import AMapLoader from '@amap/amap-jsapi-loader';
import { createAmapSession } from './amapSession.js';

let session;

export function loadAmap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  // 同时兼容高德控制台常见命名，避免部署环境变量名不一致导致地图静默回退。
  const securityJsCode =
    import.meta.env.VITE_AMAP_SECURITY_JS_CODE ?? import.meta.env.VITE_AMAP_SECURITY_CODE;
  if (!key) {
    return Promise.reject(new Error('未配置 VITE_AMAP_KEY'));
  }

  if (securityJsCode) window._AMapSecurityConfig = { securityJsCode };
  session ??= createAmapSession(AMapLoader, {
    key,
    version: '2.0',
    plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.PlaceSearch'],
  }, {
    cleanup() {
      for (const script of document.querySelectorAll('script[src]')) {
        const url = new URL(script.src, window.location.href);
        if (url.hostname === 'webapi.amap.com' && url.pathname === '/maps' && url.searchParams.get('callback') === '___onAPILoaded') {
          script.onerror = null;
          script.remove();
        }
      }
    },
  });
  return session.load();
}
