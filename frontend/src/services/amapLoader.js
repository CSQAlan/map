import AMapLoader from '@amap/amap-jsapi-loader';

let amapPromise;

export function loadAmap() {
  const key = import.meta.env.VITE_AMAP_KEY;
  const securityJsCode = import.meta.env.VITE_AMAP_SECURITY_CODE;
  if (!key || !securityJsCode) {
    return Promise.reject(new Error('高德地图密钥未配置'));
  }

  window._AMapSecurityConfig = { securityJsCode };
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
