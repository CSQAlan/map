from app.services.route_planner import (
    build_segment_detail,
    enumerate_paths,
    is_segment_allowed,
    recommend_routes,
    route_score,
    segment_cost,
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
