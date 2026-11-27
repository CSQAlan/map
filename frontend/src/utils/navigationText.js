const named = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => Number.isFinite(value) && value > 0;

// Route codes, not a map feature or another candidate, determine the visible order.
export function navigationRows(route) {
  const codes = Array.isArray(route?.segment_codes) ? route.segment_codes : [];
  const details = Array.isArray(route?.segments) ? route.segments : [];
  return codes.map(code => {
    const matches = details.filter(row => row?.segment_code === code);
    return named(code) && codes.filter(value => value === code).length === 1 && matches.length === 1
      ? { ...matches[0], name: named(matches[0].name) ? matches[0].name : '路段名称未记录' }
      : { segment_code: code, name: '路段资料未确认' };
  });
}

export function registeredSegmentText(segment) {
  return {
    steps: Number.isSafeInteger(segment?.step_count) && segment.step_count >= 0
      ? segment.step_count === 0 ? '本段台阶数量未确认（登记为 0，可能为默认值），不能确认无台阶，请核对现场。'
        : `登记台阶：${segment.step_count} 级；不能据此确认可通行，请核对现场。`
      : '台阶数量未记录或资料无效，不能当作 0 级。',
    width: positive(segment?.width_m) ? `登记路宽：${segment.width_m} 米${segment.width_m === 1.5 ? '（可能为默认值）' : ''}；现场可用宽度未确认，请核对现场。`
      : '有效正路宽未记录，不能据此判断是否宽敞或可通行。',
  };
}

// Display-only: leave the existing publisher's fields and legacy calculation alone.
export function manualRemainingDistance(route, index) {
  const rows = navigationRows(route);
  if (!rows.length || !Number.isInteger(index) || index < 0 || index >= rows.length
      || !positive(route?.distance_m) || !Array.isArray(route.segments) || route.segments.length !== rows.length
      || !rows.every(row => positive(row.length_m))) return null;
  const total = rows.reduce((sum,row) => sum + row.length_m,0);
  // The route DTO reports registered distances to hundredths of a metre.
  if (!Number.isFinite(total) || Math.round(total * 100) !== Math.round(route.distance_m * 100)) return null;
  return Math.round(rows.slice(index).reduce((sum,row) => sum + row.length_m,0) * 100) / 100;
}
