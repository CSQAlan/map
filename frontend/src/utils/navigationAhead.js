// Registration evidence only: manual progress never locates the actual stairs.
const named = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const countKnown = value => Number.isSafeInteger(value) && value >= 0;
const cents = value => Math.round(value * 100);
const empty = (state, text) => ({ state, code: null, name: null, count: null, index: null,
  text, distance: null, qualified: false });
const unmarkedText = '前方未标注台阶，不能确认无台阶，请核对现场。';
const unknownText = `台阶资料缺失或无效。${unmarkedText}`;
const unknown = () => empty('unknown', unknownText);

// Format validated fields for both screen and one-shot speech; never trust DTO prose.
function formatStairText({ state, name, count, index, distance, qualified }) {
  if (state === 'current') return `${name}：本段登记 ${count} 级台阶。`;
  const prefix = qualified ? '前方已登记最先有台阶的是' : '前方';
  const distanceText = distance === null ? '进入该路段前登记路程暂未确认。'
    : `按手动确认进度估算，进入该路段前登记路程约 ${distance} 米，包含尚未确认走完的当前整段；这不是距实际台阶位置的距离。`;
  return `${prefix}第 ${index + 1} 段（${name}）登记 ${count} 级台阶。${qualified ? '前面路段台阶资料未确认，不能确认无台阶。' : ''}${distanceText}`;
}

// Full route lengths must support the published total before estimating any part.
// Row order is immaterial; every ordered route code needs one unique registration.
function entryDistance(route, codes, rows, index, target) {
  if (!positive(route.distance_m) || rows.length !== codes.length) return null;
  const lengths = [];
  for (const code of codes) {
    const matches = rows.filter(row => row?.segment_code === code);
    if (matches.length !== 1 || !positive(matches[0].length_m)) return null;
    lengths.push(matches[0].length_m);
  }
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!Number.isSafeInteger(cents(total)) || !Number.isSafeInteger(cents(route.distance_m))
      || cents(total) !== cents(route.distance_m)) return null;
  const beforeEntry = lengths.slice(index, target).reduce((sum, length) => sum + length, 0);
  return Number.isSafeInteger(cents(beforeEntry)) ? cents(beforeEntry) / 100 : null;
}

export function navigationStairs(route, index, { paused = false, active = true } = {}) {
  if (!active || paused || !route) return { state: 'hidden' };
  const codes = route.segment_codes, rows = route.segments;
  if (!Array.isArray(codes) || !codes.length || codes.filter(named).length !== codes.length
      || new Set(codes).size !== codes.length || !Number.isSafeInteger(index)
      || index < 0 || index >= codes.length || !Array.isArray(rows)) return unknown();
  let qualified = false, missing = false;
  for (let i = index; i < codes.length; i++) {
    const matches = rows.filter(row => row?.segment_code === codes[i]);
    if (matches.length !== 1 || !countKnown(matches[0].step_count)) {
      qualified = true;
      missing = true;
      continue;
    }
    const row = matches[0];
    // Both the schema and legacy DTO can supply zero without a measurement.
    if (row.step_count === 0) { qualified = true; continue; }
    const name = named(row.name) ? row.name : '路段名称未记录';
    const current = i === index;
    const distance = current ? null : entryDistance(route, codes, rows, index, i);
    const hint = { state: current ? 'current' : 'ahead', code: codes[i], name, count: row.step_count,
      index: i, distance, qualified };
    return { ...hint, text: formatStairText(hint) };
  }
  return missing ? unknown() : empty('none', unmarkedText);
}

function validStairs(stairs) {
  if (!stairs || !['current', 'ahead'].includes(stairs.state)) return false;
  return named(stairs.code) && named(stairs.name) && countKnown(stairs.count) && stairs.count > 0
    && Number.isSafeInteger(stairs.index) && stairs.index >= 0 && typeof stairs.qualified === 'boolean'
    && (stairs.distance === null || (typeof stairs.distance === 'number'
      && Number.isFinite(stairs.distance) && stairs.distance >= 0))
    && (stairs.state !== 'current' || (stairs.distance === null && stairs.qualified === false));
}
function validEmptyStairs(stairs) {
  return ['none', 'unknown'].includes(stairs?.state) && stairs.code === null && stairs.name === null
    && stairs.count === null && stairs.index === null && stairs.distance === null && stairs.qualified === false;
}
function validRest(rest) {
  return rest?.state === 'upcoming' && named(rest.name) && named(rest.nodeCode)
    && typeof rest.distance === 'number' && Number.isFinite(rest.distance) && rest.distance >= 0;
}

// Consume the display helpers, never infer route facts from raw DTOs or prose.
export function buildAheadSummary(stairs, rest) {
  if (stairs?.state === 'hidden' || rest?.state === 'hidden') return '';
  let stairText = '台阶登记证据不足，前方台阶暂未确认。';
  if (validStairs(stairs)) {
    stairText = formatStairText(stairs);
  } else if (validEmptyStairs(stairs)) stairText = stairs.state === 'none' ? unmarkedText : unknownText;
  let restText = '休息点登记证据不足，前方休息点暂未确认。';
  if (validRest(rest)) restText = `最近登记中途休息点：${rest.name}，估算登记路程约 ${rest.distance} 米。`;
  else if (rest?.state === 'none' && named(rest.text) && typeof rest.destinationText === 'string')
    restText = '前方未标注中途休息点。';
  const hasEstimate = (validStairs(stairs) && stairs.state === 'ahead' && stairs.distance !== null) || validRest(rest);
  return stairText + restText + (hasEstimate ? '估算含未确认走完的当前整段，不是实时距离。' : '');
}
