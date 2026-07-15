from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)

GATE_3_NAME = "\u91cd\u5e86\u5e08\u8303\u5927\u5b66\u4e09\u53f7\u95e8"
CANTEEN_NAME = "\u91cd\u5e86\u5e08\u8303\u5927\u5b66\u98df\u5802"
UNKNOWN_GATE_NAME = "\u4e0d\u5b58\u5728\u7684\u95e8"


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows

    def scalar_one_or_none(self) -> int | None:
        return self._rows[0]["id"] if self._rows else None


class FakeSession:
    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        if "FROM poi_facility" in sql:
            name = params["name"] if params else ""
            mapping = {
                GATE_3_NAME: 1,
                CANTEEN_NAME: 3,
            }
            return FakeResult([{"id": mapping[name]}] if name in mapping else [])
        return FakeResult(
            [
                {
                    "segment_code": "S_GATE3_TO_WIDE_PATH",
                    "name": "\u4e09\u53f7\u95e8\u5230\u5bbd\u7f13\u6b65\u9053",
                    "start_node_code": "N_GATE3",
                    "end_node_code": "N_WIDE_PATH",
                    "length_m": 136,
                    "slope_percent": 1.2,
                    "surface_level": 4,
                    "safety_level": 5,
                    "barrier_free_level": 5,
                    "rest_facility_score": 4,
                    "width_m": 1.6,
                    "wheelchair_accessible": True,
                    "has_ramp": True,
                    "has_handrail": False,
                    "shade_coverage_percent": 35,
                    "bench_count": 0,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_WIDE_PATH_TO_SIDE",
                    "name": "\u5bbd\u7f13\u6b65\u9053\u5230\u98df\u5802\u4fa7\u8def",
                    "start_node_code": "N_WIDE_PATH",
                    "end_node_code": "N_SIDE_PATH",
                    "length_m": 72,
                    "slope_percent": 1.6,
                    "surface_level": 4,
                    "safety_level": 5,
                    "barrier_free_level": 5,
                    "rest_facility_score": 4,
                    "width_m": 1.5,
                    "wheelchair_accessible": True,
                    "has_ramp": False,
                    "has_handrail": True,
                    "shade_coverage_percent": 45,
                    "bench_count": 1,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_SIDE_TO_CANTEEN",
                    "name": "\u98df\u5802\u4fa7\u8def\u5230\u98df\u5802",
                    "start_node_code": "N_SIDE_PATH",
                    "end_node_code": "N_CANTEEN",
                    "length_m": 54,
                    "slope_percent": 1.4,
                    "surface_level": 4,
                    "safety_level": 4,
                    "barrier_free_level": 4,
                    "rest_facility_score": 4,
                    "width_m": 1.4,
                    "wheelchair_accessible": True,
                    "has_ramp": False,
                    "has_handrail": False,
                    "shade_coverage_percent": 20,
                    "bench_count": 0,
                    "step_count": 0,
                },
            ]
        )


def override_get_db() -> Any:
    yield FakeSession()


@pytest.fixture(autouse=True)
def db_override() -> Any:
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def test_recommend_route_api_returns_candidates() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_3_NAME,
            "end_name": CANTEEN_NAME,
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["routes"]) == 1
    assert data["routes"][0]["rank"] == 1
    assert data["routes"][0]["segments"][0]["segment_code"] == "S_GATE3_TO_WIDE_PATH"
    assert data["routes"][0]["segments"][0]["benefit_tags"]
    assert data["routes"][0]["segments"][0]["explanation"]


def test_recommend_route_api_rejects_unknown_poi() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": UNKNOWN_GATE_NAME,
            "end_name": CANTEEN_NAME,
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 404
