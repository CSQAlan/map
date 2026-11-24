// Registered segment data only: a missing value is never interpreted as zero.
export const knownDistance = route => Number.isFinite(route?.distance_m) && route.distance_m >= 0;
export const formatMetric = value => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);

export function shortestReturnedCandidate(routes) {
  return (Array.isArray(routes) ? routes : []).filter(knownDistance)
    .reduce((best, route) => !best || route.distance_m < best.distance_m ? route : best, null);
}

export function registeredRouteFacts(route) {
  const rows = Array.isArray(route?.segments) ? route.segments : [];
  const declared = route?.segment_codes;
  const recordedCodes = new Set(rows.map(row => row?.segment_code));
  const covered = !Array.isArray(declared) || (declared.length === rows.length
    && recordedCodes.size === rows.length && new Set(declared).size === declared.length
    && declared.every(code => typeof code === 'string' && code.length > 0 && recordedCodes.has(code)));
  const complete = (field, valid) => covered && rows.length > 0 && rows.every(row => valid(row?.[field]));
  const nonnegative = value => Number.isFinite(value) && value >= 0;
  return {
    distance: knownDistance(route) ? `${formatMetric(route.distance_m)} 米` : '未记录',
    width: complete('width_m', value => nonnegative(value) && value > 0)
      ? `${formatMetric(Math.min(...rows.map(row => row.width_m)))} 米` : '未记录',
    slope: complete('slope_percent', nonnegative)
      ? `${formatMetric(Math.max(...rows.map(row => row.slope_percent)))}%` : '未记录',
    steps: complete('step_count', value => Number.isInteger(value) && value >= 0)
      ? rows.some(row => row.step_count > 0) ? `${rows.reduce((sum, row) => sum + row.step_count, 0)} 级` : '登记无台阶' : '未记录',
  };
}

export function referenceBlockedSegments(avoidedSegments, reference) {
  const codes = new Set([
    ...(Array.isArray(reference?.segment_codes) ? reference.segment_codes : []),
    ...(Array.isArray(reference?.segments) ? reference.segments.map(row => row?.segment_code) : []),
  ].filter(code => typeof code === 'string' && code.length > 0));
  return (Array.isArray(avoidedSegments) ? avoidedSegments : [])
    .filter(row => row?.avoidance_level === 'BLOCKED' && codes.has(row.segment_code))
    .slice(0, 8);
}

export function comparisonSummary(current, reference) {
  if (!reference) return '本次没有返回距离登记完整的普通步行候选，无法比较多走距离。';
  if (!knownDistance(current)) return '当前路线距离未记录，无法比较多走距离。';
  const difference = current.distance_m - reference.distance_m;
  if (difference > 0) {
    const distance = difference < 0.01 ? '不足 0.01' : `约 ${formatMetric(difference)}`;
    return `当前路线比本次普通步行参考多走${distance}米。`;
  }
  return '本次普通步行参考并不比当前路线更短，没有可展示的多走距离。';
}
