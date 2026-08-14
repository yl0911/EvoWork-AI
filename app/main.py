"""EvoWork AI 应用入口。"""

from __future__ import annotations

import os
os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ.setdefault("PYTHONUTF8", "1")

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
from app.migrations.migrate_phase5 import migrate as run_phase5_migration
from app.migrations.migrate_phase6 import migrate as run_phase6_migration
from app.migrations.migrate_phase7 import migrate as run_phase7_migration
from app.migrations.runner import run_migrations
from app.services.bootstrap import seed_demo_data
from app.services.indexing import reindex_all
from app.services.search import get_search_service
from app.services.system_skills import seed_system_skills


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 迁移（带追踪，跳过已应用的 phase）──
    _migrations = {
        "phase2": run_phase2_migration,
        "phase3": run_phase3_migration,
        "phase4": run_phase4_migration,
        "phase5": run_phase5_migration,
        "phase6": run_phase6_migration,
        "phase7": run_phase7_migration,
    }
    applied = run_migrations(settings.database_url, _migrations)
    if applied:
        print(f"[Migration] Applied: {', '.join(applied)}")
    else:
        print("[Migration] All phases up to date, skipped.")

    db_gw = get_db_gateway()
    db_gw.init_db()

    # 初始化 FTS5 全文搜索表（幂等，极快）
    get_search_service().ensure_tables()

    with db_gw.get_session_context() as db:
        seed_demo_data(db)
        seed_system_skills(db)

        # ── 向量索引：仅在向量库为空时全量重建 ──
        vec_gw = get_vector_gateway()
        if vec_gw.configured:
            health = vec_gw.health_check()
            existing_events = health.get("events_indexed", 0)
            existing_skills = health.get("skills_indexed", 0)
            if existing_events == 0 and existing_skills == 0:
                from sqlalchemy import select
                from app.models import Skill, WorkEvent
                events = list(db.execute(select(WorkEvent)).scalars())
                skills = list(db.execute(select(Skill)).scalars())
                result = reindex_all(events, skills)
                print(f"[Index] Full reindex: Vector {result.get('events', 0)} events, "
                      f"{result.get('skills', 0)} skills | "
                      f"FTS5 {result.get('fts_events', 0)} events, "
                      f"{result.get('fts_skills', 0)} skills")
            else:
                print(f"[Index] Vector already has {existing_events} events, "
                      f"{existing_skills} skills — skip full reindex.")
        else:
            print("[Index] Vector store not configured, skipping.")

    # ── 定时分析调度器 ──
    from app.services.scheduler import init_scheduler, shutdown_scheduler
    init_scheduler()

    yield

    # ── 关闭调度器 ──
    shutdown_scheduler()


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
from app.schemas.config import ConfigUpdate  # noqa: E402

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
        "collector": {
            "api_key_configured": bool(settings.collector_api_key),
            "max_batch_size": settings.collector_max_batch_size,
        },
    }


@_system_router.put("/config")
def update_config(payload: ConfigUpdate) -> dict:
    """运行时更新配置：修改内存 settings → 持久化到 .env → 清除 Gateway 缓存。"""
    from app.schemas.config import _FIELD_TO_ENV
    from app.core.dependencies import (
        get_llm_gateway as _llm_factory,
        get_db_gateway as _db_factory,
        get_vector_gateway as _vec_factory,
    )

    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return {"updated": 0, "message": "No changes"}

    # 1) 更新内存中的 settings
    for field, value in updates.items():
        if hasattr(settings, field):
            setattr(settings, field, value)

    # 2) 持久化到 .env 文件（合并更新）
    env_path = Path(__file__).resolve().parent.parent / ".env"
    existing: dict[str, str] = {}
    if env_path.is_file():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if stripped and not stripped.startswith("#") and "=" in stripped:
                key, _, val = stripped.partition("=")
                existing[key.strip()] = val.strip()

    for field, value in updates.items():
        env_key = _FIELD_TO_ENV.get(field)
        if env_key:
            existing[env_key] = str(value)

    env_content = "\n".join(f"{k}={v}" for k, v in existing.items()) + "\n"
    env_path.write_text(env_content, encoding="utf-8")

    # 3) 清除 Gateway 缓存，使下次请求用新配置重建
    _llm_factory.cache_clear()
    _db_factory.cache_clear()
    _vec_factory.cache_clear()

    return {
        "updated": len(updates),
        "fields": list(updates.keys()),
        "message": f"Updated {len(updates)} field(s), gateways will reload on next request.",
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
    # React 前端未构建 — 输出警告而非静默失败
    import warnings
    warnings.warn(
        "frontend/dist/ not found. Run 'cd frontend && npm run build' to enable the web UI.",
        stacklevel=1,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
