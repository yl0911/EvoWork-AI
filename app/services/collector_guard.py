"""采集守门服务 — 基于系统 Skill 的 enabled 状态控制数据写入。

每个采集来源对应一个系统 Skill，只有当 Skill 启用时才接收数据。
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill

# 采集来源 → 系统 Skill ID 映射
SOURCE_SKILL_MAP: dict[str, str] = {
    "git": "sys_skill_git_collector",
    "shell": "sys_skill_shell_collector",
    "shell_buffer": "sys_skill_shell_collector",
    "activitywatch": "sys_skill_activitywatch_import",
    "browser": "sys_skill_browser_tracker",
    "ide": "sys_skill_ide_tracker",
    "manual": "sys_skill_manual_event",
}


def is_source_enabled(db: Session, source: str) -> bool:
    """检查某来源对应的系统 Skill 是否启用。

    如果来源没有对应的系统 Skill（不在映射表中），默认允许。
    如果系统 Skill 不存在于数据库中，也默认允许（兼容无 Skill 的环境）。
    """
    skill_id = SOURCE_SKILL_MAP.get(source)
    if skill_id is None:
        return True  # 无对应 Skill，不限制

    skill = db.execute(
        select(Skill.enabled).where(Skill.id == skill_id)
    ).scalar_one_or_none()

    if skill is None:
        return True  # Skill 不存在，不限制

    return skill


def get_all_collector_skills(db: Session) -> dict[str, dict]:
    """返回所有采集 Skill 的状态。

    Returns: {source: {"skill_id": ..., "enabled": ..., "name": ...}}
    """
    result = {}
    for source, skill_id in SOURCE_SKILL_MAP.items():
        skill = db.execute(
            select(Skill).where(Skill.id == skill_id)
        ).scalar_one_or_none()

        if skill:
            result[source] = {
                "skill_id": skill.id,
                "enabled": skill.enabled,
                "name": skill.name,
            }
        else:
            result[source] = {
                "skill_id": skill_id,
                "enabled": True,
                "name": source,
            }
    return result
