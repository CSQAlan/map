from fastapi import APIRouter

from app.api.routes.collect import router as collect_router
from app.api.routes.diagnostics import router as diagnostics_router
from app.api.routes.health import router as health_router
from app.api.routes.map_data import router as map_data_router
from app.api.routes.routes import router as routes_router


api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(map_data_router, prefix="/map-data", tags=["map-data"])
api_router.include_router(routes_router, prefix="/routes", tags=["routes"])
api_router.include_router(collect_router, prefix="/collect", tags=["collect"])
api_router.include_router(diagnostics_router, prefix="/diagnostics", tags=["diagnostics"])
