from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.services.survey_records import load_survey_manifest
from app.core.config import Settings
from app.services.admin_tokens import issue_admin_token, token_secret, verify_admin_token


client = TestClient(app)
KNOWN_SITE = "UC_TIANJIE"
KNOWN_RECORD = "SURVEY_TEST_RECORD"
PHOTO_ID = load_survey_manifest()["media"][0]["photo_id"]


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows

    def mappings(self) -> "FakeResult":
        return self

    def all(self) -> list[dict[str, Any]]:
        return self.rows

    def __iter__(self):
        return iter(self.rows)

    def first(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None


class FakeSession:
    is_admin = True

    def __init__(self) -> None:
        self.location_params: dict[str, Any] | None = None

    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        params = params or {}
        if "FROM survey_site ss" in sql:
            return FakeResult(
                [
                    {"site_code": KNOWN_SITE, "name": "大学城天街", "record_count": 2},
                    {"site_code": "UC_XIJIE", "name": "熙街地区", "record_count": 1},
                ]
            )
        if "SELECT site_code FROM survey_site" in sql:
            return FakeResult([{"site_code": KNOWN_SITE}] if params.get("site_code") == KNOWN_SITE else [])
        if "FROM survey_record sr" in sql:
            return FakeResult(
                [
                    {
                        "record_code": KNOWN_RECORD,
                        "site_code": KNOWN_SITE,
                        "site_name": "大学城天街",
                        "title": "台阶1",
                        "issue_tags": ["台阶"],
                        "notes": [],
                        "media_refs": [PHOTO_ID],
                        "location_source": "EXIF",
                        "review_status": "PENDING_REVIEW",
                        "location_geojson": '{"type":"Point","coordinates":[106.3123,29.6017]}',
                    },
                    {
                        "record_code": "SURVEY_UNLOCATED",
                        "site_code": KNOWN_SITE,
                        "site_name": "大学城天街",
                        "title": "人行道1",
                        "issue_tags": ["人行道"],
                        "notes": [],
                        "media_refs": [PHOTO_ID],
                        "location_source": "NONE",
                        "review_status": "PENDING_REVIEW",
                        "location_geojson": None,
                    },
                ]
            )
        if "FROM app_user" in sql:
            return FakeResult([{"id": 42}] if self.is_admin else [])
        if "UPDATE survey_record" in sql:
            self.location_params = params
            return FakeResult(
                [
                    {
                        "record_code": KNOWN_RECORD,
                        "location_source": "MANUAL",
                        "review_status": "PENDING_REVIEW",
                        "location_geojson": '{"type":"Point","coordinates":[106.31,29.60]}',
                    }
                ]
            )
        return FakeResult([])

    def commit(self) -> None:
        return None


def _override_db(session: FakeSession):
    def dependency():
        yield session

    app.dependency_overrides[get_db] = dependency


@pytest.fixture(autouse=True)
def clear_db_override():
    yield
    app.dependency_overrides.pop(get_db, None)


def test_list_survey_sites_and_records_include_null_locations() -> None:
    session = FakeSession()
    _override_db(session)

    sites = client.get("/api/survey-records/sites")
    response = client.get("/api/survey-records", params={"site_code": KNOWN_SITE})

    assert sites.status_code == 200
    assert len(sites.json()) == 2
    assert response.status_code == 200
    payload = response.json()
    assert payload["area_code"] == "UNIVERSITY_CITY_SURVEY"
    assert payload["coordinate_system"] == "GCJ02"
    assert len(payload["features"]) == 2
    assert payload["features"][0]["geometry"]["type"] == "Point"
    assert payload["features"][0]["properties"]["review_status"] == "PENDING_REVIEW"
    assert payload["features"][0]["properties"]["evidence_photos"][0]["photo_id"] == PHOTO_ID
    assert payload["features"][1]["geometry"] is None


def test_survey_records_reject_unknown_site_and_coordinate_system() -> None:
    session = FakeSession()
    _override_db(session)
    assert client.get("/api/survey-records", params={"site_code": "UNKNOWN"}).status_code == 404
    assert client.get("/api/survey-records", params={"coordinate_system": "BD09"}).status_code == 422


def test_registered_survey_webp_is_served_by_media_mount() -> None:
    response = client.get(f"/media/evidence/survey/thumb/{PHOTO_ID}.webp")
    assert response.status_code == 200
    assert response.headers["content-type"] == "image/webp"
    assert client.get("/media/evidence/survey/thumb/UNKNOWN.webp").status_code == 404


def test_survey_location_requires_active_admin_and_keeps_pending_status() -> None:
    from app.services.admin_tokens import issue_admin_token, token_secret

    session = FakeSession()
    _override_db(session)
    token = issue_admin_token(42, token_secret())
    response = client.patch(
        f"/api/survey-records/{KNOWN_RECORD}/location",
        headers={"Authorization": f"Bearer {token}"},
        json={"longitude": 106.31, "latitude": 29.60, "coordinate_system": "GCJ02"},
    )
    assert response.status_code == 200
    assert response.json()["location_source"] == "MANUAL"
    assert response.json()["review_status"] == "PENDING_REVIEW"
    assert session.location_params is not None


def test_survey_location_rejects_missing_or_invalid_admin_token() -> None:
    session = FakeSession()
    _override_db(session)
    path = f"/api/survey-records/{KNOWN_RECORD}/location"
    body = {"longitude": 106.31, "latitude": 29.60, "coordinate_system": "GCJ02"}
    assert client.patch(path, json=body).status_code == 401
    assert client.patch(path, headers={"Authorization": "Bearer tampered"}, json=body).status_code == 401


def test_survey_location_rejects_inactive_admin_and_invalid_coordinates() -> None:
    from app.services.admin_tokens import token_secret

    session = FakeSession()
    session.is_admin = False
    _override_db(session)
    token = issue_admin_token(42, token_secret())
    path = f"/api/survey-records/{KNOWN_RECORD}/location"
    headers = {"Authorization": f"Bearer {token}"}
    body = {"longitude": 106.31, "latitude": 29.60, "coordinate_system": "GCJ02"}
    assert client.patch(path, headers=headers, json=body).status_code == 403
    session.is_admin = True
    invalid = {**body, "latitude": 100}
    assert client.patch(path, headers=headers, json=invalid).status_code == 422


def test_admin_token_expires_and_rejects_tampering() -> None:
    token = issue_admin_token(42, "test-secret", now=100)
    assert verify_admin_token(token, "test-secret", now=101) == 42
    assert verify_admin_token(token, "test-secret", now=100 + 8 * 60 * 60) is None
    prefix, signature = token.split(".")
    tampered = f"{prefix[:-1]}{'A' if prefix[-1] != 'A' else 'B'}.{signature}"
    assert verify_admin_token(tampered, "test-secret", now=101) is None


def test_production_requires_a_long_admin_token_secret() -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException, match="at least 32 bytes"):
        token_secret(Settings(APP_ENV="production", ADMIN_TOKEN_SECRET="short"))
