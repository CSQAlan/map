"""Conservative entry into an existing directed road graph; no off-road links."""
import json
import math
import time

from app.services.route_planner import is_segment_allowed, segment_avoidance_reasons

MAX_ENTRY_DISTANCE_M = 20.0
MAX_ACCURACY_M = 30.0
MAX_FIX_AGE_MS = 60000
CURRENT_NODE = '__CURRENT_ORIGIN__'


class CurrentOriginError(ValueError):
    pass


def validate_fix(longitude, latitude, accuracy, timestamp_ms):
    values = [longitude, latitude, accuracy, timestamp_ms]
    if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in values):
        raise CurrentOriginError('定位信息不完整，请重新获取当前位置。')
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        raise CurrentOriginError('定位坐标无效，请重新定位。')
    if not 0 <= accuracy <= MAX_ACCURACY_M:
        raise CurrentOriginError('定位精度不足，请到开阔处重新定位，或手动选择起点。')
    if not -5000 <= time.time() * 1000 - timestamp_ms <= MAX_FIX_AGE_MS:
        raise CurrentOriginError('当前位置已过期，请重新定位。')


def project_to_line(point, coordinates):
    """Local metric projection, sufficient for this small pilot and 20m gate."""
    sx = 111320 * math.cos(math.radians(point[1]))
    sy = 111320
    lengths = [math.hypot((b[0] - a[0]) * sx, (b[1] - a[1]) * sy)
               for a, b in zip(coordinates, coordinates[1:])]
    total = sum(lengths)
    if not total:
        raise CurrentOriginError('这条道路缺少有效几何，请手动选择起点。')
    best = None
    traversed = 0.0
    for index, (a, b) in enumerate(zip(coordinates, coordinates[1:])):
        ax, ay = (a[0] - point[0]) * sx, (a[1] - point[1]) * sy
        dx, dy = (b[0] - a[0]) * sx, (b[1] - a[1]) * sy
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1)))
        distance = math.hypot(ax + t * dx, ay + t * dy)
        if best is None or distance < best['distance_m']:
            best = dict(distance_m=distance, index=index, t=t,
                        fraction=(traversed + t * lengths[index]) / total,
                        point=[a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])])
        traversed += lengths[index]
    return best


def segment_coordinates(segment):
    geometry = segment.get('geom_geojson')
    if isinstance(geometry, str):
        geometry = json.loads(geometry)
    return (geometry or {}).get('coordinates', [])


def nearby_starts(segments, point, mobility_type):
    result = []
    for segment in segments:
        coordinates = segment_coordinates(segment)
        if len(coordinates) < 2:
            continue
        projection = project_to_line(point, coordinates)
        if projection['distance_m'] > MAX_ENTRY_DISTANCE_M:
            continue
        allowed = is_segment_allowed(segment, mobility_type)
        _, reasons = segment_avoidance_reasons(segment, mobility_type)
        result.append({
            'segment_code': str(segment['segment_code']), 'name': segment.get('name') or '已收录道路',
            'distance_m': round(projection['distance_m'], 1),
            'snapped_coordinates': projection['point'], 'allowed': allowed,
            'reasons': reasons if not allowed else [],
        })
    return sorted(result, key=lambda item: (item['distance_m'], item['segment_code']))[:5]


def attach_origin(segments, point, segment_code, mobility_type):
    segment = next((item for item in segments if str(item['segment_code']) == segment_code), None)
    if segment is None:
        raise CurrentOriginError('这条道路已不可用，请重新定位并确认起点。')
    projection = project_to_line(point, segment_coordinates(segment))
    if projection['distance_m'] > MAX_ENTRY_DISTANCE_M:
        raise CurrentOriginError('当前位置不在已收录道路附近，暂不能提供这段路的适老导航。')
    if not is_segment_allowed(segment, mobility_type):
        raise CurrentOriginError('这条道路不符合当前出行条件，请确认位置或手动选择起点。')
    context = {
        'segment_code': segment_code, 'name': segment.get('name') or '已收录道路',
        'snapped_coordinates': projection['point'], 'distance_m': round(projection['distance_m'], 1),
        'notice': '路线从您确认的已收录道路接入点开始，不包含当前位置到接入点之间的未知通行路段。中途接入的风险指标沿用整段资料。',
    }
    if projection['fraction'] <= 1e-8:
        return segments, str(segment['start_node_code']), context
    if projection['fraction'] >= 1 - 1e-8:
        return segments, str(segment['end_node_code']), context
    coordinates = segment_coordinates(segment)
    remaining = [projection['point'], *coordinates[projection['index'] + 1:]]
    partial = {
        **segment, 'start_node_code': CURRENT_NODE,
        'length_m': float(segment['length_m']) * (1 - projection['fraction']),
        'geom_geojson': json.dumps({'type': 'LineString', 'coordinates': remaining}),
        # Keep whole-segment risks: the exact positions of steps are unknown.
    }
    return [*segments, partial], CURRENT_NODE, context
