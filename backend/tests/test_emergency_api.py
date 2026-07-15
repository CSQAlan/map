from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app


client = TestClient(app)


class FakeScalarResult:
    def __init__(self, scalar: int | None = None) -> None:
        self._scalar = scalar

    def scalar_one_or_none(self) -> int | None:
        return self._scalar

    def scalar_one(self) -> int:
        assert self._scalar is not None
        return self._scalar


class FakeMappingResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def mappings(self) -> "FakeMappingResult":
        return self

    def one(self) -> dict[str, Any]:
        return self._rows[0]

    def __iter__(self):
        return iter(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.committed = False
        self.insert_params: dict[str, Any] | None = None
        self.user_sql = ""
        self.event_sql = ""

    def execute(self, query: Any, params: dict[str, Any] | None = None) -> Any:
        sql = str(query)
        if "INSERT INTO app_user" in sql:
            self.user_sql = sql
            return FakeScalarResult(9)
        if "INSERT INTO emergency_event" in sql:
            self.event_sql = sql
            self.insert_params = params
            return FakeMappingResult(
                [
                    {
                        "id": 42,
                        "event_type": "SOS",
                        "event_status": "OPEN",
                        "created_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
                    }
                ]
            )
        if "FROM emergency_event" in sql:
            return FakeMappingResult(
                [
                    {
                        "id": 42,
                        "event_type": "SOS",
                        "event_status": "OPEN",
                        "elder_name": "演示老人",
                        "description": "演示老人触发紧急求助",
                        "notified_contacts": '[{"name":"家属联系人"}]',
                        "location_lon": 106.3071,
                        "location_lat": 29.6038,
                        "created_at": datetime(2026, 7, 15, tzinfo=timezone.utc),
                    }
                ]
            )
        raise AssertionError(f"Unexpected SQL: {sql}")

    def commit(self) -> None:
        self.committed = True


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


def test_create_sos_event_records_open_event(fake_session: FakeSession) -> None:
    response = client.post(
        "/api/emergency/sos",
        json={
            "elder_name": "王奶奶",
            "mobility_type": "WHEELCHAIR",
            "route_summary": "轮椅可通行，坡度较缓",
            "current_step": "沿宽缓步道前进",
            "destination_name": "食堂",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["id"] == 42
    assert data["event_status"] == "OPEN"
    assert "模拟通知" in data["message"]
    assert data["notified_contacts"]
    assert fake_session.committed
    assert "ON CONFLICT (username) DO UPDATE" in fake_session.user_sql
    assert fake_session.insert_params is not None
    assert "王奶奶触发紧急求助" in fake_session.insert_params["description"]
    assert "CAST(:notified_contacts AS jsonb)" in fake_session.event_sql
    assert "location_lat" not in fake_session.insert_params


def test_create_sos_event_records_location(fake_session: FakeSession) -> None:
    response = client.post(
        "/api/emergency/sos",
        json={
            "elder_name": "王奶奶",
            "location_lat": 29.6038,
            "location_lon": 106.3071,
        },
    )

    assert response.status_code == 200
    assert fake_session.insert_params is not None
    assert fake_session.insert_params["location_lat"] == 29.6038
    assert fake_session.insert_params["location_lon"] == 106.3071
    assert "ST_SetSRID(ST_MakePoint(:location_lon, :location_lat), 4326)" in fake_session.event_sql


def test_create_sos_event_rejects_partial_location() -> None:
    response = client.post(
        "/api/emergency/sos",
        json={
            "elder_name": "王奶奶",
            "location_lat": 29.6038,
        },
    )

    assert response.status_code == 422


def test_list_emergency_events() -> None:
    response = client.get("/api/emergency/events")

    assert response.status_code == 200
    data = response.json()
    assert data[0]["id"] == 42
    assert data[0]["event_type"] == "SOS"
    assert data[0]["notified_contacts"][0]["name"] == "家属联系人"


def test_list_emergency_events_rejects_invalid_limit() -> None:
    assert client.get("/api/emergency/events", params={"limit": 0}).status_code == 422
    assert client.get("/api/emergency/events", params={"limit": 51}).status_code == 422
