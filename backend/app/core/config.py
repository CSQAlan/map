from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_DEVELOPMENT_CORS_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,https://localhost"


class Settings(BaseSettings):
    app_name: str = Field(default="助老地图后端", alias="APP_NAME")
    app_env: str = Field(default="dev", alias="APP_ENV")
    app_host: str = Field(default="0.0.0.0", alias="APP_HOST")
    app_port: int = Field(default=8000, alias="APP_PORT")
    app_debug: bool = Field(default=True, alias="APP_DEBUG")
    database_url: str = Field(
        default="postgresql+psycopg://postgres:postgres@127.0.0.1:5432/elder_map",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://127.0.0.1:6379/0", alias="REDIS_URL")
    admin_token_secret: str = Field(default="", alias="ADMIN_TOKEN_SECRET")
    admin_token_secret: str = Field(default="", alias="ADMIN_TOKEN_SECRET")
    cors_origins: str = Field(
        default=DEFAULT_DEVELOPMENT_CORS_ORIGINS,
        alias="CORS_ORIGINS",
    )
    cors_allow_origin_regex: str | None = Field(
        default=r"http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):\d+",
        alias="CORS_ALLOW_ORIGIN_REGEX",
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    @property
    def allowed_cors_origins(self) -> list[str]:
        if self.is_production and self.cors_origins == DEFAULT_DEVELOPMENT_CORS_ORIGINS:
            return []
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def allowed_cors_origin_regex(self) -> str | None:
        return None if self.is_production else self.cors_allow_origin_regex

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() in {"prod", "production"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
