export const ROUTE_MEMO_CAVEAT = '离线文字备忘，不是实时导航/定位/到达证明；请核对现场。';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const dense = value => Array.isArray(value) && value.length > 0 && value.length <= 100
  && Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean);
const code = value => typeof value === 'string' && value.trim() === value && value.length > 0;
// Labels are used verbatim only after matching the independent registered-road
// list. Do not clean arbitrary prose into something that looks like a road name.
const roadName = value => typeof value === 'string' && value.length <= 80
  && /^[\p{Script=Han}A-Za-z]+(?:[ ·（()）\-][\p{Script=Han}A-Za-z]+)*$/u.test(value)
  && !/未确认|未记录|资料无效/.test(value);
const metres = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000
  && Math.round(value * 100) > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
const unavailable = () => ({ available: false, reason: '登记路线资料未完整核对，暂不能保存文字路线；请先核对当前路线。' });

// The caller must supply live planner provenance, never infer it from DTO labels.
// No geometry, position, origin, freeform prose, progress or session is serialized.
export function buildRouteMemo(route, registeredFeatures, { verifiedOrdinary = false } = {}) {
  if (verifiedOrdinary !== true || !record(route) || route.start_context != null
      || !dense(route.segment_codes) || !dense(route.segments)
      || route.segments.length !== route.segment_codes.length || !metres(route.distance_m)
      || !Array.isArray(registeredFeatures)) return unavailable();
  const seen = new Set(), lines = [];
  let total = 0;
  for (const identity of route.segment_codes) {
    if (!code(identity) || seen.has(identity)) return unavailable();
    seen.add(identity);
    const rows = route.segments.filter(row => row?.segment_code === identity);
    const registered = registeredFeatures.filter(feature => feature?.properties?.kind === 'segment'
      && feature.properties.segment_code === identity);
    if (rows.length !== 1 || !record(rows[0]) || registered.length !== 1
        || !record(registered[0]) || !record(registered[0].properties)) return unavailable();
    const row = rows[0], official = registered[0].properties;
    if (!roadName(row.name) || row.name !== official.name || !metres(row.length_m)) return unavailable();
    // Some map registrations omit lengths; the proven named-route DTO still
    // supplies whole-leg registration. If a registry length exists, it must agree.
    if (Object.hasOwn(official, 'length_m') && (!metres(official.length_m)
        || Math.round(official.length_m * 100) !== Math.round(row.length_m * 100))) return unavailable();
    total += Math.round(row.length_m * 100);
    lines.push(`${lines.length + 1}. ${official.name} — 登记全长 ${row.length_m} 米`);
  }
  if (total !== Math.round(route.distance_m * 100)) return unavailable();
  return { available: true, text: ['路线备忘', ROUTE_MEMO_CAVEAT,
    '当前所选路线的完整登记顺序；长度为各段登记全长，包含已手动确认的路段，不是当前位置的剩余距离。',
    ...lines, '不提供转弯、入口或现场通行保证；终点登记不等于已到目的地。'].join('\n') };
}
