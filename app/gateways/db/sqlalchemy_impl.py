"""SQLAlchemy 数据库 Gateway 实现。"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.orm import Base
from app.gateways.base import BaseDBGateway


class SQLAlchemyGateway(BaseDBGateway):
    def __init__(self) -> None:
        self._database_url = settings.database_url
        self._ensure_sqlite_parent()

        connect_args = (
            {"check_same_thread": False}
            if self._database_url.startswith("sqlite")
            else {}
        )
        self.engine = create_engine(
            self._database_url, connect_args=connect_args, future=True
        )
        self._SessionFactory = sessionmaker(
            bind=self.engine, autoflush=False, autocommit=False, future=True
        )

    def _ensure_sqlite_parent(self) -> None:
        if not self._database_url.startswith("sqlite:///"):
            return
        path = self._database_url.replace("sqlite:///", "", 1)
        if path == ":memory:":
            return
        Path(path).parent.mkdir(parents=True, exist_ok=True)

    def init_db(self) -> None:
        # 导入所有模型，确保 Base.metadata 包含所有表定义
        from app.models import (  # noqa: F401
            ai_cache, analyzed_task, analysis_run, skill, work_event,
        )

        Base.metadata.create_all(bind=self.engine)

    def get_session(self):
        db = self._SessionFactory()
        try:
            yield db
        finally:
            db.close()

    def get_session_context(self):
        """获取一个可直接使用的 session（非 generator）。"""
        return self._SessionFactory()

    def health_check(self) -> dict:
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return {
                "status": "ok",
                "provider": "sqlalchemy",
                "url": self._database_url,
            }
        except Exception as exc:
            return {
                "status": "error",
                "provider": "sqlalchemy",
                "url": self._database_url,
                "detail": str(exc),
            }
