"""Skill CRUD 路由 — 含自动向量索引 + 使用记录。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Skill, SkillUsageLog
from app.schemas.skill import SkillCreate, SkillRead, SkillUpdate, SkillUseRequest
from app.services.indexing import delete_skill_index, index_skill

router = APIRouter(tags=["skills"])


@router.get("/skills", response_model=list[SkillRead])
def list_skills(
    db: Session = Depends(get_db),
    category: str | None = None,
    system: bool | None = None,
) -> list[Skill]:
    stmt = select(Skill)
    if category:
        stmt = stmt.where(Skill.category == category)
    if system is not None:
        stmt = stmt.where(Skill.system_skill == system)
    stmt = stmt.order_by(desc(Skill.updated_at))
    return list(db.execute(stmt).scalars())


@router.post("/skills", response_model=SkillRead)
def create_skill(payload: SkillCreate, db: Session = Depends(get_db)) -> Skill:
    skill = Skill(**payload.model_dump())
    db.add(skill)
    db.commit()
    db.refresh(skill)
    # 自动索引
    index_skill(skill)
    return skill


@router.patch("/skills/{skill_id}", response_model=SkillRead)
def update_skill(
    skill_id: str,
    payload: SkillUpdate,
    db: Session = Depends(get_db),
) -> Skill:
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(skill, key, value)
    db.commit()
    db.refresh(skill)
    # 自动重新索引
    index_skill(skill)
    return skill


@router.delete("/skills/{skill_id}")
def delete_skill(skill_id: str, db: Session = Depends(get_db)) -> dict:
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")
    db.delete(skill)
    db.commit()
    # 删除向量索引
    delete_skill_index(skill_id)
    return {"deleted": skill_id}


@router.post("/skills/{skill_id}/use")
def record_skill_use(
    skill_id: str,
    payload: SkillUseRequest,
    db: Session = Depends(get_db),
) -> dict:
    """记录一次 Skill 使用，并更新 usage_count / avg_effectiveness。"""
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")

    log = SkillUsageLog(
        skill_id=skill_id,
        event_id=payload.event_id,
        outcome=payload.outcome,
        time_saved_minutes=payload.time_saved_minutes,
        notes=payload.notes,
    )
    db.add(log)

    # 更新 Skill 使用统计
    skill.usage_count += 1
    score = {"effective": 1.0, "partial": 0.5, "ineffective": 0.0}.get(payload.outcome, 0.5)
    old_avg = skill.avg_effectiveness
    n = skill.usage_count
    skill.avg_effectiveness = round((old_avg * (n - 1) + score) / n, 4)

    db.commit()
    db.refresh(log)
    return {
        "id": log.id,
        "skill_id": skill_id,
        "outcome": log.outcome,
        "usage_count": skill.usage_count,
        "avg_effectiveness": skill.avg_effectiveness,
    }


@router.patch("/skills/{skill_id}/toggle", response_model=SkillRead)
def toggle_skill(skill_id: str, db: Session = Depends(get_db)) -> Skill:
    """切换 Skill 的启用/禁用状态。"""
    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")
    skill.enabled = not skill.enabled
    db.commit()
    db.refresh(skill)
    return skill
