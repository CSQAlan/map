import { navigationRest } from './navigationRest.js';
import { validMapPoint } from './navigationMap.js';

const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const exactPoint = point => validMapPoint(point) && point.length === 2;

// features are the existing GCJ02 map-data result. Revalidate the full active
// route independently; route-row geometry, names and POI positions are not evidence.
export function navigationRestWaypoint(route, index, rest, features, options = {}) {
  const current = navigationRest(route, index, options);
  if (current.state !== 'upcoming' || rest?.state !== 'upcoming'
      || current.nodeCode !== rest.nodeCode || !Array.isArray(features)) return null;
  const nodeIndex = route.navigation_rest.node_codes.indexOf(current.nodeCode);
  if (nodeIndex <= 0 || nodeIndex >= route.segment_codes.length) return null;
  const lines = [];
  for (const code of route.segment_codes.slice(nodeIndex - 1, nodeIndex + 1)) {
    // Count before validating: even an invalid duplicate makes identity ambiguous.
    const matches = features.filter(feature => feature?.properties?.kind === 'segment'
      && feature.properties.segment_code === code);
    if (matches.length !== 1) return null;
    const geometry = matches[0].geometry;
    const points = geometry?.coordinates;
    if (geometry?.type !== 'LineString' || !Array.isArray(points) || points.length < 2
        || !Array.from(points).every(exactPoint) || samePoint(points[0], points.at(-1))) return null;
    lines.push([points[0], points.at(-1)]);
  }
  const shared = lines[0].filter(point => lines[1].some(other => samePoint(point, other)));
  if (shared.length !== 1) return null;
  return { nodeCode: current.nodeCode, name: current.name, point: [...shared[0]] };
}

export const restWaypointLabel = waypoint => `下一登记中途休息点：${waypoint.name}；登记路网节点，非座椅位置，未确认实时到达`;
