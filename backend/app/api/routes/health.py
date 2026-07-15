from fastapi import APIRouter

from app.core.config import get_settings
from app.schemas.health import HealthResponse


router = APIRouter()


@router.get("", response_model=HealthResponse)
def health_check() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        app_name=settings.app_name,
        app_env=settings.app_env,
    )
