"""AI 分析路由（复盘 + Skill 草稿 + 流式对话）。"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.gateways.base import LLMGatewayError
from app.schemas.ai import ChatRequest, PeriodReviewRequest, SkillDraftRequest
from app.services.ai_analysis import build_chat_context, generate_period_review, generate_skill_draft

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
