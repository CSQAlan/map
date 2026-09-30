import mimetypes

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings
from app.services.photo_evidence import EVIDENCE_ROOT


settings = get_settings()
mimetypes.add_type("image/webp", ".webp")

app = FastAPI(
    title=settings.app_name,
    debug=settings.app_debug,
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_cors_origins,
    # 开发环境可保留局域网调试；生产环境请在 .env 中设为空并只列出正式来源。
    allow_origin_regex=settings.allowed_cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api_router, prefix="/api")
app.mount(
    "/media/evidence",
    StaticFiles(directory=EVIDENCE_ROOT, check_dir=False),
    name="evidence",
)


@app.get("/", tags=["root"])
def read_root() -> dict[str, str]:
    return {
        "name": settings.app_name,
        "env": settings.app_env,
        "status": "ok",
    }
