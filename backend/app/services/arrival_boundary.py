"""Read-only endpoint annotations; never participate in graph search.

SHIDAYUAN entry/platform interpretation v1 (2026-11-24), sourced from
db/seed_data/core_pois.json, core_nodes.json and core_segments.json.
Runtime uses the server-resolved node and loaded active edges, not names,
photos, documents, seed loading, coordinates or an additional DB query.
"""


def arrival_boundary(area_code, end_node_code, route, segments):
    if not isinstance(route, dict) or not isinstance(segments, list) or not all(isinstance(row, dict) for row in segments):
        return None
    codes = route.get("segment_codes")
    if not isinstance(codes, list) or not codes or not all(isinstance(code, str) and code for code in codes) or not isinstance(end_node_code, str) or not end_node_code:
        return None
    rows = [row for row in segments if row.get("segment_code") == codes[-1]]
    if len(rows) != 1 or rows[0].get("end_node_code") != end_node_code:
        return None
    result = dict(version=1, node_code=end_node_code, last_segment_code=codes[-1],
                  kind="NETWORK_NODE", source="server-resolved-active-road-node/v1",
                  connection_step_count=None, connection_ramp_recorded=None)
    if area_code == "SHIDAYUAN" and end_node_code == "N_SY_LOTUS_ENTRY":
        result.update(kind="LOTUS_ENTRY", source="SHIDAYUAN-core-endpoint-interpretation/2026-11-24/v1")
        connections = [row for row in segments if row.get("segment_code") == "S_SY_LOTUS_ENTRY_TO_PLATFORM"
                       and row.get("start_node_code") == end_node_code
                       and row.get("end_node_code") == "N_SY_LOTUS_PLATFORM"]
        if len(connections) == 1 and "S_SY_LOTUS_ENTRY_TO_PLATFORM" not in codes:
            edge = connections[0]
            steps = edge.get("step_count")
            if type(steps) is int and steps >= 0:
                result["connection_step_count"] = steps
            ramp = edge.get("has_ramp")
            if type(ramp) is bool:
                result["connection_ramp_recorded"] = ramp
    return result
