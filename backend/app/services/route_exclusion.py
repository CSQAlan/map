"""Request-local directed-edge exclusion; no persistence or profile relaxation."""


class RouteExclusionError(ValueError):
    code = 'EXCLUDED_SEGMENT_UNAVAILABLE'


def exclude_active_segment(segments, code):
    matches = [edge for edge in segments if edge.get('segment_code') == code
               and edge.get('status', 'ACTIVE') == 'ACTIVE']
    if not isinstance(code, str) or not code.strip() or len(code) > 100 or len(matches) != 1:
        raise RouteExclusionError('排除路段码未知、已停用或记录不唯一，请重新规划后选择。')
    return [edge for edge in segments if edge.get('segment_code') != code]
