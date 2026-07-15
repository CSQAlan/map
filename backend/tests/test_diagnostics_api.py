from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows


class FakeSession:
    def execute(self, query: Any) -> FakeResult:
        return FakeResult(
            [
                {
                    "segment_code": "S_STAIR",
                    "name": "\u98df\u5802\u5165\u53e3\u53f0\u9636",
                    "slope_percent": 2,
                    "surface_type": "CONCRETE",
                    "width_m": 1.5,
                    "surface_level": 5,
                    "safety_level": 5,
                    "barrier_free_level": 2,
                    "rest_facility_score": 4,
                    "wheelchair_accessible": False,
                    "has_handrail": False,
                    "has_ramp": False,
                    "shade_coverage_percent": 40,
                    "bench_count": 1,
                    "step_count": 2,
                },
                {
                    "segment_code": "S_GOOD",
                    "name": "\u5bbd\u7f13\u6b65\u9053",
                    "slope_percent": 1,
                    "surface_type": "CONCRETE",
                    "width_m": 1.6,
                    "surface_level": 5,
                    "safety_level": 5,
                    "barrier_free_level": 5,
                    "rest_facility_score": 4,
                    "wheelchair_accessible": True,
                    "has_handrail": True,
                    "has_ramp": True,
                    "shade_coverage_percent": 40,
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


def test_segment_diagnostics_api_returns_suggestions() -> None:
    response = client.get("/api/diagnostics/segments")

    assert response.status_code == 200
    data = response.json()
    assert data["total_segments"] == 2
    assert data["suggestions"][0]["segment_code"] == "S_STAIR"
    assert data["suggestions"][0]["priority"] == "HIGH"
    assert any(item["issue_type"] == "MISSING_RAMP" for item in data["suggestions"])


def test_segment_diagnostics_api_respects_limit() -> None:
    response = client.get("/api/diagnostics/segments", params={"limit": 1})

    assert response.status_code == 200
    data = response.json()
    assert len(data["suggestions"]) == 1


def test_segment_diagnostics_api_rejects_invalid_limit() -> None:
    assert client.get("/api/diagnostics/segments", params={"limit": 0}).status_code == 422
    assert client.get("/api/diagnostics/segments", params={"limit": -1}).status_code == 422
    assert client.get("/api/diagnostics/segments", params={"limit": 51}).status_code == 422
