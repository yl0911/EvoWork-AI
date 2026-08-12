"""SQLAlchemy 数据库 ORM 基础。

Base 定义在此处，被所有 ORM 模型引用。
旧的 app.db.session 从此处 re-export Base 以保持向后兼容。
"""

from __future__ import annotations

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
