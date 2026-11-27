// Display evidence for the actual enabled route only. No fetch, GPS or speech.
const SOURCE = 'ACTIVE_REST_AREA_LINKED_NODES/v1';
const key = value => typeof value === 'string' && value.trim().length > 0;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const cents = value => Math.round(value * 100);
const unknown = () => ({ state: 'unknown', text: '前方登记休息点暂未确认：路线连接、长度或登记资料不完整。' });

// Common strict DTO validation. Consumers must use evidence from this exact route.
export function parseNavigationRest(route) {
  if (!route) return null;
  const meta = route.navigation_rest, codes = route.segment_codes, rows = route.segments;
  if (!meta || meta.version !== 1 || meta.source !== SOURCE || !Array.isArray(codes) || !codes.length
      || !codes.every(key) || new Set(codes).size !== codes.length
      || !Array.isArray(rows) || rows.length !== codes.length
      || !Array.isArray(meta.segment_codes) || meta.segment_codes.length !== codes.length
      || !Array.isArray(meta.node_codes) || meta.node_codes.length !== codes.length + 1
      || !meta.node_codes.every(key) || new Set(meta.node_codes).size !== meta.node_codes.length
      || !Array.isArray(meta.segment_lengths_m) || meta.segment_lengths_m.length !== codes.length
      || !Array.isArray(meta.stops) || !positive(route.distance_m)) return null;
  for (let i = 0; i < codes.length; i++) {
    if (meta.segment_codes[i] !== codes[i] || rows[i]?.segment_code !== codes[i]
        || !positive(rows[i].length_m) || !positive(meta.segment_lengths_m[i])
        || rows[i].length_m !== meta.segment_lengths_m[i]) return null;
  }
  if (cents(meta.segment_lengths_m.reduce((sum, length) => sum + length, 0)) !== cents(route.distance_m)) return null;
  let previous = -1;
  for (const stop of meta.stops) {
    if (!stop || !key(stop.name) || !Number.isInteger(stop.node_index) || stop.node_index <= previous
        || stop.node_index > codes.length || meta.node_codes[stop.node_index] !== stop.node_code) return null;
    previous = stop.node_index;
  }
  return meta;
}

export function navigationRest(route, index, { paused = false, active = true } = {}) {
  if (!active || paused || !route) return { state: 'hidden' };
  const meta = parseNavigationRest(route), codes = route.segment_codes;
  if (!meta || !Number.isInteger(index) || index < 0 || index >= codes.length) return unknown();
  const destination = meta.stops.find(stop => stop.node_index === codes.length);
  const next = meta.stops.find(stop => stop.node_index > index && stop.node_index < codes.length);
  const destinationText = destination ? `终点是登记休息点：${destination.name}。仅到本路线关联的路网节点，请核对到达边界。` : '';
  if (!next) return { state: 'none', text: '登记路线前方无已标注中途休息点。', destinationText };
  const distance = Math.round(meta.segment_lengths_m.slice(index, next.node_index).reduce((sum, length) => sum + length, 0) * 100) / 100;
  return { state: 'upcoming', name: next.name, distance, nodeCode: next.node_code, destinationText,
    text: `前方最近登记中途休息点：${next.name}。按手动确认进度估算，登记路程约 ${distance} 米。` };
}
