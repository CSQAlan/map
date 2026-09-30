from collections.abc import Generator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes import auth as auth_routes
from app.core.config import Settings
from app.core.database import get_db
from app.main import app
from app.services import admin_tokens
from app.services.admin_tokens import issue_admin_token


class FakeResult:
    def __init__(self, rows: list[dict[str, Any]] | None = None) -> None:
        self.rows = rows or []

    def mappings(self) -> "FakeResult":
        return self

    def first(self) -> dict[str, Any] | None:
        return self.rows[0] if self.rows else None

    def all(self) -> list[dict[str, Any]]:
        return self.rows

    def one(self) -> dict[str, Any]:
        return self.rows[0]


class FakeSession:
    def __init__(self) -> None:
        self.inserted_admin = False
        self.admin_row: dict[str, Any] | None = None

    def execute(self, query: Any, params: dict[str, Any] | None = None) -> FakeResult:
        sql = str(query)
        if "INSERT INTO app_user" in sql:
            self.inserted_admin = True
            return FakeResult()
        if "SELECT id FROM app_user WHERE id" in sql:
            return FakeResult([{"id": 42}])
        if "UPDATE app_user SET status" in sql:
            return FakeResult(
                [{"id": 43, "username": "target", "display_name": "Target", "role": "ELDER", "phone": None, "status": params["status"]}]
            )
        if "SELECT * FROM app_user WHERE username" in sql:
            return FakeResult([self.admin_row] if self.admin_row else [])
        if "SELECT id, username, display_name, role, phone, status FROM app_user" in sql:
            return FakeResult([])
        return FakeResult()

    def commit(self) -> None:
        pass


@pytest.fixture
def fake_session(monkeypatch: pytest.MonkeyPatch) -> Generator[FakeSession, None, None]:
    session = FakeSession()

    def override_get_db() -> Generator[FakeSession, None, None]:
        yield session

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(
        admin_tokens,
        "get_settings",
        lambda: Settings(APP_ENV="dev", ADMIN_TOKEN_SECRET="test-secret"),
    )
    yield session
    app.dependency_overrides.pop(get_db, None)


def test_admin_user_management_requires_admin_and_never_returns_a_token(
    fake_session: FakeSession,
) -> None:
    client = TestClient(app)
    assert client.get("/api/auth/admin/users").status_code == 401
    assert client.patch(
        "/api/auth/admin/users/43/status", json={"status": "ACTIVE"}
    ).status_code == 401

    token = issue_admin_token(42, "test-secret")
    headers = {"Authorization": f"Bearer {token}"}
    response = client.patch(
        "/api/auth/admin/users/43/status",
        json={"status": "ACTIVE"},
        headers=headers,
    )
    assert response.status_code == 200
    assert "access_token" not in response.json()
    assert client.get("/api/auth/admin/users", headers=headers).status_code == 200


def test_admin_cannot_disable_own_account(fake_session: FakeSession) -> None:
    client = TestClient(app)
    token = issue_admin_token(42, "test-secret")
    response = client.patch(
        "/api/auth/admin/users/42/status",
        json={"status": "INACTIVE"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400


def test_production_does_not_create_known_default_admin(
    fake_session: FakeSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routes.auth import password_hash

    monkeypatch.setattr(
        auth_routes, "get_settings", lambda: Settings(APP_ENV="prod")
    )
    fake_session.admin_row = {
        "id": 42,
        "username": "admin",
        "password_hash": password_hash("admin123"),
        "role": "ADMIN",
        "display_name": "System Admin",
        "phone": None,
        "status": "ACTIVE",
    }
    response = TestClient(app).post(
        "/api/auth/admin/login", json={"username": "admin", "password": "admin123"}
    )
    assert response.status_code == 401
    assert fake_session.inserted_admin is False
