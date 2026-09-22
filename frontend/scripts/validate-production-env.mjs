import { loadEnv } from 'vite';

const { VITE_API_BASE_URL: apiBaseUrl = '' } = loadEnv('production', process.cwd(), 'VITE_');

try {
  const url = new URL(apiBaseUrl.trim());
  if (url.protocol !== 'https:') throw new Error('API URL must use HTTPS');
} catch {
  console.error('Android production build requires VITE_API_BASE_URL to be an absolute HTTPS URL.');
  process.exit(1);
}
