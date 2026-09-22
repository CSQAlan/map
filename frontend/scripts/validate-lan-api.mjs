import { loadEnv } from 'vite';

const env = loadEnv('development', process.cwd(), 'VITE_');
const apiBaseUrl = (process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL ?? '').trim();

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

try {
  const url = new URL(apiBaseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Unsupported protocol');
  if (!isPrivateIpv4(url.hostname)) throw new Error('Expected a private IPv4 address');
} catch {
  console.error(
    'Hotspot APK build requires VITE_API_BASE_URL such as http://192.168.137.1:8000. Do not use localhost.'
  );
  process.exit(1);
}
