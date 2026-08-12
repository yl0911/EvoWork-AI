"""EvoWork AI 应用入口。"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
import sys

if __name__ == "__main__" and __package__ is None:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.dependencies import get_db_gateway, get_llm_gateway, get_vector_gateway
from app.modules.ai.router import router as ai_router
from app.modules.analytics.router import router as analytics_router
from app.modules.events.router import router as events_router
from app.modules.insights.router import router as insights_router
from app.modules.search.router import router as search_router
from app.modules.skills.router import router as skills_router
from app.modules.collectors.router import router as collectors_router
from app.migrations.migrate_phase2 import migrate as run_phase2_migration
from app.migrations.migrate_phase3 import migrate as run_phase3_migration
from app.migrations.migrate_phase4 import migrate as run_phase4_migration
from app.services.bootstrap import seed_demo_data
from app.services.indexing import reindex_all


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 运行数据库迁移（为旧表添加新列/新表）
    run_phase2_migration(settings.database_url)
    run_phase3_migration(settings.database_url)
    run_phase4_migration(settings.database_url)
    db_gw = get_db_gateway()
    db_gw.init_db()
    with db_gw.get_session_context() as db:
        seed_demo_data(db)
        # 启动时重建向量索引（确保现有数据可被搜索）
        from sqlalchemy import select
        from app.models import Skill, WorkEvent
        events = list(db.execute(select(WorkEvent)).scalars())
        skills = list(db.execute(select(Skill)).scalars())
        result = reindex_all(events, skills)
        if result.get("status") == "ok":
            print(f"[Vector] Reindexed: {result['events']} events, {result['skills']} skills")
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# 模块路由
app.include_router(events_router, prefix="/api")
app.include_router(skills_router, prefix="/api")
app.include_router(insights_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(analytics_router, prefix="/api")
app.include_router(collectors_router, prefix="/api")


# ── 系统端点 ─────────────────────────────────────────

from datetime import datetime, timezone  # noqa: E402

from fastapi import APIRouter  # noqa: E402

_system_router = APIRouter(prefix="/api", tags=["system"])


@_system_router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": settings.app_name,
        "env": settings.app_env,
        "time": datetime.now(timezone.utc).isoformat(),
    }


@_system_router.get("/config")
def runtime_config() -> dict:
    return {
        "database": {
            "url": settings.database_url,
            "configured": bool(settings.database_url),
        },
        "llm": {
            "provider": settings.llm_provider,
            "base_url": settings.llm_base_url,
            "model": settings.llm_model,
            "api_key_configured": bool(settings.llm_api_key),
        },
        "vector": {
            "store": settings.vector_store,
            "path": settings.vector_store_path,
            "url": settings.vector_store_url,
            "configured": bool(settings.vector_store_path or settings.vector_store_url),
        },
        "storage": {
            "type": settings.storage_type,
            "path": settings.storage_path,
        },
    }


@_system_router.get("/llm/health")
def llm_health() -> dict:
    gateway = get_llm_gateway()
    return {
        "configured": gateway.configured,
        "provider": gateway.provider,
        "base_url": gateway.base_url,
        "model": gateway.model,
    }


@_system_router.get("/health/db")
def db_health() -> dict:
    return get_db_gateway().health_check()


@_system_router.get("/health/vector")
def vector_health() -> dict:
    return get_vector_gateway().health_check()


app.include_router(_system_router)


# ── 静态文件（React SPA）─────────────────────────────

_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _frontend_dist.is_dir():
    # 静态资源（JS/CSS bundles）
    _assets_dir = _frontend_dist / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=_assets_dir), name="assets")

    # 根目录静态文件（favicon.svg, icons.svg 等）
    app.mount("/static", StaticFiles(directory=_frontend_dist), name="static-files")

    @app.get("/favicon.svg", include_in_schema=False)
    def favicon():
        return FileResponse(_frontend_dist / "favicon.svg")

    @app.get("/icons.svg", include_in_schema=False)
    def icons_svg():
        return FileResponse(_frontend_dist / "icons.svg")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(_frontend_dist / "index.html")

    # SPA 兜底：所有非 API 路由返回 index.html（必须放在最后）
    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        # 优先返回 dist 中实际存在的文件
        file_path = _frontend_dist / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_frontend_dist / "index.html")
else:
    # 降级：旧版 app/static
    static_dir = Path(__file__).parent / "static"

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(static_dir / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
