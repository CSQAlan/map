import { Capacitor } from '@capacitor/core';

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

export const isNativeApp = Capacitor.isNativePlatform();
export const API_BASE_URL =
  configuredApiBaseUrl ||
  (isNativeApp ? '' : `${window.location.protocol}//${window.location.hostname}:8000`);

export const apiConfigurationError =
  isNativeApp && !configuredApiBaseUrl
    ? '当前 App 未配置服务地址，请使用包含 VITE_API_BASE_URL 的生产环境配置重新打包。'
    : '';
