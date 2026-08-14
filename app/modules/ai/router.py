"""AI 分析路由（复盘 + Skill 草稿 + 流式对话）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.gateways.base import LLMGatewayError
from app.schemas.ai import (
    ChatRequest,
    ConversationCreate,
    ConversationRead,
    MessageRead,
    MessagesSaveRequest,
    PeriodReviewRequest,
    SkillDraftRequest,
)
from app.schemas.analyzed_task import (
    AnalyzeEventsRequest,
    AnalyzedTaskRead,
    AnalyzedTaskUpdate,
    AnalysisRunRead,
    ScheduleConfigRead,
    ScheduleConfigUpdate,
)
from app.services.ai_analysis import build_chat_context, generate_period_review, generate_skill_draft
from app.services.event_analysis import (
    get_analyzed_tasks,
    get_analysis_runs,
    get_period_comparison,
    run_event_analysis,
)
from app.services.scheduler import get_schedule_config, update_schedule

router = APIRouter(tags=["ai"])


@router.post("/ai/period-review")
def ai_period_review(payload: PeriodReviewRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return generate_period_review(db, period=payload.period, refresh=payload.refresh)
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/ai/skill-draft")
def ai_skill_draft(payload: SkillDraftRequest, db: Session = Depends(get_db)) -> dict:
    try:
        return generate_skill_draft(db, period=payload.period, tag=payload.tag, refresh=payload.refresh)
    except LLMGatewayError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


CHAT_SYSTEM_BASE = """你是 EvoWork AI 的个人工作与学习进化助手。
你的目标是帮助用户复盘工作学习过程、识别认知卡点、沉淀可复用 Skill。
请避免绩效考核、监控、评价员工价值这类表达。
请用中文，语气克制、具体、可执行。
如果信息不足，请明确说信息不足，并基于现有事件给出低风险建议。

关于 EvoWork-AI 系统能力（请在回答中引导用户使用这些内置功能，而非建议手动操作）：
- Dashboard 页面的「AI Skill 草稿」功能可以自动分析工作事件，生成 2-3 个 Skill 草稿，并提供「发布为 Skill」按钮一键保存到 Skill 库。
- Dashboard 页面的「AI 复盘」功能可以生成包含趋势对比和模式识别的周期复盘报告。
- Skills 页面可以查看、编辑、追踪所有 Skill 的使用效果。
- 如果用户想要保存 Skill 草稿，请引导他们使用 Dashboard 的「AI Skill 草稿」功能，而不是建议手动复制 YAML 或手动创建。

下面是用户近期的工作数据上下文，请基于这些数据回答用户的问题：

"""


@router.post("/ai/chat")
def ai_chat(payload: ChatRequest, db: Session = Depends(get_db)):
    """流式多轮对话：SSE 格式逐 token 输出。"""
    from app.core.dependencies import get_llm_gateway

    gateway = get_llm_gateway()
    if not gateway.configured:
        raise HTTPException(status_code=502, detail="LLM is not configured.")

    # 构建带数据上下文的 system prompt
    try:
        data_context = build_chat_context(db, period=payload.period)
    except Exception:
        data_context = "（数据加载失败，请基于用户描述回答）"

    system_content = CHAT_SYSTEM_BASE + data_context

    # 组装消息列表：system + 用户多轮对话
    messages: list[dict[str, str]] = [{"role": "system", "content": system_content}]
    for msg in payload.messages:
        messages.append({"role": msg.role, "content": msg.content})

    def event_stream():
        try:
            for token in gateway.chat_stream(messages):
                # SSE 格式：data: {json}\n\n
                chunk = json.dumps({"content": token}, ensure_ascii=False)
                yield f"data: {chunk}\n\n"
            # 结束标记
            yield "data: [DONE]\n\n"
        except LLMGatewayError as exc:
            error_chunk = json.dumps({"error": str(exc)}, ensure_ascii=False)
            yield f"data: {error_chunk}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
        },
    )


# ── Conversation Persistence ─────────────────────────


@router.get("/ai/conversations", response_model=list[ConversationRead])
def list_conversations(db: Session = Depends(get_db)):
    from sqlalchemy import select
    from app.models import AIConversation

    convs = list(db.execute(
        select(AIConversation).order_by(AIConversation.updated_at.desc()).limit(50)
    ).scalars())

    return [
        ConversationRead(
            id=c.id,
            title=c.title,
            period=c.period,
            message_count=c.message_count,
            created_at=c.created_at.isoformat() if c.created_at else "",
            updated_at=c.updated_at.isoformat() if c.updated_at else "",
        )
        for c in convs
    ]


@router.post("/ai/conversations", response_model=ConversationRead)
def create_conversation(payload: ConversationCreate, db: Session = Depends(get_db)):
    from app.models import AIConversation

    conv = AIConversation(period=payload.period, title="New Conversation")
    db.add(conv)
    db.commit()
    db.refresh(conv)

    return ConversationRead(
        id=conv.id,
        title=conv.title,
        period=conv.period,
        message_count=conv.message_count,
        created_at=conv.created_at.isoformat() if conv.created_at else "",
        updated_at=conv.updated_at.isoformat() if conv.updated_at else "",
    )


@router.get("/ai/conversations/{conv_id}/messages", response_model=list[MessageRead])
def get_conversation_messages(conv_id: str, db: Session = Depends(get_db)):
    from sqlalchemy import select
    from app.models import AIMessage

    msgs = list(db.execute(
        select(AIMessage)
        .where(AIMessage.conversation_id == conv_id)
        .order_by(AIMessage.order_index)
    ).scalars())

    return [
        MessageRead(
            id=m.id,
            role=m.role,
            content=m.content,
            order_index=m.order_index,
            created_at=m.created_at.isoformat() if m.created_at else "",
        )
        for m in msgs
    ]


@router.post("/ai/conversations/{conv_id}/messages", response_model=dict)
def save_conversation_messages(
    conv_id: str, payload: MessagesSaveRequest, db: Session = Depends(get_db)
):
    """Batch replace: delete all existing messages and insert new ones."""
    from sqlalchemy import delete, select
    from app.models import AIConversation, AIMessage

    conv = db.execute(
        select(AIConversation).where(AIConversation.id == conv_id)
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    # Delete existing messages
    db.execute(delete(AIMessage).where(AIMessage.conversation_id == conv_id))

    # Insert new messages
    for i, msg in enumerate(payload.messages):
        db.add(AIMessage(
            conversation_id=conv_id,
            role=msg.role,
            content=msg.content,
            order_index=i,
        ))

    # Update conversation metadata
    conv.message_count = len(payload.messages)
    if payload.title:
        conv.title = payload.title
    elif payload.messages and conv.title == "New Conversation":
        # Auto-generate title from first user message
        first_user = next((m for m in payload.messages if m.role == "user"), None)
        if first_user:
            conv.title = first_user.content[:50].strip()

    db.commit()
    return {"status": "ok", "count": len(payload.messages)}


@router.delete("/ai/conversations/{conv_id}", response_model=dict)
def delete_conversation(conv_id: str, db: Session = Depends(get_db)):
    from sqlalchemy import delete, select
    from app.models import AIConversation, AIMessage

    conv = db.execute(
        select(AIConversation).where(AIConversation.id == conv_id)
    ).scalar_one_or_none()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")

    db.execute(delete(AIMessage).where(AIMessage.conversation_id == conv_id))
    db.delete(conv)
    db.commit()
    return {"status": "deleted"}


# ── AI Event Analysis ─────────────────────────────────


@router.post("/ai/analyze-events")
def ai_analyze_events(payload: AnalyzeEventsRequest, db: Session = Depends(get_db)):
    """触发 AI 事件分析：将原始事件转化为结构化任务记录。"""
    try:
        run = run_event_analysis(db, period=payload.period, trigger_mode="manual", refresh=payload.refresh)
        return AnalysisRunRead(
            id=run.id,
            period=run.period,
            period_start=run.period_start.isoformat() if run.period_start else "",
            period_end=run.period_end.isoformat() if run.period_end else "",
            trigger_mode=run.trigger_mode,
            status=run.status,
            total_events_seen=run.total_events_seen,
            noise_events_count=run.noise_events_count,
            tasks_identified=run.tasks_identified,
            error_message=run.error_message,
            model=run.model,
            created_at=run.created_at.isoformat() if run.created_at else "",
            completed_at=run.completed_at.isoformat() if run.completed_at else None,
        ).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/ai/analyzed-tasks")
def list_analyzed_tasks(
    period: str = "week",
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
):
    """获取分析任务列表。"""
    tasks, total = get_analyzed_tasks(db, period=period, limit=limit, offset=offset)
    return {
        "tasks": [
            AnalyzedTaskRead(
                id=t.id,
                period=t.period,
                period_start=t.period_start.isoformat() if t.period_start else "",
                period_end=t.period_end.isoformat() if t.period_end else "",
                title=t.title,
                problem_description=t.problem_description,
                actions_taken=t.actions_taken,
                solution=t.solution,
                result=t.result,
                result_detail=t.result_detail,
                reference_theory=t.reference_theory,
                efficiency_score=t.efficiency_score,
                activity_type=t.activity_type,
                project=t.project,
                tags=t.tags,
                sources=t.sources,
                source_event_ids=t.source_event_ids,
                analysis_run_id=t.analysis_run_id,
                model=t.model,
                created_at=t.created_at.isoformat() if t.created_at else "",
                updated_at=t.updated_at.isoformat() if t.updated_at else "",
            ).model_dump()
            for t in tasks
        ],
        "total": total,
    }


@router.get("/ai/analyzed-tasks/{task_id}")
def get_analyzed_task(task_id: str, db: Session = Depends(get_db)):
    """获取单个分析任务详情。"""
    from sqlalchemy import select
    from app.models import AnalyzedTask

    task = db.execute(
        select(AnalyzedTask).where(AnalyzedTask.id == task_id)
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return AnalyzedTaskRead(
        id=task.id,
        period=task.period,
        period_start=task.period_start.isoformat() if task.period_start else "",
        period_end=task.period_end.isoformat() if task.period_end else "",
        title=task.title,
        problem_description=task.problem_description,
        actions_taken=task.actions_taken,
        solution=task.solution,
        result=task.result,
        result_detail=task.result_detail,
        reference_theory=task.reference_theory,
        efficiency_score=task.efficiency_score,
        activity_type=task.activity_type,
        project=task.project,
        tags=task.tags,
        sources=task.sources,
        source_event_ids=task.source_event_ids,
        analysis_run_id=task.analysis_run_id,
        model=task.model,
        created_at=task.created_at.isoformat() if task.created_at else "",
        updated_at=task.updated_at.isoformat() if task.updated_at else "",
    ).model_dump()


@router.patch("/ai/analyzed-tasks/{task_id}")
def update_analyzed_task(task_id: str, payload: AnalyzedTaskUpdate, db: Session = Depends(get_db)):
    """手动修正分析任务（编辑 AI 生成的内容）。"""
    from sqlalchemy import select
    from app.models import AnalyzedTask

    task = db.execute(
        select(AnalyzedTask).where(AnalyzedTask.id == task_id)
    ).scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(task, key, value)

    db.commit()
    db.refresh(task)
    return {"status": "ok", "id": task.id}


@router.get("/ai/analysis-runs")
def list_analysis_runs(
    period: str = "week",
    limit: int = 10,
    db: Session = Depends(get_db),
):
    """获取分析运行历史。"""
    runs = get_analysis_runs(db, period=period, limit=limit)
    return [
        AnalysisRunRead(
            id=r.id,
            period=r.period,
            period_start=r.period_start.isoformat() if r.period_start else "",
            period_end=r.period_end.isoformat() if r.period_end else "",
            trigger_mode=r.trigger_mode,
            status=r.status,
            total_events_seen=r.total_events_seen,
            noise_events_count=r.noise_events_count,
            tasks_identified=r.tasks_identified,
            error_message=r.error_message,
            model=r.model,
            created_at=r.created_at.isoformat() if r.created_at else "",
            completed_at=r.completed_at.isoformat() if r.completed_at else None,
        ).model_dump()
        for r in runs
    ]


@router.get("/ai/analysis-comparison")
def analysis_comparison(
    current_period: str = "week",
    previous_period: str = "month",
    db: Session = Depends(get_db),
):
    """对比两个周期的分析任务。"""
    return get_period_comparison(db, current_period, previous_period)


@router.get("/ai/schedule-config")
def get_schedule():
    """获取分析调度配置。"""
    return get_schedule_config()


@router.put("/ai/schedule-config")
def update_schedule_config(payload: ScheduleConfigUpdate):
    """更新分析调度配置。"""
    result = update_schedule(
        mode=payload.mode,
        hour=payload.hour,
        minute=payload.minute,
        interval_hours=payload.interval_hours,
    )
    return result
