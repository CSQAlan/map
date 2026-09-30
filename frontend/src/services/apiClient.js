import { API_BASE_URL } from '../config/api.js';

const DEFAULT_ERROR_MESSAGE = '请求失败，请稍后重试。';

export async function apiRequest(path, { token, body, headers = {}, errorMessage, ...options } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (token) requestHeaders.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload?.detail;
    const message = typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item?.msg ?? JSON.stringify(item)).join('；')
        : errorMessage || DEFAULT_ERROR_MESSAGE;
    throw new Error(message || errorMessage || DEFAULT_ERROR_MESSAGE);
  }

  return payload;
}
