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


@router.get("/skills/{skill_id}/usage-logs")
def get_usage_logs(
    skill_id: str,
    db: Session = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """查询 Skill 使用历史及统计摘要。"""
    from sqlalchemy import func

    skill = db.get(Skill, skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill not found")

    # 分页查询使用记录
    logs_stmt = (
        select(SkillUsageLog)
        .where(SkillUsageLog.skill_id == skill_id)
        .order_by(desc(SkillUsageLog.used_at))
        .offset(offset)
        .limit(limit)
    )
    logs = list(db.execute(logs_stmt).scalars())

    # 聚合统计
    stats_stmt = select(
        func.count(SkillUsageLog.id).label("total"),
        func.sum(func.case(
            (SkillUsageLog.outcome == "effective", 1), else_=0
        )).label("effective_count"),
        func.sum(func.case(
            (SkillUsageLog.outcome == "partial", 1), else_=0
        )).label("partial_count"),
        func.sum(func.case(
            (SkillUsageLog.outcome == "ineffective", 1), else_=0
        )).label("ineffective_count"),
        func.sum(SkillUsageLog.time_saved_minutes).label("total_time_saved"),
        func.avg(SkillUsageLog.time_saved_minutes).label("avg_time_saved"),
    ).where(SkillUsageLog.skill_id == skill_id)
    stats_row = db.execute(stats_stmt).one()

    return {
        "skill_id": skill_id,
        "skill_name": skill.name,
        "total": stats_row.total or 0,
        "effective_count": stats_row.effective_count or 0,
        "partial_count": stats_row.partial_count or 0,
        "ineffective_count": stats_row.ineffective_count or 0,
        "total_time_saved": stats_row.total_time_saved or 0,
        "avg_time_saved": round(stats_row.avg_time_saved or 0, 1),
        "avg_effectiveness": skill.avg_effectiveness,
        "logs": [
            {
                "id": log.id,
                "outcome": log.outcome,
                "event_id": log.event_id,
                "time_saved_minutes": log.time_saved_minutes,
                "notes": log.notes,
                "used_at": log.used_at.isoformat() if log.used_at else None,
            }
            for log in logs
        ],
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


@router.get("/skills/recommendations")
def skill_recommendations(
    limit: int = Query(default=10, ge=1, le=20),
) -> dict:
    """基于近期事件模式推荐 Skill。"""
    from app.services.skill_engine import get_skill_engine
    engine = get_skill_engine()
    recs = engine.recommend(limit=limit)
    return {"total": len(recs), "recommendations": recs}


@router.get("/skills/{skill_id}/events")
def skill_linked_events(
    skill_id: str,
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    """查询与 Skill 关联的事件及统计。"""
    from app.services.skill_engine import get_skill_engine
    engine = get_skill_engine()
    return engine.linked_events(skill_id, limit=limit)


@router.post("/skills/backfill")
def backfill_skill_links() -> dict:
    """为历史事件回填 linked_skill_id（基于 source → system skill 映射）。"""
    from app.services.skill_engine import get_skill_engine
    engine = get_skill_engine()
    return engine.backfill_links()


@router.post("/skills/mine")
def mine_skills(
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=7, le=90),
    max_candidates: int = Query(default=5, ge=1, le=10),
    use_llm: bool = Query(default=True),
) -> dict:
    """运行 Skill 自动挖掘流水线：检测事件模式 → 生成 Skill 草稿。"""
    from app.services.skill_miner import get_skill_miner
    miner = get_skill_miner()
    candidates = miner.mine(
        db, days=days, max_candidates=max_candidates, use_llm=use_llm,
    )
    return {"total": len(candidates), "candidates": candidates}


from pydantic import BaseModel as _BM


class _MineConfirmBody(_BM):
    draft_content: str | None = None
    name: str | None = None
    category: str | None = None
    trigger: str | None = None
    content: str | None = None
    steps: list[str] | None = None
    pattern_key: str | None = None
    success_criteria: str | None = None
    failure_fallback: str | None = None
    agent_assistable: bool = False


@router.post("/skills/mine/confirm")
def confirm_mined_skill(
    body: _MineConfirmBody,
    db: Session = Depends(get_db),
) -> dict:
    """将挖掘候选项确认为正式 Skill（source=mined）。"""
    from app.services.skill_miner import get_skill_miner
    miner = get_skill_miner()
    return miner.confirm(
        db,
        draft_content=body.draft_content,
        name=body.name,
        category=body.category,
        trigger=body.trigger,
        content=body.content,
        steps=body.steps,
        pattern_key=body.pattern_key,
        success_criteria=body.success_criteria,
        failure_fallback=body.failure_fallback,
        agent_assistable=body.agent_assistable,
    )


@router.get("/skills/mine/patterns")
def mine_patterns(
    db: Session = Depends(get_db),
    days: int = Query(default=30, ge=7, le=90),
    min_count: int = Query(default=3, ge=2, le=20),
) -> dict:
    """检测反复出现的事件模式（不调用 LLM，纯算法分析）。"""
    from app.services.skill_miner import detect_patterns
    patterns = detect_patterns(db, days=days, min_count=min_count)
    return {"total": len(patterns), "patterns": [p.to_dict() for p in patterns]}
