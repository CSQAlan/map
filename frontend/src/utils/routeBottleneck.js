import { wgs84ToGcj02 } from '../services/navigationJourney.js';

const validCode = value => typeof value === 'string' && value.trim().length > 0;
const positiveWidth = value => typeof value === 'number' && Number.isFinite(value) && value > 0;

function routeLine(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2 || !geometry.every(point =>
    Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90)) return null;
  if (!geometry.some(point => point[0] !== geometry[0][0] || point[1] !== geometry[0][1])) return null;
  return geometry.map(([lon, lat]) => wgs84ToGcj02(lon, lat));
}

// Width is an available route registration, not evidence of a present-day field measurement.
// The declared route codes are authoritative; a missing detail row counts as unknown.
function registeredRows(route) {
  const details = Array.isArray(route?.segments) ? route.segments : [];
  const codes = Array.isArray(route?.segment_codes) ? route.segment_codes : [];
  const counts = new Map();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  const byCode = new Map();
  for (const row of details) {
    const code = row?.segment_code;
    if (!validCode(code)) continue;
    byCode.set(code, byCode.has(code) ? null : row);
  }
  return { total: codes.length, rows: codes.map(code =>
    validCode(code) && counts.get(code) === 1 ? byCode.get(code) ?? null : null) };
}

export function routeBottleneck(route) {
  const { total, rows } = registeredRows(route);
  let known = 0;
  let narrowest = null;
  for (const row of rows) {
    if (!positiveWidth(row?.width_m)) continue;
    known += 1;
    if (!narrowest || row.width_m < narrowest.width_m) narrowest = row;
  }
  return {
    known, total,
    segment: narrowest && {
      code: narrowest.segment_code,
      name: validCode(narrowest.name) ? narrowest.name.trim() : `路段名称未记录（${narrowest.segment_code}）`,
      width: narrowest.width_m,
      // Missing geometry does not change which segment wins on width.
      coordinates: routeLine(narrowest.geometry_coordinates),
    },
  };
}

// Do not expose a partial subtotal as the whole journey's stair count.
export function registeredRoadConditions(route) {
  const { total, rows } = registeredRows(route);
  const knownRows = rows.filter(row => Number.isSafeInteger(row?.step_count) && row.step_count >= 0);
  const sum = knownRows.reduce((value, row) => value + row.step_count, 0);
  return {
    width: routeBottleneck(route),
    steps: {
      known: knownRows.length, total,
      count: total > 0 && knownRows.length === total && Number.isSafeInteger(sum) ? sum : null,
      segments: knownRows.filter(row => row.step_count > 0).map(row => ({
        code: row.segment_code, name: validCode(row.name) ? row.name.trim() : null, count: row.step_count,
      })),
    },
  };
}

// Replace only the highlighted segment's display geometry with its route-specific
// shape (which can be clipped at a confirmed current origin). Do not mutate the
// loaded map or the route used by navigation.
export function mapFeaturesForBottleneck(features, segment) {
  if (!segment?.coordinates) return features;
  const index = features.findIndex(feature => feature.properties?.kind === 'segment'
    && feature.properties.segment_code === segment.code);
  const base = features[index];
  const feature = {
    ...base,
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: segment.coordinates },
    properties: { ...base?.properties, kind: 'segment', segment_code: segment.code, name: segment.name },
  };
  return index < 0 ? [...features, feature] : features.map((row, i) => i === index ? feature : row);
}
