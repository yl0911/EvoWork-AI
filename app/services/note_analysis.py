"""AI 笔记分析服务 — 将用户笔记拆分为结构化工作事件。"""

from __future__ import annotations

import json
import re
from datetime import datetime


NOTE_ANALYSIS_SYSTEM_PROMPT = """你是 EvoWork AI 的笔记分析引擎。
你的任务是将用户的工作笔记拆分为一条或多条结构化的工作事件。
每个事件代表笔记中描述的一项独立的工作活动。
如果笔记只涉及一个主题，产出一条事件。
如果笔记涵盖多个不同的活动，产出多条事件。
用中文输出，语气具体、可执行。"""

# 笔记文本截断上限（字符数）
_MAX_NOTE_CHARS = 4000

# 合法的事件类型
_VALID_EVENT_TYPES = frozenset({
    "coding", "debug", "writing", "planning",
    "reading", "design", "research", "ops", "note",
})

# 合法的结果状态
_VALID_OUTCOMES = frozenset({"resolved", "partial", "unresolved"})


def analyze_note(
    text: str,
    filename: str,
    modified_at: datetime,
    gateway,
) -> list[dict]:
    """Analyze note text and return list of event dicts.

    Each dict has:
    {
        "title": str,
        "event_type": str,  # coding|debug|writing|planning|reading|design|research|ops|note
        "content": str,     # concise summary
        "project": str | None,
        "tags": list[str],
        "duration_minutes": int,
        "outcome": str,     # resolved|partial|unresolved
    }

    Args:
        text: 笔记正文。
        filename: 笔记文件名（含扩展名）。
        modified_at: 笔记最后修改时间。
        gateway: LLM 网关实例，需提供 ``chat(system_prompt, user_prompt, temperature)`` 方法。

    Returns:
        解析后的事件列表；解析失败时返回空列表。
    """
    prompt = _build_note_prompt(text, filename, modified_at)

    result = gateway.chat(
        system_prompt=NOTE_ANALYSIS_SYSTEM_PROMPT,
        user_prompt=prompt,
        temperature=0.1,
    )

    events = _parse_note_response(result.content)

    # 对 LLM 产出做基本校验与规范化
    sanitized: list[dict] = []
    for ev in events:
        if not isinstance(ev, dict):
            continue
        event_type = ev.get("event_type", "note")
        if event_type not in _VALID_EVENT_TYPES:
            event_type = "note"
        outcome = ev.get("outcome", "unresolved")
        if outcome not in _VALID_OUTCOMES:
            outcome = "unresolved"
        duration = ev.get("duration_minutes", 0)
        try:
            duration = max(0, int(duration))
        except (ValueError, TypeError):
            duration = 0
        sanitized.append({
            "title": (ev.get("title") or "未命名事件")[:200],
            "event_type": event_type,
            "content": ev.get("content", ""),
            "project": ev.get("project") or None,
            "tags": ev.get("tags", []) if isinstance(ev.get("tags"), list) else [],
            "duration_minutes": duration,
            "outcome": outcome,
        })

    print(f"[NoteAnalysis] File={filename}, parsed {len(sanitized)} events")
    return sanitized


def _build_note_prompt(text: str, filename: str, modified_at: datetime) -> str:
    """Build the LLM prompt for note analysis.

    Truncates the note text to approximately ``_MAX_NOTE_CHARS`` characters
    and asks the model to return a JSON array with specific fields.
    """
    # 截断过长笔记
    truncated = len(text) > _MAX_NOTE_CHARS
    note_text = text[:_MAX_NOTE_CHARS]
    if truncated:
        note_text += "\n…（内容已截断，原文共 {} 字符）".format(len(text))

    time_str = modified_at.strftime("%Y-%m-%d %H:%M")

    return f"""请分析以下工作笔记，将其拆分为一条或多条结构化的工作事件。

文件名: {filename}
修改时间: {time_str}

--- 笔记内容 ---
{note_text}
--- 结束 ---

输出格式：返回一个 JSON 数组，每个元素包含以下字段：
```json
[
  {{
    "title": "事件标题（简洁描述做了什么，不超过 40 字）",
    "event_type": "事件类型，必须是以下之一: coding/debug/writing/planning/reading/design/research/ops/note",
    "content": "事件详细描述（2-4 句话，概括这项活动的核心内容）",
    "project": "项目名称（如能从内容推断，无法推断则为 null）",
    "tags": ["标签1", "标签2"],
    "duration_minutes": 30,
    "outcome": "结果状态，必须是以下之一: resolved/partial/unresolved"
  }}
]
```

字段说明：
- title: 一句话概括这个事件做了什么，具体且可执行。
- event_type: 从 coding/debug/writing/planning/reading/design/research/ops/note 中选择最匹配的类型。
- content: 2-4 句话描述事件的具体内容、目标和关键细节。
- project: 如果能从笔记内容中推断出所属项目，填写项目名称；否则为 null。
- tags: 2-5 个关键词标签，用于后续检索和分类。
- duration_minutes: 预估完成这项活动所需的分钟数（整数）。
- outcome: resolved（已完成）、partial（部分完成）或 unresolved（未完成/待跟进）。

要求：
1. 如果笔记只涉及一个主题，输出一条事件即可。
2. 如果笔记涵盖多个不同的工作活动，拆分为多条事件。
3. 只输出 JSON 数组，不要输出其他内容。"""


def _parse_note_response(content: str) -> list[dict]:
    """Parse LLM response into a list of event dicts.

    Uses the same three-tier fallback strategy as
    ``event_analysis._parse_llm_response``:
    1. Direct JSON parse
    2. Extract from markdown code block
    3. Find first ``[`` to last ``]``
    """
    # 策略 1: 直接 JSON 解析
    try:
        result = json.loads(content)
        if isinstance(result, list) and len(result) > 0:
            return result
    except json.JSONDecodeError:
        pass

    # 策略 2: 从 markdown code block 中提取
    json_match = re.search(r'```(?:json)?\s*\n?([\s\S]*?)\n?```', content)
    if json_match:
        try:
            result = json.loads(json_match.group(1))
            if isinstance(result, list) and len(result) > 0:
                return result
        except json.JSONDecodeError:
            pass

    # 策略 3: 找到第一个 [ 和最后一个 ] 之间的内容
    start = content.find('[')
    end = content.rfind(']')
    if start != -1 and end > start:
        try:
            result = json.loads(content[start:end + 1])
            if isinstance(result, list) and len(result) > 0:
                return result
        except json.JSONDecodeError:
            pass

    # 全部失败
    print(f"[NoteAnalysis] Failed to parse LLM response")
    return []
