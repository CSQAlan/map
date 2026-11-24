import { wgs84ToGcj02 } from './navigationJourney.js';

// Only a GPS-start route needs clipping: route detail coordinates are WGS84,
// while the base map and evidence GeoJSON are requested in GCJ02.
export function mapFeaturesForOrigin(features, route) {
  if (!route?.start_context) return features;
  const segments = new Map((route.segments ?? []).map(segment => [segment.segment_code, segment]));
  const clipped = features.map(feature => {
    const segment = feature.properties?.kind === 'segment' && segments.get(feature.properties.segment_code);
    if (!segment?.geometry_coordinates?.length) return feature;
    return { ...feature, geometry: { type: 'LineString', coordinates: segment.geometry_coordinates.map(point => wgs84ToGcj02(...point)) } };
  });
  const point = route.start_context.snapped_coordinates;
  if (point?.length === 2) clipped.push({ type: 'Feature', geometry: { type: 'Point', coordinates: wgs84ToGcj02(...point) }, properties: { kind: 'poi', name: '路线接入点' } });
  return clipped;
}
