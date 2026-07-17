from app.services.route_planner import (
    build_segment_detail,
    dijkstra_path,
    enumerate_paths,
    explain_avoided_segments,
    is_segment_allowed,
    recommend_routes,
    route_score,
    segment_cost,
    top_k_dijkstra_paths,
)


def test_low_risk_segment_costs_less_than_high_risk_segment() -> None:
    low_risk = {
        "length_m": 60,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    high_risk = {
        "length_m": 60,
        "slope_percent": 4,
        "surface_level": 2,
        "safety_level": 2,
        "barrier_free_level": 2,
        "rest_facility_score": 2,
        "step_count": 3,
        "width_m": 0.8,
        "wheelchair_accessible": False,
    }
    assert segment_cost(low_risk, "ASSISTED") < segment_cost(high_risk, "ASSISTED")


def test_route_score_sums_segment_costs() -> None:
    segment = {
        "length_m": 100,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    assert route_score([segment, segment], "INDEPENDENT") == segment_cost(segment, "INDEPENDENT") * 2


def test_wheelchair_blocks_steps_without_ramp() -> None:
    segment = {
        "length_m": 30,
        "slope_percent": 1,
        "barrier_free_level": 5,
        "wheelchair_accessible": True,
        "width_m": 1.5,
        "step_count": 1,
        "has_ramp": False,
    }
    assert not is_segment_allowed(segment, "WHEELCHAIR")
    assert is_segment_allowed(segment, "CANE")


def test_build_segment_detail_returns_tags_and_explanation() -> None:
    segment = {
        "segment_code": "A_B",
        "name": "A to B",
        "length_m": 30,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "wheelchair_accessible": True,
        "width_m": 1.5,
        "step_count": 0,
        "has_ramp": True,
        "has_handrail": True,
        "shade_coverage_percent": 50,
        "bench_count": 1,
    }
    detail = build_segment_detail(segment, "WHEELCHAIR")
    assert detail["segment_code"] == "A_B"
    assert "轮椅可通行" in detail["benefit_tags"]
    assert detail["risk_tags"] == []
    assert detail["explanation"]


def test_wheelchair_requires_enough_width() -> None:
    segment = {
        "length_m": 30,
        "slope_percent": 1,
        "barrier_free_level": 5,
        "wheelchair_accessible": True,
        "width_m": 0.9,
        "step_count": 0,
    }
    assert not is_segment_allowed(segment, "WHEELCHAIR")
    assert is_segment_allowed(segment, "INDEPENDENT")


def test_explain_avoided_segments_reports_wheelchair_blockers() -> None:
    blocked_segment = {
        "segment_code": "A_B",
        "name": "stair shortcut",
        "length_m": 30,
        "slope_percent": 1,
        "barrier_free_level": 2,
        "wheelchair_accessible": False,
        "width_m": 0.9,
        "step_count": 2,
        "has_ramp": False,
    }
    safe_segment = {
        "segment_code": "A_C",
        "name": "ramp path",
        "length_m": 30,
        "slope_percent": 1,
        "barrier_free_level": 5,
        "surface_level": 5,
        "safety_level": 5,
        "rest_facility_score": 4,
        "wheelchair_accessible": True,
        "width_m": 1.5,
        "step_count": 0,
        "has_ramp": True,
    }

    explanations = explain_avoided_segments([blocked_segment, safe_segment], "WHEELCHAIR")

    assert len(explanations) == 1
    assert explanations[0]["segment_code"] == "A_B"
    assert explanations[0]["avoidance_level"] == "BLOCKED"
    assert "台阶" in "，".join(explanations[0]["reasons"])
    assert "路宽" in "，".join(explanations[0]["reasons"])
    assert "轮椅" in "，".join(explanations[0]["reasons"])


def test_explain_avoided_segments_reports_cane_high_risk_steps() -> None:
    segment = {
        "segment_code": "B_C",
        "name": "step path",
        "length_m": 30,
        "slope_percent": 2,
        "barrier_free_level": 3,
        "wheelchair_accessible": False,
        "width_m": 1.2,
        "step_count": 2,
        "has_ramp": False,
        "has_handrail": False,
        "surface_level": 4,
        "safety_level": 4,
    }

    explanations = explain_avoided_segments([segment], "CANE")

    assert len(explanations) == 1
    assert explanations[0]["segment_code"] == "B_C"
    assert explanations[0]["avoidance_level"] == "HIGH_RISK"
    assert "拐杖" in "，".join(explanations[0]["reasons"])


def test_enumerate_paths_finds_multiple_simple_paths() -> None:
    segments = [
        {"segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {"segment_code": "B_D", "start_node_code": "B", "end_node_code": "D"},
        {"segment_code": "A_C", "start_node_code": "A", "end_node_code": "C"},
        {"segment_code": "C_D", "start_node_code": "C", "end_node_code": "D"},
    ]
    paths = enumerate_paths(segments, "A", "D")
    codes = [[segment["segment_code"] for segment in path] for path in paths]
    assert ["A_B", "B_D"] in codes
    assert ["A_C", "C_D"] in codes


def test_dijkstra_path_selects_lowest_cost_route_not_first_route() -> None:
    base = {
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B", "length_m": 300},
        {**base, "segment_code": "B_D", "start_node_code": "B", "end_node_code": "D", "length_m": 300},
        {**base, "segment_code": "A_C", "start_node_code": "A", "end_node_code": "C", "length_m": 40},
        {**base, "segment_code": "C_D", "start_node_code": "C", "end_node_code": "D", "length_m": 40},
    ]

    path = dijkstra_path(segments, "A", "D", "INDEPENDENT")

    assert [segment["segment_code"] for segment in path] == ["A_C", "C_D"]


def test_dijkstra_path_can_traverse_pedestrian_segments_in_reverse() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 4,
        "safety_level": 4,
        "barrier_free_level": 4,
        "rest_facility_score": 3,
        "width_m": 1.5,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_C", "start_node_code": "B", "end_node_code": "C"},
    ]

    path = dijkstra_path(segments, "C", "A", "WHEELCHAIR")

    assert [segment["segment_code"] for segment in path] == ["B_C", "A_B"]
    assert path[0]["start_node_code"] == "C"
    assert path[-1]["end_node_code"] == "A"


def test_dijkstra_path_respects_blocked_edges_for_spur_routes() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_D", "start_node_code": "B", "end_node_code": "D"},
        {**base, "segment_code": "A_C", "start_node_code": "A", "end_node_code": "C", "length_m": 70},
        {**base, "segment_code": "C_D", "start_node_code": "C", "end_node_code": "D", "length_m": 70},
    ]

    path = dijkstra_path(segments, "A", "D", "INDEPENDENT", blocked_edges={("A", "B", "A_B")})

    assert [segment["segment_code"] for segment in path] == ["A_C", "C_D"]


def test_dijkstra_path_avoids_back_edge_cycles() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_A", "start_node_code": "B", "end_node_code": "A"},
        {**base, "segment_code": "B_D", "start_node_code": "B", "end_node_code": "D"},
    ]

    path = dijkstra_path(segments, "A", "D", "INDEPENDENT")

    assert [segment["segment_code"] for segment in path] == ["A_B", "B_D"]


def test_top_k_dijkstra_paths_returns_sorted_unique_candidates() -> None:
    base = {
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B", "length_m": 40},
        {**base, "segment_code": "B_D", "start_node_code": "B", "end_node_code": "D", "length_m": 40},
        {**base, "segment_code": "A_C", "start_node_code": "A", "end_node_code": "C", "length_m": 70},
        {**base, "segment_code": "C_D", "start_node_code": "C", "end_node_code": "D", "length_m": 70},
        {**base, "segment_code": "A_E", "start_node_code": "A", "end_node_code": "E", "length_m": 90},
        {**base, "segment_code": "E_D", "start_node_code": "E", "end_node_code": "D", "length_m": 90},
    ]

    paths = top_k_dijkstra_paths(segments, "A", "D", "INDEPENDENT", limit=3)
    codes = [[segment["segment_code"] for segment in path] for path in paths]
    scores = [route_score(path, "INDEPENDENT") for path in paths]

    assert codes == [["A_B", "B_D"], ["A_C", "C_D"], ["A_E", "E_D"]]
    assert scores == sorted(scores)


def test_top_k_dijkstra_paths_keeps_deterministic_order_for_equal_costs() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_C", "start_node_code": "A", "end_node_code": "C"},
        {**base, "segment_code": "C_D", "start_node_code": "C", "end_node_code": "D"},
        {**base, "segment_code": "A_B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_D", "start_node_code": "B", "end_node_code": "D"},
    ]

    paths = top_k_dijkstra_paths(segments, "A", "D", "INDEPENDENT", limit=2)

    assert [[segment["segment_code"] for segment in path] for path in paths] == [
        ["A_B", "B_D"],
        ["A_C", "C_D"],
    ]


def test_recommend_routes_returns_sorted_top_three() -> None:
    base = {
        "length_m": 50,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 5,
        "step_count": 0,
        "width_m": 1.6,
        "wheelchair_accessible": True,
    }
    segments = [
        {**base, "segment_code": "A_B", "name": "A到B", "start_node_code": "A", "end_node_code": "B"},
        {**base, "segment_code": "B_D", "name": "B到D", "start_node_code": "B", "end_node_code": "D"},
        {
            **base,
            "segment_code": "A_C",
            "name": "A到C",
            "start_node_code": "A",
            "end_node_code": "C",
            "length_m": 80,
        },
        {
            **base,
            "segment_code": "C_D",
            "name": "C到D",
            "start_node_code": "C",
            "end_node_code": "D",
            "length_m": 80,
        },
    ]
    routes = recommend_routes(segments, "A", "D", "INDEPENDENT")
    assert len(routes) == 2
    assert routes[0]["route_score"] <= routes[1]["route_score"]
    assert routes[0]["rank"] == 1


def test_route_strategy_changes_first_recommendation() -> None:
    safe_base = {
        "slope_percent": 0.8,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "crossing_safety_level": 5,
        "lighting_level": 5,
        "step_count": 0,
        "width_m": 1.8,
        "wheelchair_accessible": True,
    }
    short_risky_base = {
        "slope_percent": 1.0,
        "surface_level": 3,
        "safety_level": 1,
        "barrier_free_level": 3,
        "rest_facility_score": 2,
        "crossing_safety_level": 1,
        "lighting_level": 1,
        "step_count": 0,
        "width_m": 1.1,
        "wheelchair_accessible": True,
    }
    segments = [
        {
            **short_risky_base,
            "segment_code": "A_B_SHORT",
            "name": "short risky start",
            "start_node_code": "A",
            "end_node_code": "B",
            "length_m": 30,
        },
        {
            **short_risky_base,
            "segment_code": "B_D_SHORT",
            "name": "short risky end",
            "start_node_code": "B",
            "end_node_code": "D",
            "length_m": 30,
        },
        {
            **safe_base,
            "segment_code": "A_C_SAFE",
            "name": "safe start",
            "start_node_code": "A",
            "end_node_code": "C",
            "length_m": 150,
        },
        {
            **safe_base,
            "segment_code": "C_D_SAFE",
            "name": "safe end",
            "start_node_code": "C",
            "end_node_code": "D",
            "length_m": 150,
        },
    ]

    safest_routes = recommend_routes(segments, "A", "D", "INDEPENDENT", strategy="SAFEST")
    shortest_routes = recommend_routes(segments, "A", "D", "INDEPENDENT", strategy="SHORTEST")

    assert safest_routes[0]["segment_codes"] == ["A_C_SAFE", "C_D_SAFE"]
    assert shortest_routes[0]["segment_codes"] == ["A_B_SHORT", "B_D_SHORT"]
    assert "已按安全优先排序" in safest_routes[0]["summary"]
    assert "已按距离优先排序" in shortest_routes[0]["summary"]


def test_recommend_routes_filters_inaccessible_wheelchair_path() -> None:
    accessible = {
        "length_m": 80,
        "slope_percent": 1,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "step_count": 0,
        "width_m": 1.5,
        "wheelchair_accessible": True,
    }
    stair = {
        **accessible,
        "wheelchair_accessible": False,
        "step_count": 4,
        "has_ramp": False,
    }
    segments = [
        {**stair, "segment_code": "A_B", "name": "stair", "start_node_code": "A", "end_node_code": "B"},
        {**stair, "segment_code": "B_D", "name": "stair", "start_node_code": "B", "end_node_code": "D"},
        {**accessible, "segment_code": "A_C", "name": "ramp", "start_node_code": "A", "end_node_code": "C"},
        {**accessible, "segment_code": "C_D", "name": "ramp", "start_node_code": "C", "end_node_code": "D"},
    ]
    routes = recommend_routes(segments, "A", "D", "WHEELCHAIR")
    assert len(routes) == 1
    assert routes[0]["segment_codes"] == ["A_C", "C_D"]
    assert routes[0]["segments"][0]["segment_code"] == "A_C"
