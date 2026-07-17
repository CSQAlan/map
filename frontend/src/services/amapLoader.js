import AMapLoader from '@amap/amap-jsapi-loader';

let amapPromise;

export function loadAmap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  // 同时兼容高德控制台常见命名，避免部署环境变量名不一致导致地图静默回退。
  const securityJsCode =
    import.meta.env.VITE_AMAP_SECURITY_JS_CODE ?? import.meta.env.VITE_AMAP_SECURITY_CODE;
  if (!key) {
    return Promise.reject(new Error('未配置 VITE_AMAP_KEY'));
  }

  if (securityJsCode) window._AMapSecurityConfig = { securityJsCode };
  amapPromise ??= AMapLoader.load({
    key,
    version: '2.0',
    plugins: ['AMap.Scale', 'AMap.ToolBar'],
  }).catch((error) => {
    amapPromise = null;
    throw error;
  });
  return amapPromise;
}
