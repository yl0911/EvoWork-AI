"""Demo 数据种子 — Phase 2 增强版。

演示数据覆盖三层事件模型和三类 Skill：
- 问题事件 (problem): 搜索、调试、总结
- 结果事件 (result): 问题解决结果
- 可复用型 Skill: CUDA 环境排查
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill, SkillUsageLog, WorkEvent


def seed_demo_data(db: Session) -> None:
    has_events = db.execute(select(WorkEvent.id).limit(1)).first()
    has_skills = db.execute(select(Skill.id).limit(1)).first()
    if has_events or has_skills:
        return

    now = datetime.now(timezone.utc)

    # ── Skill: 可复用型 ──
    skill = Skill(
        id="skill_cuda_debug",
        name="CUDA 环境排查 Skill",
        category="reusable",
        source="ai_generated",
        trigger="多次出现 CUDA、onnxruntime、驱动版本、Python 环境相关问题",
        content="把反复出现的环境排查步骤沉淀为检查清单和脚本，减少重复搜索和试错。",
        steps=[
            "确认 Python、CUDA、显卡驱动版本",
            "检查 onnxruntime-gpu 与 CUDA 兼容关系",
            "读取 requirements.txt 和实际安装包版本",
            "运行最小推理用例验证环境",
            "把修复方式写入项目文档",
        ],
        inputs=["错误日志", "requirements.txt", "系统环境", "最小复现代码"],
        outputs=["诊断报告", "check_env.py", "修复记录"],
        success_criteria="onnxruntime-gpu 推理测试通过，无 CUDA 版本不匹配错误",
        failure_fallback="回退到 CPU 版 onnxruntime 继续开发，标记为待解决",
        agent_assistable=True,
        agent_assistable_parts=["环境版本检查", "依赖兼容性查询", "check_env.py 生成"],
        usage_count=2,
        avg_effectiveness=0.75,
    )

    # ── Skill: 思路型 ──
    skill_thinking = Skill(
        id="skill_learning_framework",
        name="新技术快速学习 Skill",
        category="thinking",
        source="user_generated",
        trigger="需要学习一个新框架或技术栈时",
        content="先用 30 分钟过官方 Quick Start，再找一个小项目动手，最后总结常见坑。",
        steps=[
            "读官方 Quick Start（30 分钟）",
            "找一个最小示例项目跑通",
            "记录 3 个常见坑和解决方式",
            "用自己的话总结学习路径",
        ],
        inputs=["技术名称", "官方文档链接"],
        outputs=["学习笔记", "常见问题清单", "最小示例代码"],
        methods=[
            "先跑通再理解：通过动手建立直觉",
            "3 坑法则：记录前 3 个坑避免二次踩坑",
            "输出倒逼输入：写总结强迫自己理解",
        ],
        agent_assistable=False,
    )

    # ── 事件：问题层 (problem) ──
    events = [
        WorkEvent(
            event_layer="problem",
            source="browser",
            event_type="search",
            title="检索 onnxruntime CUDA 兼容问题",
            content="搜索 onnxruntime-gpu、CUDA 版本、NVIDIA driver 的兼容关系。",
            privacy_level="metadata",
            project="OCR 模型优化",
            tags=["cuda", "onnxruntime", "debug"],
            duration_minutes=42,
            outcome="partial",
            started_at=now - timedelta(days=2, hours=3),
            linked_skill_id="skill_cuda_debug",
        ),
        WorkEvent(
            event_layer="problem",
            source="ide",
            event_type="debug",
            title="排查 OCR 推理环境不稳定",
            content="定位到 onnxruntime-gpu 版本和 CUDA runtime 不匹配。",
            privacy_level="content",
            project="OCR 模型优化",
            tags=["cuda", "python", "ocr"],
            duration_minutes=85,
            outcome="resolved",
            started_at=now - timedelta(days=1, hours=2),
            linked_skill_id="skill_cuda_debug",
            ai_summary="用户在排查 OCR 模型推理环境问题，根因是 onnxruntime-gpu 与 CUDA runtime 版本不匹配。",
        ),
        WorkEvent(
            event_layer="problem",
            source="manual",
            event_type="summary",
            title="沉淀环境排查流程",
            content="准备把版本检查、依赖检查、最小推理验证整理成可复用 Skill。",
            privacy_level="content",
            project="EvoWork AI",
            tags=["skill", "reflection", "debug"],
            duration_minutes=35,
            outcome="resolved",
            started_at=now - timedelta(hours=4),
            linked_skill_id="skill_cuda_debug",
        ),
        WorkEvent(
            event_layer="problem",
            source="ai_chat",
            event_type="planning",
            title="梳理个人工作学习助手 Demo 范围",
            content="确定 WorkEvent、Insight、Skill、Agent Helper 四个核心闭环。",
            privacy_level="content",
            project="EvoWork AI",
            tags=["planning", "skill", "agent"],
            duration_minutes=55,
            outcome="resolved",
            started_at=now - timedelta(hours=1),
        ),
        # ── 事件：结果层 (result) ──
        WorkEvent(
            event_layer="result",
            source="manual",
            event_type="resolved",
            title="CUDA 环境问题最终解决",
            content="通过降级 onnxruntime-gpu 到 1.16.3 匹配 CUDA 11.8 解决。",
            privacy_level="content",
            project="OCR 模型优化",
            tags=["cuda", "onnxruntime"],
            duration_minutes=10,
            outcome="resolved",
            started_at=now - timedelta(days=1),
            parent_event_id=None,  # 会在下面设置
            linked_skill_id="skill_cuda_debug",
            ai_summary="环境问题闭环：降级 onnxruntime-gpu 版本后推理正常。",
        ),
    ]

    db.add(skill)
    db.add(skill_thinking)
    db.add_all(events)
    db.commit()

    # 设置 result 事件的 parent（指向 debug 事件）
    debug_event = events[1]  # 排查 OCR 推理环境不稳定
    result_event = events[4]  # CUDA 环境问题最终解决
    result_event.parent_event_id = debug_event.id
    db.commit()

    # ── Skill 使用记录 ──
    usage_logs = [
        SkillUsageLog(
            skill_id="skill_cuda_debug",
            event_id=debug_event.id,
            outcome="effective",
            time_saved_minutes=20,
            notes="按照 Skill 步骤快速定位到版本不匹配",
        ),
        SkillUsageLog(
            skill_id="skill_cuda_debug",
            event_id=result_event.id,
            outcome="partial",
            time_saved_minutes=10,
            notes="Skill 帮助确认方向，但最终需要额外查版本对应表",
        ),
    ]
    db.add_all(usage_logs)
    db.commit()
