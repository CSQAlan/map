from fastapi import APIRouter

from app.api.routes.collect import router as collect_router
from app.api.routes.auth import router as auth_router
from app.api.routes.diagnostics import router as diagnostics_router
from app.api.routes.emergency import router as emergency_router
from app.api.routes.health import router as health_router
from app.api.routes.map_data import router as map_data_router
from app.api.routes.pilot_areas import router as pilot_areas_router
from app.api.routes.routes import router as routes_router


api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(map_data_router, prefix="/map-data", tags=["map-data"])
api_router.include_router(pilot_areas_router, prefix="/pilot-areas", tags=["pilot-areas"])
api_router.include_router(routes_router, prefix="/routes", tags=["routes"])
api_router.include_router(collect_router, prefix="/collect", tags=["collect"])
api_router.include_router(diagnostics_router, prefix="/diagnostics", tags=["diagnostics"])
api_router.include_router(emergency_router, prefix="/emergency", tags=["emergency"])
