"""Opt-in preview of a registered stop on a complete directed candidate."""

from collections.abc import Mapping
from decimal import Decimal
from math import isfinite

from app.services.route_planner import numeric, top_k_dijkstra_paths


# Bounded reuse of the same profile/strategy planner; not a global waypoint search.
SEARCH_LIMIT = 12


def _registered_steps(path):
    counts = [edge.get("step_count") for edge in path]
    if not all(type(count) is int and count >= 0 for count in counts):
        return None
    return sum(counts)


def _directed_nodes(path, start, end):
    if not path:
        return None
    nodes = [start]
    for edge in path:
        if edge["start_node_code"] != nodes[-1]:
            return None
        nodes.append(edge["end_node_code"])
    return nodes if nodes[-1] == end and len(nodes) == len(set(nodes)) else None


def _registered_distance(path):
    lengths = [numeric(edge, "length_m", 0) for edge in path]
    if not all(isfinite(length) and length > 0 for length in lengths):
        return None
    return round(sum(lengths), 2)


def _registered_lengths(path):
    """Ordered registered lengths only; no inferred distances for the budget."""
    values = [edge.get('length_m') for edge in path]
    try:
        if not all(type(value) in (int, float, Decimal) and isfinite(value) and value > 0 for value in values):
            return None
        lengths = [float(value) for value in values]
        return lengths if all(isfinite(value) and value > 0 for value in lengths) else None
    except (OverflowError, ValueError):
        return None


def rest_route_preview(segments, start, end, mobility_type, strategy, rest_pois):
    """Find one compatible route among a bounded set; never relax profile rules."""
    if mobility_type != "SLOW_WALKER" or start == end:
        return None
    stops = {}
    for poi in rest_pois:
        if not isinstance(poi, Mapping):
            continue
        node, name = poi.get("linked_node_code"), poi.get("name")
        if isinstance(node, str) and node and node not in (start, end) and name:
            stops.setdefault(node, name)
    if not stops:
        return None

    paths = top_k_dijkstra_paths(segments, start, end, mobility_type, SEARCH_LIMIT, strategy)
    if not paths or not _directed_nodes(paths[0], start, end):
        return None
    baseline = paths[0]
    baseline_distance = _registered_distance(baseline)
    if baseline_distance is None:
        return None
    for path in paths:
        nodes = _directed_nodes(path, start, end)
        distance = _registered_distance(path)
        if not nodes or distance is None:
            continue
        for incoming_index, node in enumerate(nodes[1:-1]):
            if node in stops:
                return {
                    "stop_name": stops[node],
                    "stop_after_segment_index": incoming_index,
                    "baseline_distance_m": baseline_distance,
                    "distance_m": distance,
                    "baseline_steps": _registered_steps(baseline),
                    "steps": _registered_steps(path),
                    "segment_codes": [edge["segment_code"] for edge in path],
                    "segment_names": [edge.get("name") or edge["segment_code"] for edge in path],
                    "segment_lengths_m": _registered_lengths(path),
                    "matches_baseline": path == baseline,
                }
    return None
