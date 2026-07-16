from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


class FakeResult:
    def __init__(self, row: dict[str, Any] | None) -> None:
        self._row = row

    def first(self) -> dict[str, Any] | None:
        return self._row

    def mappings(self) -> "FakeResult":
        return self


class FakeSession:
    def execute(self, query: Any, params: dict[str, Any]) -> FakeResult:
        if params["area_code"] != "SHIDAYUAN":
            return FakeResult(None)
        return FakeResult(
            {
                "area_code": "SHIDAYUAN",
                "name": "师大苑",
                "boundary_geojson": '{"type":"Polygon","coordinates":[[[106.307,29.6035],[106.3102,29.6035],[106.3102,29.6052],[106.307,29.6052],[106.307,29.6035]]]}',
                "center_geojson": '{"type":"Point","coordinates":[106.3086,29.60435]}',
                "min_zoom": 16,
                "max_zoom": 20,
            }
        )


def override_get_db() -> Any:
    yield FakeSession()


@pytest.fixture(autouse=True)
def db_override() -> Any:
    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


client = TestClient(app)


def test_get_shidayuan_pilot_area_in_gcj02() -> None:
    response = client.get("/api/pilot-areas/SHIDAYUAN?coordinate_system=GCJ02")
    assert response.status_code == 200
    payload = response.json()
    assert payload["area_code"] == "SHIDAYUAN"
    assert payload["coordinate_system"] == "GCJ02"
    assert payload["min_zoom"] == 16
    assert payload["limit_bounds"]["south_west"][0] < payload["limit_bounds"]["north_east"][0]


def test_pilot_area_can_return_canonical_wgs84() -> None:
    response = client.get("/api/pilot-areas/SHIDAYUAN?coordinate_system=WGS84")
    assert response.status_code == 200
    assert response.json()["center"] == [106.3086, 29.60435]


def test_pilot_area_returns_404_for_unknown_area() -> None:
    response = client.get("/api/pilot-areas/UNKNOWN")
    assert response.status_code == 404


def test_pilot_area_rejects_unknown_coordinate_system() -> None:
    response = client.get("/api/pilot-areas/SHIDAYUAN?coordinate_system=BD09")
    assert response.status_code == 422
