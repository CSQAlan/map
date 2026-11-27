"""Pure directed rest-route preview, with repository seed as well as synthetic cases."""
import json
from pathlib import Path

from app.services.rest_route_preview import rest_route_preview


def seed(name):
    data_dir = Path(__file__).resolve().parents[1] / "app/db/seed_data"
    return json.loads((data_dir / f"{name}.json").read_text(encoding="utf-8"))


def rest_pois():
    return [item for item in seed("core_pois") if item["poi_type"] == "REST_AREA"]


def test_fixture_rest_route_goes_through_woodland_not_lotus_platform():
    result = rest_route_preview(
        seed("core_segments"), "N_SY_GATE_WEST", "N_SY_LOTUS_ENTRY",
        "SLOW_WALKER", "BALANCED", rest_pois()
    )
    assert result["stop_name"] == "师大苑林下休闲步道"
    assert result["stop_after_segment_index"] == 1
    assert result["baseline_distance_m"] == 246
    assert result["distance_m"] == 444
    assert result["baseline_steps"] == 0
    assert result["steps"] == 3
    assert result["segment_codes"] == [
        "S_SY_GATE_TO_GARDEN_SPLIT", "S_SY_GARDEN_SPLIT_TO_REST",
        "S_SY_GARDEN_REST_TO_BRIDGE", "S_SY_BRIDGE_TO_LOTUS",
    ]


def test_same_profile_rules_no_reverse_or_destination_stop():
    segments = seed("core_segments")
    assert rest_route_preview(segments, "N_SY_GATE_WEST", "N_SY_LOTUS_ENTRY",
                              "WHEELCHAIR", "BALANCED", rest_pois()) is None
    assert rest_route_preview(segments, "N_SY_GATE_WEST", "N_SY_BUILDING_B",
                              "SLOW_WALKER", "BALANCED", rest_pois()) is None
    assert rest_route_preview(segments, "N_SY_GATE_WEST", "N_SY_LOTUS_ENTRY",
                              "SLOW_WALKER", "BALANCED", [{
                                  "name": "endpoint", "linked_node_code": "N_SY_LOTUS_ENTRY",
                              }]) is None


def edge(code, a, b, *, steps=None):
    return dict(segment_code=code, start_node_code=a, end_node_code=b, name=code,
                length_m=10, width_m=2, slope_percent=0, barrier_free_level=4,
                step_count=steps)


def test_dead_end_backtrack_declined_and_missing_stairs_remain_unknown():
    segments = [edge("sa", "S", "A"), edge("ar", "A", "R"), edge("at", "A", "T")]
    stops = [dict(name="real stop", linked_node_code="R")]
    assert rest_route_preview(segments + [edge("ra", "R", "A")], "S", "T",
                              "SLOW_WALKER", "BALANCED", stops) is None
    result = rest_route_preview(segments + [edge("rt", "R", "T")], "S", "T",
                                "SLOW_WALKER", "BALANCED", stops)
    assert result["segment_codes"] == ["sa", "ar", "rt"]
    assert result["steps"] is None
    assert result["baseline_steps"] is None


def test_direct_route_may_already_go_through_a_real_intermediate():
    result = rest_route_preview([edge("sr", "S", "R", steps=0), edge("rt", "R", "T", steps=0)],
                                "S", "T", "SLOW_WALKER", "BALANCED",
                                [dict(name="rest", linked_node_code="R")])
    assert result["distance_m"] == result["baseline_distance_m"] == 20
    assert result["steps"] == 0
