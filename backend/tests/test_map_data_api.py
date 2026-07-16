from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)

GATE_NAME = "师大苑大学城西路入口"
LOTUS_NAME = "师大苑荷塘水景休息区"
COMMERCIAL_NAME = "师大苑外部商业街人行道"


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows


class FakeSession:
    def execute(self, query: Any) -> FakeResult:
        sql = str(query)
        if "ST_AsGeoJSON(geom) AS geom_geojson" in sql and "FROM poi_facility" in sql:
            return FakeResult(
                [
                    {
                        "id": 1,
                        "name": GATE_NAME,
                        "poi_type": "ENTRANCE",
                        "is_accessible": True,
                        "geom_geojson": '{"type":"Point","coordinates":[106.3060,29.6038]}',
                    }
                ]
            )
        if "ST_AsGeoJSON(geom) AS geom_geojson" in sql and "FROM road_segment" in sql:
            return FakeResult(
                [
                    {
                        "id": 1,
                        "segment_code": "S_SY_GATE_TO_MAIN",
                        "name": "入口到内部主路中心",
                        "slope_percent": 1.5,
                        "wheelchair_accessible": True,
                        "step_count": 0,
                        "geom_geojson": '{"type":"LineString","coordinates":[[106.3060,29.6038],[106.3068,29.6041]]}',
                    }
                ]
            )
        if "FROM poi_facility" in sql:
            return FakeResult(
                [
                    {"id": 1, "name": GATE_NAME, "poi_type": "ENTRANCE", "is_accessible": True},
                    {"id": 2, "name": LOTUS_NAME, "poi_type": "REST_AREA", "is_accessible": True},
                    {"id": 3, "name": COMMERCIAL_NAME, "poi_type": "SERVICE_ACCESS", "is_accessible": True},
                ]
            )
        return FakeResult(
            [
                {
                    "id": 1,
                    "segment_code": "S_SY_GATE_TO_MAIN",
                    "name": "入口到内部主路中心",
                    "length_m": 65.0,
                    "slope_percent": 1.5,
                    "surface_type": "CONCRETE",
                    "width_m": 1.6,
                    "surface_level": 5,
                    "safety_level": 4,
                    "barrier_free_level": 5,
                    "wheelchair_accessible": True,
                    "has_handrail": False,
                    "has_ramp": True,
                    "shade_coverage_percent": 30,
                    "bench_count": 0,
                    "step_count": 0,
                },
                {
                    "id": 2,
                    "segment_code": "S_SY_MAIN_TO_LOTUS",
                    "name": "内部主路到荷塘观景入口",
                    "length_m": 58.0,
                    "slope_percent": 2.2,
                    "surface_type": "CONCRETE",
                    "width_m": 1.4,
                    "surface_level": 4,
                    "safety_level": 4,
                    "barrier_free_level": 4,
                    "wheelchair_accessible": True,
                    "has_handrail": True,
                    "has_ramp": False,
                    "shade_coverage_percent": 45,
                    "bench_count": 1,
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


def test_get_map_pois() -> None:
    response = client.get("/api/map-data/pois")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_get_map_segments() -> None:
    response = client.get("/api/map-data/segments")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_map_api_returns_seeded_names() -> None:
    response = client.get("/api/map-data/pois")
    assert response.status_code == 200
    names = {row["name"] for row in response.json()}
    assert GATE_NAME in names
    assert LOTUS_NAME in names
    assert COMMERCIAL_NAME in names


def test_get_map_geojson() -> None:
    response = client.get("/api/map-data/geojson")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 2
    assert {feature["properties"]["kind"] for feature in data["features"]} == {"poi", "segment"}
