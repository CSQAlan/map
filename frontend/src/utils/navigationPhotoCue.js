export const PHOTO_CUE_CAVEAT = '登记实景照片，仅用于认路，拍摄时间/当前位置/道路施工与通行情况未确认';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dense = (value, maximum, allowEmpty = false) => Array.isArray(value)
  && (allowEmpty || value.length > 0) && value.length <= maximum
  && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const safeText = (value, maximum) => typeof value === 'string' && value.trim() === value
  && value.length > 0 && value.length <= maximum
  && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069<>]/u.test(value);
const segmentCode = value => safeText(value, 128);
const registeredName = value => safeText(value, 80) && !/未确认|未记录|资料无效/.test(value);
const photoId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);

const ROUTE_REASON = '登记路线资料未完整核对，暂不能查看路段照片；请先核对当前路线。';
const BASE_REASON = '照片服务地址未完成核对，暂不能查看路段照片。';
const MISSING_REASON = '这一路段没有已登记的可用照片；请核对现场。';
const INVALID_REASON = '这一路段的照片资料未通过完整核对，暂不能展示；请核对现场。';
const unavailable = reason => ({ available: false, reason, steps: [] });

// This is trusted application configuration, never a URL supplied by a photo.
// Require its canonical spelling so URL parsing cannot silently repair a path,
// credential, escape or origin. A safe deployment path prefix is preserved.
function trustedBase(value) {
  if (typeof value !== 'string' || !value || /[\\\s%?#]/u.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password
        || parsed.search || parsed.hash || !/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]*$/.test(parsed.pathname)
        || parsed.pathname.split('/').some(part => part === '.' || part === '..')) return null;
    const base = `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, '')}`;
    return value === base || value === `${base}/` ? base : null;
  } catch {
    return null;
  }
}

function stepPhotos(properties, base) {
  const evidence = properties.evidence_photos;
  if (evidence == null || (Array.isArray(evidence) && evidence.length === 0))
    return { photos: [], reason: MISSING_REASON };
  if (!dense(evidence, 100)) return { photos: [], reason: INVALID_REASON };
  const seen = new Set(), photos = [];
  for (const item of evidence) {
    if (!record(item) || !photoId(item.photo_id) || seen.has(item.photo_id)
        || !safeText(item.caption, 300) || !dense(item.risk_tags, 32, true)
        || !item.risk_tags.every(tag => safeText(tag, 80))
        || item.thumbnail_url !== `/media/evidence/thumb/${item.photo_id}.webp`
        || item.display_url !== `/media/evidence/display/${item.photo_id}.webp`)
      return { photos: [], reason: INVALID_REASON };
    seen.add(item.photo_id);
    photos.push({ photoId: item.photo_id, caption: item.caption, url: `${base}${item.display_url}` });
  }
  return { photos };
}

// Manual route progress is the sole selector. Map selection, location, media
// presence and labels cannot establish ordinary-route provenance or progress.
export function buildNavigationPhotoCue(route, registeredFeatures, manualIndex,
  { verifiedOrdinary = false, apiBaseUrl = '' } = {}) {
  if (verifiedOrdinary !== true || !record(route) || route.start_context != null
      || !dense(route.segment_codes, 100) || !dense(route.segments, 100)
      || route.segment_codes.length !== route.segments.length
      || !Array.isArray(registeredFeatures) || !Number.isInteger(manualIndex)
      || manualIndex < 0 || manualIndex >= route.segment_codes.length) return unavailable(ROUTE_REASON);

  const seen = new Set(), registrations = [];
  for (const identity of route.segment_codes) {
    if (!segmentCode(identity) || seen.has(identity)) return unavailable(ROUTE_REASON);
    seen.add(identity);
    const rows = route.segments.filter(row => row?.segment_code === identity);
    const features = registeredFeatures.filter(feature => feature?.properties?.kind === 'segment'
      && feature.properties.segment_code === identity);
    if (rows.length !== 1 || !record(rows[0]) || features.length !== 1 || !record(features[0])
        || !record(features[0].properties) || !registeredName(rows[0].name)
        || rows[0].name !== features[0].properties.name) return unavailable(ROUTE_REASON);
    registrations.push(features[0].properties);
  }

  const base = trustedBase(apiBaseUrl);
  if (base === null) return unavailable(BASE_REASON);
  const steps = registrations.slice(manualIndex, manualIndex + 2).map((properties, offset) => ({
    kind: offset === 0 ? 'current' : 'next',
    index: manualIndex + offset,
    segmentCode: properties.segment_code,
    name: properties.name,
    ...stepPhotos(properties, base),
  }));
  return { available: true, reason: '', steps };
}
