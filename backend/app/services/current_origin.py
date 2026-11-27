"""Conservative entry into an existing directed road graph; no off-road links."""
import json
import math
import time

from app.services.route_planner import is_segment_allowed, segment_avoidance_reasons
from app.services.route_exclusion import exclude_active_segment

MAX_ENTRY_DISTANCE_M = 20.0
MAX_ACCURACY_M = 30.0
MAX_FIX_AGE_MS = 60000
CURRENT_NODE = '__CURRENT_ORIGIN__'


class CurrentOriginError(ValueError):
    pass


class ExcludedOriginError(CurrentOriginError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def exclusion_location_graph(segments, point, accuracy, mobility_type, excluded_code, selected_code=None):
    """No snap/automatic substitute: remove the edge and reject uncertain entry.

    Uses the existing entry gate and the fix's stated accuracy only. Distances
    to two geometries can each change by accuracy; overlapping distance ranges
    (difference <= 2*accuracy) cannot establish which edge the user is on.
    This conservative rejection is not proof that an accepted fix is on-road.
    Caller must first validate fix age/accuracy and pilot coverage.
    """
    try:
        filtered = exclude_active_segment(segments, excluded_code)
    except ValueError as error:
        raise ExcludedOriginError('EXCLUDED_SEGMENT_UNAVAILABLE', str(error)) from error
    if selected_code == excluded_code:
        raise ExcludedOriginError('EXCLUDED_START_SELECTED', '确认的起点路段正是本次排除段，不能在该段接入。')

    def distance(edge):
        try:
            coords = segment_coordinates(edge)
            if (not isinstance(coords, list) or len(coords) < 2
                    or any(not isinstance(p, (list, tuple)) or len(p) != 2
                           or any(type(v) not in (int, float) or not math.isfinite(v) for v in p)
                           or not -180 <= p[0] <= 180 or not -90 <= p[1] <= 90 for p in coords)):
                raise ValueError('invalid geometry')
            return project_to_line(point, coords)['distance_m']
        except (ValueError, TypeError, KeyError, IndexError) as error:
            raise ExcludedOriginError('EXCLUSION_GEOMETRY_UNCONFIRMED', '路段几何资料不足，无法确认定位与排除段的关系，请使用命名起点。') from error

    excluded = next(edge for edge in segments if edge['segment_code'] == excluded_code)
    excluded_distance = distance(excluded)
    nearby = []
    for edge in filtered:
        if edge.get('status', 'ACTIVE') != 'ACTIVE' or not is_segment_allowed(edge, mobility_type):
            continue
        d = distance(edge)
        if d <= MAX_ENTRY_DISTANCE_M:
            nearby.append((edge, d))
    if not nearby:
        code = 'ON_EXCLUDED_SEGMENT' if excluded_distance == 0 else 'ONLY_EXCLUDED_NEARBY' if excluded_distance <= MAX_ENTRY_DISTANCE_M else 'NO_COMPATIBLE_START'
        raise ExcludedOriginError(code, '附近没有可确认接入的同画像替代路段；不连接未知道路，不回到被排除段。')
    if any(abs(d - excluded_distance) <= 2 * accuracy for _, d in nearby):
        raise ExcludedOriginError('AMBIGUOUS_EXCLUDED_LOCATION', '定位误差内无法区分被排除段与替代边（包括重叠方向或共享节点），请重新定位或选择命名起点。')
    if any(excluded_distance < d for _, d in nearby):
        raise ExcludedOriginError('ON_EXCLUDED_SEGMENT' if excluded_distance == 0 else 'EXCLUDED_SEGMENT_NEAREST', '定位更靠近被排除段，不能自动跳到另一条道路，请使用命名起点。')
    if selected_code is not None and not any(edge['segment_code'] == selected_code for edge, _ in nearby):
        raise ExcludedOriginError('SELECTED_START_UNAVAILABLE', '已确认的替代路段不在可接入范围或不符合画像，不自动改选其他路段。')
    return filtered


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
