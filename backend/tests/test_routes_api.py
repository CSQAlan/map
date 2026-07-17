from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)

GATE_NAME = "师大苑大学城西路入口"
LOTUS_NAME = "师大苑荷塘水景休息区"
BUILDING_A_NAME = "师大苑楼栋组团A"
UNKNOWN_GATE_NAME = "\u4e0d\u5b58\u5728\u7684\u95e8"


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return iter(self._rows)

    def mappings(self) -> "FakeResult":
        return self

    def first(self) -> dict[str, Any] | None:
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self) -> int | None:
        return self._rows[0]["id"] if self._rows else None


class FakeSession:
    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        if "FROM poi_facility" in sql and "linked_node_code" in sql:
            name = params.get("name") if params else None
            mapping = {
                GATE_NAME: "N_SY_GATE_WEST",
                LOTUS_NAME: "N_SY_LOTUS_ENTRY",
                BUILDING_A_NAME: "N_SY_BUILDING_A",
            }
            endpoint_rows = [
                {
                    "id": index,
                    "name": endpoint_name,
                    "poi_type": "ENTRANCE" if endpoint_name == GATE_NAME else "REST_AREA",
                    "linked_node_code": node_code,
                    "is_accessible": True,
                }
                for index, (endpoint_name, node_code) in enumerate(mapping.items(), start=1)
            ]
            if name is None:
                return FakeResult(endpoint_rows)
            return FakeResult([row for row in endpoint_rows if row["name"] == name])
        if "FROM road_node" in sql:
            return FakeResult([{"id": 1}])
        return FakeResult(
            [
                {
                    "segment_code": "S_SY_GATE_TO_MAIN",
                    "name": "入口到内部主路中心",
                    "geom_geojson": '{"type":"LineString","coordinates":[[106.3060,29.6038],[106.3068,29.6041]]}',
                    "start_node_code": "N_SY_GATE_WEST",
                    "end_node_code": "N_SY_MAIN_CENTER",
                    "length_m": 92,
                    "slope_percent": 1.2,
                    "surface_type": "ASPHALT",
                    "surface_level": 4,
                    "safety_level": 3,
                    "barrier_free_level": 4,
                    "rest_facility_score": 3,
                    "crossing_safety_level": 3,
                    "lighting_level": 4,
                    "width_m": 3.2,
                    "wheelchair_accessible": True,
                    "has_ramp": False,
                    "has_handrail": False,
                    "shade_coverage_percent": 80,
                    "bench_count": 0,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_SY_MAIN_TO_LOTUS",
                    "name": "内部主路到荷塘观景入口",
                    "geom_geojson": '{"type":"LineString","coordinates":[[106.3068,29.6041],[106.3084,29.6041]]}',
                    "start_node_code": "N_SY_MAIN_CENTER",
                    "end_node_code": "N_SY_LOTUS_ENTRY",
                    "length_m": 154,
                    "slope_percent": 1.4,
                    "surface_type": "ASPHALT",
                    "surface_level": 4,
                    "safety_level": 3,
                    "barrier_free_level": 4,
                    "rest_facility_score": 4,
                    "crossing_safety_level": 3,
                    "lighting_level": 4,
                    "width_m": 3.0,
                    "wheelchair_accessible": True,
                    "has_ramp": False,
                    "has_handrail": False,
                    "shade_coverage_percent": 85,
                    "bench_count": 1,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_SY_MAIN_TO_BUILDING_A",
                    "name": "内部主路到楼栋组团A",
                    "geom_geojson": '{"type":"LineString","coordinates":[[106.3068,29.6041],[106.3074,29.6045]]}',
                    "start_node_code": "N_SY_MAIN_CENTER",
                    "end_node_code": "N_SY_BUILDING_A",
                    "length_m": 78,
                    "slope_percent": 1.6,
                    "surface_type": "ASPHALT",
                    "surface_level": 4,
                    "safety_level": 3,
                    "barrier_free_level": 4,
                    "rest_facility_score": 3,
                    "crossing_safety_level": 3,
                    "lighting_level": 4,
                    "width_m": 2.8,
                    "wheelchair_accessible": True,
                    "has_ramp": False,
                    "has_handrail": False,
                    "shade_coverage_percent": 75,
                    "bench_count": 0,
                    "step_count": 0,
                },
                {
                    "segment_code": "S_SY_STAIR_SHORTCUT",
                    "name": "内部主路到亭廊台阶捷径",
                    "geom_geojson": '{"type":"LineString","coordinates":[[106.3068,29.6041],[106.3086,29.60315]]}',
                    "start_node_code": "N_SY_MAIN_CENTER",
                    "end_node_code": "N_SY_GARDEN_REST",
                    "length_m": 168,
                    "slope_percent": 3.2,
                    "surface_type": "BRICK",
                    "surface_level": 3,
                    "safety_level": 3,
                    "barrier_free_level": 1,
                    "rest_facility_score": 4,
                    "width_m": 1.0,
                    "wheelchair_accessible": False,
                    "has_ramp": False,
                    "has_handrail": False,
                    "shade_coverage_percent": 85,
                    "bench_count": 1,
                    "step_count": 3,
                    "crossing_safety_level": 3,
                    "lighting_level": 3,
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
            "start_name": GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["routes"]) == 1
    assert data["routes"][0]["rank"] == 1
    assert data["routes"][0]["segments"][0]["segment_code"] == "S_SY_GATE_TO_MAIN"
    assert data["routes"][0]["segments"][0]["geometry_coordinates"]
    assert data["routes"][0]["segments"][0]["benefit_tags"]
    assert data["routes"][0]["segments"][0]["explanation"]
    assert "avoided_segments" in data
    assert data["strategy"] == "BALANCED"
    assert data["strategy_label"] == "综合推荐"


def test_recommend_route_api_returns_strategy_metadata() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "ASSISTED",
            "strategy": "SAFEST",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["strategy"] == "SAFEST"
    assert data["strategy_label"] == "最安全"
    assert "安全" in data["strategy_description"]
    assert data["routes"]


def test_list_route_endpoints_returns_all_linked_pois() -> None:
    response = client.get("/api/routes/endpoints")
    assert response.status_code == 200
    data = response.json()
    assert [item["name"] for item in data] == [GATE_NAME, LOTUS_NAME, BUILDING_A_NAME]
    assert all(item["linked_node_code"] for item in data)


def test_recommend_route_api_rejects_unknown_strategy() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "ASSISTED",
            "strategy": "UNKNOWN",
        },
    )
    assert response.status_code == 422


def test_recommend_route_api_returns_avoided_segment_reasons() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "WHEELCHAIR",
        },
    )
    assert response.status_code == 200
    data = response.json()
    avoided = data["avoided_segments"]
    assert avoided[0]["segment_code"] == "S_SY_STAIR_SHORTCUT"
    assert avoided[0]["avoidance_level"] == "BLOCKED"
    assert "台阶" in "，".join(avoided[0]["reasons"])
    assert "路宽" in "，".join(avoided[0]["reasons"])


def test_recommend_route_api_can_route_to_building_group() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_NAME,
            "end_name": BUILDING_A_NAME,
            "mobility_type": "WHEELCHAIR",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["routes"][0]["segment_codes"] == ["S_SY_GATE_TO_MAIN", "S_SY_MAIN_TO_BUILDING_A"]


def test_recommend_route_api_can_use_non_gate_as_start() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": LOTUS_NAME,
            "end_name": BUILDING_A_NAME,
            "mobility_type": "WHEELCHAIR",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["routes"][0]["segment_codes"] == ["S_SY_MAIN_TO_LOTUS", "S_SY_MAIN_TO_BUILDING_A"]


def test_recommend_route_api_rejects_unknown_poi() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": UNKNOWN_GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "ASSISTED",
        },
    )
    assert response.status_code == 404


def test_recommend_route_api_rejects_other_pilot_area() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "start_name": GATE_NAME,
            "end_name": LOTUS_NAME,
            "mobility_type": "ASSISTED",
            "area_code": "OTHER",
        },
    )
    assert response.status_code == 422
