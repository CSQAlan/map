"""Optional display evidence for an actual candidate, never a rest-stop itinerary.

rest_pois must be the active REST_AREA catalog from the existing area-scoped
loader. None means unavailable, not an empty catalog. No proximity, geometry,
identity, DB/config import or route search is used here. Missing/ambiguous
evidence returns None; consumers must say unconfirmed, not 'no stops'.
"""
from collections.abc import Mapping
from decimal import Decimal
from math import isfinite
from app.services.current_origin import CURRENT_NODE


SOURCE = 'ACTIVE_REST_AREA_LINKED_NODES/v1'


def _key(value):
    return isinstance(value, str) and bool(value.strip())


def _positive(value):
    try:
        return type(value) in (int, float, Decimal) and isfinite(value) and value > 0
    except (OverflowError, ValueError):
        return False


def navigation_rest_stops(route, segments, start_node, end_node, rest_pois):
    """Prove full directed ordering and lengths against the *searched* graph.

    This also accepts the real clipped graph/virtual start produced by
    attach_origin. REST_AREA nodes are never synthesized at a GPS projection.
    All lengths are registered edge lengths (rounded DTO precision); no steps
    are included because the planner's defaulted steps aren't coverage proof.
    """
    if not isinstance(route, Mapping) or not isinstance(segments, list) or not isinstance(rest_pois, list):
        return None
    codes = route.get('segment_codes')
    rows = route.get('segments')
    if (not _key(start_node) or not _key(end_node) or not isinstance(codes, list)
            or not codes or not all(_key(code) for code in codes)
            or len(set(codes)) != len(codes) or not isinstance(rows, list) or len(rows) != len(codes)):
        return None
    nodes, lengths = [start_node], []
    for code, detail in zip(codes, rows):
        matches = [edge for edge in segments if isinstance(edge, Mapping) and edge.get('segment_code') == code]
        # attach_origin retains the original and appends one same-code clipped
        # edge. Only the first edge at its explicit virtual start may disambiguate
        # this exact pair; ordinary duplicate codes remain unknown.
        if len(matches) == 2 and not lengths and start_node == CURRENT_NODE:
            clipped = [edge for edge in matches if edge.get('start_node_code') == CURRENT_NODE]
            original = [edge for edge in matches if edge.get('start_node_code') != CURRENT_NODE]
            if (len(clipped) == len(original) == 1
                    and original[0].get('status', 'ACTIVE') == 'ACTIVE'
                    and original[0].get('end_node_code') == clipped[0].get('end_node_code')
                    and _positive(original[0].get('length_m')) and _positive(clipped[0].get('length_m'))
                    and original[0]['length_m'] >= clipped[0]['length_m']):
                matches = clipped
        if len(matches) != 1 or not isinstance(detail, Mapping) or detail.get('segment_code') != code:
            return None
        edge = matches[0]
        end = edge.get('end_node_code')
        length = edge.get('length_m')
        if (edge.get('status', 'ACTIVE') != 'ACTIVE' or edge.get('start_node_code') != nodes[-1]
                or not _key(end) or end in nodes or not _positive(length)
                or not _positive(detail.get('length_m'))
                or round(float(length), 2) != detail['length_m']):
            return None
        nodes.append(end)
        lengths.append(detail['length_m'])
    if (nodes[-1] != end_node or not _positive(route.get('distance_m'))
            or round(sum(lengths), 2) != round(route['distance_m'], 2)):
        return None
    catalog = {}
    for poi in rest_pois:
        if (not isinstance(poi, Mapping) or not _key(poi.get('name')) or not _key(poi.get('linked_node_code'))
                or poi.get('poi_type', 'REST_AREA') != 'REST_AREA' or poi.get('status', 'ACTIVE') != 'ACTIVE'):
            return None
        node = poi['linked_node_code']
        if poi.get('registered_node_code', node) != node:
            return None
        if node in catalog:
            return None  # Even identical labels do not resolve two records at one node.
        catalog[node] = poi['name']
    return dict(version=1, source=SOURCE, segment_codes=list(codes), node_codes=nodes,
                segment_lengths_m=lengths,
                stops=[dict(node_code=node, node_index=index, name=catalog[node])
                       for index, node in enumerate(nodes) if node in catalog])
