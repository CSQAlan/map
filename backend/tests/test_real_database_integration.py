import os

import pytest
from fastapi.testclient import TestClient

from app.main import app


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_POSTGIS_INTEGRATION") != "1",
    reason="Set RUN_POSTGIS_INTEGRATION=1 with the project PostGIS container running.",
)

client = TestClient(app)


def test_real_map_data_is_scoped_and_has_evidence() -> None:
    response = client.get(
        "/api/map-data/geojson",
        params={"area_code": "SHIDAYUAN", "coordinate_system": "GCJ02"},
    )
    assert response.status_code == 200
    payload = response.json()
    segments = [item for item in payload["features"] if item["properties"]["kind"] == "segment"]
    pois = [item for item in payload["features"] if item["properties"]["kind"] == "poi"]
    assert len(segments) == 17
    assert len(pois) == 6
    assert sum(len(item["properties"]["evidence_photos"]) for item in payload["features"]) >= 40


def test_real_map_data_rejects_unknown_area() -> None:
    assert client.get("/api/map-data/geojson?area_code=UNKNOWN").status_code == 404


def test_real_wheelchair_route_is_shidayuan_scoped() -> None:
    response = client.get(
        "/api/routes/recommend",
        params={
            "area_code": "SHIDAYUAN",
            "start_name": "师大苑大学城西路入口",
            "end_name": "师大苑荷塘水景休息区",
            "mobility_type": "WHEELCHAIR",
            "strategy": "BALANCED",
        },
    )
    assert response.status_code == 200
    routes = response.json()["routes"]
    assert len(routes) == 3
    assert routes[0]["segment_codes"] == ["S_SY_GATE_TO_MAIN", "S_SY_MAIN_TO_LOTUS"]
