// Navigation-only adapter. Never derive direction or progress from map geometry.
export const validMapPoint = point => Array.isArray(point) && point.length >= 2 &&
  Number.isFinite(point[0]) && Number.isFinite(point[1]) &&
  Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;

export function registeredRoadFeatures(features = []) {
  return features.filter(feature => feature?.properties?.kind === 'segment' &&
    typeof feature.properties.segment_code === 'string' && feature.properties.segment_code.trim() &&
    features.filter(other => other?.properties?.kind === 'segment' && other.properties.segment_code === feature.properties.segment_code).length === 1 &&
    feature.geometry?.type === 'LineString' && feature.geometry.coordinates?.length > 1 &&
    feature.geometry.coordinates.every(validMapPoint));
}

export function segmentGeometry(features, code) {
  const matches = registeredRoadFeatures(features).filter(feature => feature.properties.segment_code === code);
  return matches.length === 1 ? matches[0] : null;
}

export function routePartState(code, orderedCodes, manualIndex) {
  const indices = orderedCodes.flatMap((value,i) => value === code ? [i] : []);
  if (indices.length !== 1 || !Number.isInteger(manualIndex) || manualIndex < 0 || manualIndex >= orderedCodes.length) return 'context';
  return indices[0] < manualIndex ? 'completed' : indices[0] === manualIndex ? 'current' : 'upcoming';
}

export const routePartLabel = state => ({completed:'已手动确认完成',current:'当前路段',upcoming:'尚未确认完成',context:'非确认进度路段'}[state]);

export function inMapCoverage(point, area, features) {
  if (!validMapPoint(point)) return false;
  const bounds = area?.limit_bounds;
  if (validMapPoint(bounds?.south_west) && validMapPoint(bounds?.north_east)) {
    if (point[0] < bounds.south_west[0] || point[0] > bounds.north_east[0] ||
        point[1] < bounds.south_west[1] || point[1] > bounds.north_east[1]) return false;
    const ring = area?.boundary?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(validMapPoint)) return true;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      const cross = (point[0]-a[0])*(b[1]-a[1])-(point[1]-a[1])*(b[0]-a[0]);
      if (Math.abs(cross) < 1e-12 && point[0] >= Math.min(a[0],b[0]) && point[0] <= Math.max(a[0],b[0]) &&
          point[1] >= Math.min(a[1],b[1]) && point[1] <= Math.max(a[1],b[1])) return true;
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < (b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
    }
    return inside;
  }
  const points = registeredRoadFeatures(features).flatMap(feature => feature.geometry.coordinates);
  if (!points.length) return false;
  // Without a registered area use only the registered schematic's extent.
  return point[0] >= Math.min(...points.map(p=>p[0])) && point[0] <= Math.max(...points.map(p=>p[0])) &&
    point[1] >= Math.min(...points.map(p=>p[1])) && point[1] <= Math.max(...points.map(p=>p[1]));
}

export function freshMapPosition(position, quality, enabled, area, features, now = Date.now()) {
  if (!enabled || quality !== 'good' || !position || !Number.isFinite(position.timestamp) ||
      position.timestamp > now + 5000 || now-position.timestamp > 15000 ||
      !Number.isFinite(position.accuracy) || position.accuracy < 0 || position.accuracy > 30 ||
      !inMapCoverage(position.point, area, features)) return null;
  return position;
}
