const named = value => typeof value === 'string' && value.trim().length > 0;
const objectRow = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Keep the displayed registration identical to the speech service's plain text.
// Bound the name so the complete brief stays below the service's 3500-character cap.
function registeredName(value) {
  if (!named(value)) return '路段名称未记录';
  const clean = value.replace(/[*#`]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return clean ? Array.from(clean).slice(0, 160).join('') : '路段名称未记录';
}

// Only an ordered code and its unique registration prove the manually selected leg.
// Geometry, row position and preview prose cannot provide that evidence.
export function buildCurrentStepBrief(route, index) {
  const codes = route?.segment_codes, rows = route?.segments;
  if (!Array.isArray(codes) || codes.length === 0 || !Array.isArray(rows)
      || !Number.isInteger(index) || index < 0 || index >= codes.length) return '';
  const seen = new Set();
  for (let i = 0; i < codes.length; i++) {
    if (!Object.hasOwn(codes, i) || !named(codes[i]) || seen.has(codes[i])) return '';
    seen.add(codes[i]);
  }
  const matches = rows.filter(row => row?.segment_code === codes[index]);
  if (matches.length !== 1 || !objectRow(matches[0])) return '';
  const row = matches[0];
  let text = `第 ${index + 1} 段：${registeredName(row.name)}。`;
  if (typeof row.length_m === 'number' && Number.isFinite(row.length_m) && row.length_m > 0)
    text += `本段登记全长 ${row.length_m} 米。`;
  // The route DTO can default a missing step count to 0.
  text += Number.isSafeInteger(row.step_count) && row.step_count > 0
    ? `本段登记 ${row.step_count} 级台阶。` : '本段台阶数量未确认。';
  return text + '请核对现场。';
}
