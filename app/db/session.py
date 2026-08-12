"""数据库会话管理（向后兼容层）。

Base 从 app.db.orm 导入并 re-export，保持所有现有模型的导入路径不变。
实际的 engine/session 管理已迁移到 SQLAlchemyGateway。
此文件提供 session_factory() 和 init_db() 作为网关的便捷入口。
"""

from __future__ import annotations

from app.db.orm import Base
from app.gateways.db.sqlalchemy_impl import SQLAlchemyGateway

# Re-export Base for backward compatibility
__all__ = ["Base", "init_db", "get_db", "session_factory"]

_gateway = SQLAlchemyGateway()


def init_db() -> None:
    _gateway.init_db()


def get_db():
    yield from _gateway.get_session()


def session_factory():
    return _gateway.get_session_context()
