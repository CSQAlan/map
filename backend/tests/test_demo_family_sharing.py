"""Synthetic fixtures only: never connect to an existing database."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.routes import auth
from app.core.config import Settings
from app.core.database import get_db
from app.main import app


ENDPOINTS = [
    ("POST", "/api/auth/family", {"phone": "13800000000"}),
    ("POST", "/api/auth/family/bind", {"family_user_id": 2, "elder_account": "100001", "binding_code": "123456"}),
    ("GET", "/api/auth/family/2/monitor", None),
    ("POST", "/api/auth/elder/1/navigation", {"start_name": "合成起点", "end_name": "合成终点"}),
]


@pytest.mark.parametrize("environment,enabled,expected", [
    ("dev", False, False), ("test", False, False), ("dev", True, True),
    ("test", True, True), ("prod", True, False), ("production", True, False),
    ("staging", True, False), ("", True, False), ("DEV", True, False),
])
def test_explicit_environment_allowlist(environment, enabled, expected):
    settings = Settings(_env_file=None, APP_ENV=environment, ENABLE_DEMO_FAMILY_SHARING=enabled)
    assert settings.demo_family_sharing_enabled is expected


def test_default_switch_is_off(monkeypatch):
    monkeypatch.delenv("ENABLE_DEMO_FAMILY_SHARING", raising=False)
    assert not Settings(_env_file=None).enable_demo_family_sharing


def test_switch_alone_does_not_enable_implicit_development(monkeypatch):
    monkeypatch.delenv("APP_ENV", raising=False)
    assert not Settings(_env_file=None, ENABLE_DEMO_FAMILY_SHARING=True).demo_family_sharing_enabled


@pytest.mark.parametrize("environment,enabled", [("dev", False), ("test", False), ("production", True), ("unknown", True)])
@pytest.mark.parametrize("method,path,body", ENDPOINTS)
def test_closed_gate_precedes_database_dependency(monkeypatch, environment, enabled, method, path, body):
    monkeypatch.setattr(auth, "get_settings", lambda: Settings(_env_file=None, APP_ENV=environment, ENABLE_DEMO_FAMILY_SHARING=enabled))
    def forbidden_db():
        pytest.fail("Database dependency must not be entered when sharing is disabled")
        yield
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = forbidden_db
    try:
        response = TestClient(app).request(method, path, **({"json": body} if body else {}))
        assert response.status_code == 403
        assert "手机号不构成可信身份认证" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


class DemoDatabase:
    def __init__(self):
        self.bound = False
        self.profile = {"family_binding_code": "123456"}
        self.commits = 0

    def execute(self, query, params=None):
        sql = str(query)
        elder = {"id": 1, "username": "100001", "display_name": "合成老人", "route_weight_profile": self.profile}
        rows = []
        if "username = :phone" in sql:
            rows = [{"id": 2, "username": "13800000000", "display_name": "合成家属", "role": "FAMILY", "status": "ACTIVE"}]
        elif "WHERE au.username = :account" in sql:
            rows = [elder]
        elif "INSERT INTO family_binding" in sql:
            self.bound = True
        elif "FROM family_binding fb" in sql:
            rows = [elder] if self.bound else []
        elif "SELECT route_weight_profile" in sql:
            rows = [{"route_weight_profile": self.profile}]
        elif "UPDATE elder_profile" in sql:
            import json
            self.profile = json.loads(params["data"])
        return SimpleNamespace(mappings=lambda: SimpleNamespace(first=lambda: rows[0] if rows else None, all=lambda: rows, one=lambda: rows[0]))

    def commit(self):
        self.commits += 1


@pytest.mark.parametrize("environment", ["dev", "test"])
def test_explicit_demo_login_bind_publish_monitor_without_tokens(monkeypatch, environment):
    monkeypatch.setattr(auth, "get_settings", lambda: Settings(_env_file=None, APP_ENV=environment, ENABLE_DEMO_FAMILY_SHARING=True))
    db = DemoDatabase()
    previous = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = lambda: db
    try:
        client = TestClient(app)
        login = client.post("/api/auth/family", json=ENDPOINTS[0][2])
        assert login.status_code == 200
        assert "access_token" not in login.json()
        assert "token_type" not in login.json()
        assert client.post("/api/auth/family/bind", json={**ENDPOINTS[1][2], "binding_code": "000000"}).status_code == 400
        assert db.commits == 0
        assert client.post("/api/auth/family/bind", json=ENDPOINTS[1][2]).status_code == 200
        assert client.post("/api/auth/elder/1/navigation", json={**ENDPOINTS[3][2], "snapshot_revision": 1}).status_code == 200
        monitor = client.get("/api/auth/family/2/monitor")
        assert monitor.status_code == 200
        assert monitor.json()["navigation"]["start_name"] == "合成起点"
        assert db.commits == 2
        assert client.get("/").status_code == 200
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)
