from app.services.accessibility_diagnostics import diagnose_segments


def test_diagnose_segments_recommends_ramp_for_steps_without_ramp() -> None:
    segment = {
        "segment_code": "S_STAIR",
        "name": "食堂入口台阶",
        "step_count": 2,
        "has_ramp": False,
        "has_handrail": True,
        "width_m": 1.5,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 40,
    }

    suggestions = diagnose_segments([segment])

    assert suggestions[0]["issue_type"] == "MISSING_RAMP"
    assert suggestions[0]["priority"] == "HIGH"
    assert "WHEELCHAIR" in suggestions[0]["affected_profiles"]
    assert "坡道" in suggestions[0]["suggestion"]


def test_diagnose_segments_recommends_handrail_for_steps_without_handrail() -> None:
    segment = {
        "segment_code": "S_NO_HANDRAIL",
        "name": "校医院侧台阶",
        "step_count": 1,
        "has_ramp": True,
        "has_handrail": False,
        "width_m": 1.5,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 40,
    }

    suggestions = diagnose_segments([segment])

    assert any(item["issue_type"] == "MISSING_HANDRAIL" for item in suggestions)
    assert any("扶手" in item["suggestion"] for item in suggestions)


def test_diagnose_segments_parses_string_booleans() -> None:
    segment = {
        "segment_code": "S_STRING_BOOL",
        "name": "字符串布尔路段",
        "step_count": 1,
        "has_ramp": "false",
        "has_handrail": "0",
        "width_m": 1.5,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 40,
    }

    issue_types = {item["issue_type"] for item in diagnose_segments([segment])}

    assert "MISSING_RAMP" in issue_types
    assert "MISSING_HANDRAIL" in issue_types


def test_diagnose_segments_recommends_widening_for_narrow_path() -> None:
    segment = {
        "segment_code": "S_NARROW",
        "name": "窄通道",
        "step_count": 0,
        "has_ramp": True,
        "has_handrail": False,
        "width_m": 0.9,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 40,
    }

    suggestions = diagnose_segments([segment])

    assert suggestions[0]["issue_type"] == "NARROW_WIDTH"
    assert "拓宽" in suggestions[0]["suggestion"]


def test_diagnose_segments_prioritizes_rest_seat_gap() -> None:
    segment = {
        "segment_code": "S_NO_REST",
        "name": "长距离步道",
        "step_count": 0,
        "has_ramp": True,
        "has_handrail": False,
        "width_m": 1.5,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 2,
        "bench_count": 0,
        "shade_coverage_percent": 40,
    }

    suggestions = diagnose_segments([segment])

    assert suggestions[0]["issue_type"] == "NO_REST_SEAT"
    assert suggestions[0]["priority"] == "MEDIUM"
    assert "座椅" in suggestions[0]["suggestion"]


def test_diagnose_segments_reports_surface_safety_barrier_and_shade() -> None:
    segment = {
        "segment_code": "S_MULTI",
        "name": "综合问题路段",
        "step_count": 0,
        "has_ramp": True,
        "has_handrail": True,
        "width_m": 1.5,
        "surface_level": 2,
        "safety_level": 2,
        "barrier_free_level": 3,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 10,
    }

    issue_types = {item["issue_type"] for item in diagnose_segments([segment])}

    assert "POOR_SURFACE" in issue_types
    assert "LOW_SAFETY" in issue_types
    assert "LOW_BARRIER_FREE" in issue_types
    assert "LOW_SHADE" in issue_types


def test_diagnose_segments_returns_empty_when_segment_is_accessible() -> None:
    segment = {
        "segment_code": "S_GOOD",
        "name": "宽缓步道",
        "step_count": 0,
        "has_ramp": True,
        "has_handrail": True,
        "width_m": 1.6,
        "surface_level": 5,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "bench_count": 1,
        "shade_coverage_percent": 40,
    }

    assert diagnose_segments([segment]) == []
