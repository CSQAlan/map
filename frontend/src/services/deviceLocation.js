import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';

const locationOptions = {
  enableHighAccuracy: true,
  timeout: 8000,
  maximumAge: 0,
};

function browserPosition() {
  if (!navigator.geolocation) {
    return Promise.reject(new Error('当前设备不支持定位'));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, locationOptions);
  });
}

export async function getCurrentCoordinates() {
  if (Capacitor.isNativePlatform()) {
    const permissions = await Geolocation.requestPermissions({ permissions: ['location'] });
    if (permissions.location !== 'granted') {
      throw new Error('定位权限未授予');
    }
  }

  const position = Capacitor.isNativePlatform()
    ? await Geolocation.getCurrentPosition(locationOptions)
    : await browserPosition();

  return {
    latitude: Number(position.coords.latitude.toFixed(6)),
    longitude: Number(position.coords.longitude.toFixed(6)),
  };
}

// Returns a cleanup function immediately, even while native permissions are pending.
export function watchCoordinates(onPosition, onError) {
  let disposed = false; let watchId = null; const native = Capacitor.isNativePlatform();
  const report = position => { if (!disposed && position) onPosition({ longitude: position.coords.longitude, latitude: position.coords.latitude, accuracy: position.coords.accuracy, timestamp: position.timestamp }); };
  const fail = error => { if (!disposed) onError(new Error(error?.code === 1 ? '定位权限未开启，请使用文字指引。' : '暂时无法定位，请到开阔处重试。')); };
  if (native) {
    (async () => { try { const permissions = await Geolocation.requestPermissions({ permissions: ['location'] }); if (disposed) return; if (permissions.location !== 'granted') { fail({ code: 1 }); return; } const id = await Geolocation.watchPosition({ ...locationOptions, minimumUpdateInterval: 3000 }, (position, error) => error ? fail(error) : report(position)); if (disposed) await Geolocation.clearWatch({ id }); else watchId = id; } catch (error) { fail(error); } })();
  } else if (navigator.geolocation) { try { watchId = navigator.geolocation.watchPosition(report, fail, locationOptions); } catch (error) { fail(error); } } else fail();
  return () => { disposed = true; if (watchId != null) { if (native) void Geolocation.clearWatch({ id: watchId }).catch(() => {}); else navigator.geolocation.clearWatch(watchId); } };
}
