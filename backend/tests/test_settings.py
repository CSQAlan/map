import re
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.core.config import Settings


def cors_client(settings: Settings) -> TestClient:
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_cors_origins,
        allow_origin_regex=settings.allowed_cors_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return TestClient(app)


def test_settings_splits_cors_origins() -> None:
    settings = Settings(CORS_ORIGINS="https://app.example.com, https://admin.example.com ,, ")

    assert settings.allowed_cors_origins == [
        "https://app.example.com",
        "https://admin.example.com",
    ]


def test_development_allows_capacitor_localhost_origin() -> None:
    settings = Settings(APP_ENV="dev")

    assert "https://localhost" in settings.allowed_cors_origins


def test_development_env_example_allows_capacitor_localhost_origin() -> None:
    example_path = Path(__file__).resolve().parents[1] / ".env.example"
    values = dict(
        line.split("=", 1)
        for line in example_path.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    )
    settings = Settings(
        APP_ENV="dev",
        CORS_ORIGINS=values["CORS_ORIGINS"],
        CORS_ALLOW_ORIGIN_REGEX=values["CORS_ALLOW_ORIGIN_REGEX"],
    )

    assert "https://localhost" in settings.allowed_cors_origins
    assert re.fullmatch(settings.allowed_cors_origin_regex, "https://localhost")


def test_production_requires_explicit_cors_origins() -> None:
    settings = Settings(APP_ENV="prod")

    assert settings.allowed_cors_origins == []
    assert settings.allowed_cors_origin_regex is None


def test_production_allows_capacitor_localhost_origin() -> None:
    settings = Settings(APP_ENV="production", CORS_ORIGINS="https://localhost")

    assert settings.allowed_cors_origins == ["https://localhost"]
    assert settings.allowed_cors_origin_regex is None


def test_production_cors_allows_capacitor_origin_and_rejects_unknown_origin() -> None:
    client = cors_client(Settings(APP_ENV="prod", CORS_ORIGINS="https://localhost"))
    preflight_headers = {
        "Access-Control-Request-Method": "GET",
        "Origin": "https://localhost",
    }

    allowed = client.options("/", headers=preflight_headers)
    rejected = client.options(
        "/",
        headers={**preflight_headers, "Origin": "https://untrusted.example.com"},
    )

    assert allowed.headers["access-control-allow-origin"] == "https://localhost"
    assert "access-control-allow-origin" not in rejected.headers
