from datetime import datetime
import json
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]] | None = None, scalar: Any = None) -> None:
        self._rows = rows or []
        self._scalar = scalar

    def mappings(self) -> list[dict[str, Any]]:
        return self._rows

    def scalar_one_or_none(self) -> Any:
        if self._scalar is not None:
            return self._scalar
        return self._rows[0]["id"] if self._rows else None

    def scalar_one(self) -> Any:
        if self._scalar is not None:
            return self._scalar
        return self._rows[0]["id"]


class FakeSession:
    def __init__(self) -> None:
        self.inserted_collection = False
        self.insert_params: dict[str, Any] | None = None
        self.existing_pending_id: int | None = None
        self.audit_record_status = "PENDING"
        self.updated_road_segment = False
        self.road_update_params: dict[str, Any] | None = None
        self.updated_collect_status: str | None = None
        self.inserted_audit = False
        self.audit_params: dict[str, Any] | None = None
        self.fail_on_audit_insert = False
        self.committed = False
        self.rolled_back = False

    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        if "FROM road_segment rs" in sql and "JOIN road_node" in sql:
            return FakeResult(
                [
                    {
                        "segment_code": "S_GATE3_TO_WIDE_PATH",
                        "name": "\u4e09\u53f7\u95e8\u5230\u5bbd\u7f13\u6b65\u9053",
                        "length_m": 136.0,
                        "slope_percent": 1.2,
                        "width_m": 1.6,
                        "surface_type": "CONCRETE",
                        "start_node_code": "N_GATE3",
                        "end_node_code": "N_WIDE_PATH",
                    }
                ]
            )
        if "SELECT id FROM road_segment" in sql:
            if params and params.get("segment_code") == "S_UNKNOWN":
                return FakeResult()
            return FakeResult(scalar=1)
        if "SELECT id FROM app_user" in sql:
            return FakeResult()
        if "INSERT INTO app_user" in sql:
            return FakeResult(scalar=7)
        if "SELECT id" in sql and "FROM segment_collect_record" in sql:
            return FakeResult(scalar=self.existing_pending_id) if self.existing_pending_id is not None else FakeResult()
        if "INSERT INTO segment_collect_record" in sql:
            self.inserted_collection = True
            self.insert_params = params
            return FakeResult(scalar=42)
        if "WHERE scr.id = :record_id" in sql:
            if params and params.get("record_id") == 404:
                return FakeResult()
            return FakeResult([audit_record_row(self.audit_record_status)])
        if "UPDATE road_segment" in sql:
            self.updated_road_segment = True
            self.road_update_params = params
            return FakeResult()
        if "FROM road_segment" in sql and "WHERE id = :road_segment_id" in sql:
            return FakeResult(
                [
                    {
                        "surface_level": 5,
                        "surface_type": "CONCRETE",
                        "width_m": 1.8,
                        "safety_level": 5,
                        "barrier_free_level": 5,
                        "rest_facility_score": 4,
                        "lighting_level": 4,
                        "crossing_safety_level": 5,
                        "wheelchair_accessible": True,
                        "has_handrail": True,
                        "has_ramp": True,
                        "shade_coverage_percent": 40,
                        "bench_count": 1,
                        "step_count": 0,
                        "step_height_cm": 0.0,
                    }
                ]
            )
        if "UPDATE segment_collect_record" in sql:
            self.updated_collect_status = params["status"] if params else None
            return FakeResult()
        if "INSERT INTO segment_audit_record" in sql:
            if self.fail_on_audit_insert:
                raise RuntimeError("audit insert failed")
            self.inserted_audit = True
            self.audit_params = params
            return FakeResult(scalar=88)
        if "FROM segment_collect_record scr" in sql:
            return FakeResult(
                [
                    {
                        "id": 42,
                        "segment_code": "S_GATE3_TO_WIDE_PATH",
                        "segment_name": "\u4e09\u53f7\u95e8\u5230\u5bbd\u7f13\u6b65\u9053",
                        "collector_name": "\u91c7\u96c6\u5458A",
                        "surface_type": "CONCRETE",
                        "width_m": 1.6,
                        "surface_level": 4,
                        "safety_level": 5,
                        "barrier_free_level": 5,
                        "rest_facility_score": 4,
                        "lighting_level": 4,
                        "crossing_safety_level": 4,
                        "wheelchair_accessible": True,
                        "has_handrail": False,
                        "has_ramp": True,
                        "shade_coverage_percent": 35,
                        "bench_count": 1,
                        "step_count": 0,
                        "step_height_cm": 0.0,
                        "remark": "\u8def\u9762\u5e73\u6574",
                        "collect_time": datetime(2026, 7, 15, 10, 0, 0),
                        "status": "PENDING",
                    }
                ]
            )
        return FakeResult()

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True


def audit_record_row(status: str = "PENDING") -> dict[str, Any]:
    return {
        "collect_record_id": 42,
        "road_segment_id": 1,
        "segment_code": "S_GATE3_TO_WIDE_PATH",
        "segment_name": "\u4e09\u53f7\u95e8\u5230\u5bbd\u7f13\u6b65\u9053",
        "collect_status": status,
        "collected_surface_level": 5,
        "collected_surface_type": "CONCRETE",
        "collected_width_m": 1.8,
        "collected_safety_level": 5,
        "collected_barrier_free_level": 5,
        "collected_rest_facility_score": 4,
        "collected_lighting_level": 4,
        "collected_crossing_safety_level": 5,
        "collected_wheelchair_accessible": True,
        "collected_has_handrail": True,
        "collected_has_ramp": True,
        "collected_shade_coverage_percent": 40,
        "collected_bench_count": 1,
        "collected_step_count": 0,
        "collected_step_height_cm": 0.0,
        "road_surface_level": 3,
        "road_surface_type": "CONCRETE",
        "road_width_m": 1.4,
        "road_safety_level": 4,
        "road_barrier_free_level": 4,
        "road_rest_facility_score": 3,
        "road_lighting_level": 3,
        "road_crossing_safety_level": 4,
        "road_wheelchair_accessible": True,
        "road_has_handrail": False,
        "road_has_ramp": False,
        "road_shade_coverage_percent": 20,
        "road_bench_count": 0,
        "road_step_count": 0,
        "road_step_height_cm": 0.0,
    }


@pytest.fixture
def fake_session() -> FakeSession:
    return FakeSession()


@pytest.fixture(autouse=True)
def db_override(fake_session: FakeSession) -> Any:
    def override_get_db() -> Any:
        yield fake_session

    app.dependency_overrides[get_db] = override_get_db
    yield
    app.dependency_overrides.pop(get_db, None)


def valid_payload() -> dict[str, Any]:
    return {
        "segment_code": "S_GATE3_TO_WIDE_PATH",
        "collector": "\u91c7\u96c6\u5458A",
        "surface_type": "CONCRETE",
        "surface_level": 4,
        "safety_level": 5,
        "barrier_free_level": 5,
        "rest_facility_score": 4,
        "lighting_level": 4,
        "crossing_safety_level": 4,
        "width_m": 1.6,
        "wheelchair_accessible": True,
        "has_handrail": False,
        "has_ramp": True,
        "shade_coverage_percent": 35,
        "bench_count": 1,
        "step_count": 0,
        "step_height_cm": 0,
        "location_lat": 29.6038,
        "location_lon": 106.3071,
        "photo_urls": [],
        "remark": "\u8def\u9762\u5e73\u6574",
    }


def test_collect_segments_returns_active_options() -> None:
    response = client.get("/api/collect/segments")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["segment_code"] == "S_GATE3_TO_WIDE_PATH"


def test_submit_collection_record_creates_pending_record(fake_session: FakeSession) -> None:
    response = client.post("/api/collect/segments", json=valid_payload())
    assert response.status_code == 201
    assert response.json()["id"] == 42
    assert response.json()["status"] == "PENDING"
    assert fake_session.inserted_collection is True
    assert fake_session.insert_params is not None
    assert fake_session.insert_params["surface_type"] == "CONCRETE"
    assert fake_session.insert_params["collector_user_id"] == 7
    assert fake_session.committed is True


def test_submit_collection_record_reuses_duplicate_pending_record(fake_session: FakeSession) -> None:
    fake_session.existing_pending_id = 99
    response = client.post("/api/collect/segments", json=valid_payload())
    assert response.status_code == 200
    assert response.json()["id"] == 99
    assert response.json()["status"] == "PENDING"
    assert fake_session.inserted_collection is False


def test_submit_collection_record_rejects_unknown_segment() -> None:
    payload = valid_payload()
    payload["segment_code"] = "S_UNKNOWN"
    response = client.post("/api/collect/segments", json=payload)
    assert response.status_code == 404


def test_submit_collection_record_rejects_invalid_surface_type() -> None:
    payload = valid_payload()
    payload["surface_type"] = "BAD"
    response = client.post("/api/collect/segments", json=payload)
    assert response.status_code == 422


def test_list_pending_collection_records() -> None:
    response = client.get("/api/collect/pending")
    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == 42
    assert data[0]["status"] == "PENDING"
    assert data[0]["width_m"] == 1.6


def test_approve_collection_record_updates_road_segment(fake_session: FakeSession) -> None:
    response = client.post(
        "/api/collect/segments/42/audit",
        json={"audit_result": "APPROVED", "auditor": "\u7ba1\u7406\u5458", "audit_comment": "\u901a\u8fc7"},
    )
    assert response.status_code == 200
    assert response.json()["audit_result"] == "APPROVED"
    assert fake_session.updated_road_segment is True
    assert fake_session.road_update_params is not None
    assert fake_session.road_update_params["width_m"] == 1.8
    assert fake_session.updated_collect_status == "APPROVED"
    assert fake_session.inserted_audit is True
    assert fake_session.audit_params is not None
    before_snapshot = json.loads(fake_session.audit_params["before_snapshot"])
    after_snapshot = json.loads(fake_session.audit_params["after_snapshot"])
    assert before_snapshot["width_m"] == 1.4
    assert after_snapshot["width_m"] == 1.8
    assert fake_session.audit_params["audit_result"] == "APPROVED"
    assert fake_session.committed is True


def test_reject_collection_record_does_not_update_road_segment(fake_session: FakeSession) -> None:
    response = client.post(
        "/api/collect/segments/42/audit",
        json={"audit_result": "REJECTED", "auditor": "\u7ba1\u7406\u5458", "audit_comment": "\u9700\u91cd\u65b0\u91c7\u96c6"},
    )
    assert response.status_code == 200
    assert response.json()["audit_result"] == "REJECTED"
    assert fake_session.updated_road_segment is False
    assert fake_session.updated_collect_status == "REJECTED"
    assert fake_session.inserted_audit is True
    before_snapshot = json.loads(fake_session.audit_params["before_snapshot"])
    after_snapshot = json.loads(fake_session.audit_params["after_snapshot"])
    assert before_snapshot == after_snapshot


def test_audit_collection_record_rejects_non_pending_record(fake_session: FakeSession) -> None:
    fake_session.audit_record_status = "APPROVED"
    response = client.post(
        "/api/collect/segments/42/audit",
        json={"audit_result": "APPROVED", "auditor": "\u7ba1\u7406\u5458", "audit_comment": ""},
    )
    assert response.status_code == 409
    assert fake_session.updated_road_segment is False
    assert fake_session.inserted_audit is False


def test_audit_collection_record_rolls_back_on_database_error(fake_session: FakeSession) -> None:
    fake_session.fail_on_audit_insert = True
    with pytest.raises(RuntimeError, match="audit insert failed"):
        client.post(
            "/api/collect/segments/42/audit",
            json={"audit_result": "APPROVED", "auditor": "\u7ba1\u7406\u5458", "audit_comment": ""},
        )
    assert fake_session.rolled_back is True


def test_audit_collection_record_returns_404_for_missing_record() -> None:
    response = client.post(
        "/api/collect/segments/404/audit",
        json={"audit_result": "APPROVED", "auditor": "\u7ba1\u7406\u5458", "audit_comment": ""},
    )
    assert response.status_code == 404
