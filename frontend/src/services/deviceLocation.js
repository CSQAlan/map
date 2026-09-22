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
