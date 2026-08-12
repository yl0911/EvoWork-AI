"""系统 Skill 种子数据 — 各类数据采集方法的标准化 Skill 定义。"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Skill

SYSTEM_SKILLS: list[dict] = [
    {
        "id": "sys_skill_git_collector",
        "name": "Git 提交自动采集",
        "category": "reusable",
        "source": "system",
        "trigger": "当 git post-commit hook 触发时自动执行",
        "content": "通过 Git post-commit hook 自动捕获代码提交信息，包括 SHA、提交消息、分支、变更文件列表、增删行数，并转换为 EvoWork 事件。",
        "steps": [
            "1. post-commit hook 捕获提交 SHA 和元信息",
            "2. 解析 commit message 推断事件类型（fix→debug, feat→coding, docs→writing）",
            "3. 提取变更文件列表和增删行数",
            "4. 通过 /api/collect/git 推送到采集服务",
            "5. SHA 去重，避免重复录入",
            "6. 自动关联到 project（从 repo_name 推断）",
        ],
        "inputs": ["commit SHA", "commit message", "branch", "files_changed", "insertions/deletions"],
        "outputs": ["coding/debug/writing 类型事件"],
        "success_criteria": "每次 git commit 生成一条 source=git 的事件，SHA 不重复",
        "failure_fallback": "hook 执行失败不阻断 commit 流程，仅输出 stderr 警告",
        "agent_assistable": False,
        "system_skill": True,
        "enabled": True,
    },
    {
        "id": "sys_skill_activitywatch_import",
        "name": "ActivityWatch 活动导入",
        "category": "reusable",
        "source": "system",
        "trigger": "用户手动触发或定时 cron 执行",
        "content": "从 ActivityWatch 导出 JSON 数据，将桌面应用使用记录（app 名称、窗口标题、持续时长）映射为 habit 层事件。",
        "steps": [
            "1. 查询 ActivityWatch API 获取指定时间段的事件",
            "2. 按 app+window_title 聚合去重",
            "3. 映射 appname → event_type（Chrome→browser, VS Code→coding 等）",
            "4. 推断 project（从窗口标题中的项目名）",
            "5. 通过 /api/collect/import 批量导入",
            "6. 记录上次导入时间戳，增量导入",
        ],
        "inputs": ["时间范围", "ActivityWatch bucket ID"],
        "outputs": ["app_usage 类型 habit 事件列表"],
        "success_criteria": "ActivityWatch 数据完整导入，事件时间/时长准确",
        "failure_fallback": "API 不可用时缓存原始 JSON，下次重试",
        "agent_assistable": True,
        "agent_assistable_parts": ["app→event_type 映射规则配置", "project 名称推断"],
        "system_skill": True,
        "enabled": True,
    },
    {
        "id": "sys_skill_browser_tracker",
        "name": "浏览器活动追踪",
        "category": "reusable",
        "source": "system",
        "trigger": "浏览器扩展定时上报或会话结束时推送",
        "content": "追踪浏览器访问模式，按域名/URL 模式聚合浏览时间，自动分类为 research、documentation、social 等子类型。",
        "steps": [
            "1. 浏览器扩展采集当前标签页和访问时长",
            "2. 按域名分组，计算每个域名的停留时间",
            "3. 根据域名规则分类（stackoverflow→research, github→coding, youtube→learning 等）",
            "4. 生成 browser 类型事件",
            "5. 附加 URL 到 artifacts 列表",
        ],
        "inputs": ["域名列表", "每个域名停留时长", "当前 URL"],
        "outputs": ["browser 类型 habit 事件"],
        "success_criteria": "浏览记录准确分类，停留时间误差 < 10%",
        "failure_fallback": "网络不通时本地缓存，下次批量上报",
        "agent_assistable": True,
        "agent_assistable_parts": ["域名→分类规则", "项目关键词匹配"],
        "system_skill": True,
        "enabled": False,
    },
    {
        "id": "sys_skill_ide_tracker",
        "name": "IDE 使用追踪",
        "category": "reusable",
        "source": "system",
        "trigger": "IDE 插件在文件操作或活跃编辑时触发",
        "content": "通过 IDE 插件（VS Code / JetBrains）追踪编辑活动，记录编码时长、活跃文件、项目上下文。",
        "steps": [
            "1. IDE 插件监听文件打开/保存/关闭事件",
            "2. 按项目（workspace root）聚合编辑时间",
            "3. 记录活跃文件类型分布（.py, .tsx, .md 等）",
            "4. 每 30 分钟或会话结束时生成 coding 事件",
            "5. 附带文件路径和编辑行数到 artifacts",
        ],
        "inputs": ["workspace root", "活跃文件列表", "编辑行数", "会话时长"],
        "outputs": ["coding 类型 problem 事件"],
        "success_criteria": "编码时段准确记录，项目自动关联",
        "failure_fallback": "EvoWork 服务不可达时本地队列缓存",
        "agent_assistable": False,
        "system_skill": True,
        "enabled": False,
    },
    {
        "id": "sys_skill_manual_event",
        "name": "手动事件记录",
        "category": "reusable",
        "source": "system",
        "trigger": "用户在 Events 页面手动填写并提交表单",
        "content": "结构化的手动事件录入流程，支持三层分类、标签、项目关联、隐私级别，并提供标签自动补全建议。",
        "steps": [
            "1. 用户选择事件类型和层级",
            "2. 填写标题和详细内容",
            "3. 添加标签（支持逗号分隔或自动建议）",
            "4. 设置时长和结果状态",
            "5. 选择隐私级别（metadata/content/private）",
            "6. 提交后自动向量索引",
        ],
        "inputs": ["标题", "事件类型", "层级", "标签", "时长", "内容"],
        "outputs": ["任意类型事件"],
        "success_criteria": "事件创建成功并可搜索，标签正确索引",
        "failure_fallback": "表单保留输入内容，提示用户重试",
        "agent_assistable": True,
        "agent_assistable_parts": ["标签建议", "event_layer 自动推断", "内容摘要生成"],
        "system_skill": True,
        "enabled": True,
    },
    {
        "id": "sys_skill_debug_logger",
        "name": "调试会话记录",
        "category": "reusable",
        "source": "system",
        "trigger": "用户主动开启调试模式，或 AI 检测到 debug 类事件时建议记录",
        "content": "结构化记录调试过程：错误现象→排查步骤→根因→修复方案，形成可复用的 debug skill。",
        "steps": [
            "1. 记录错误现象和触发条件",
            "2. 记录排查过程中尝试的方案（包括失败的）",
            "3. 记录最终定位到的根因",
            "4. 记录修复方案和验证结果",
            "5. 提取关键词作为标签",
            "6. 可选：AI 总结为可复用 Skill",
        ],
        "inputs": ["错误消息", "排查步骤列表", "根因", "修复方案"],
        "outputs": ["debug 类型事件 + 可选的新 Skill"],
        "success_criteria": "调试过程完整记录，可回溯定位根因",
        "failure_fallback": "仅记录基础信息，标记为 partial",
        "agent_assistable": True,
        "agent_assistable_parts": ["根因分析建议", "相似问题检索", "Skill 草稿生成"],
        "system_skill": True,
        "enabled": True,
    },
    {
        "id": "sys_skill_search_collector",
        "name": "搜索模式收集",
        "category": "reusable",
        "source": "system",
        "trigger": "用户使用 EvoWork 内置搜索或浏览器搜索时触发",
        "content": "收集用户的搜索查询模式，识别重复搜索主题和信息缺口，为 Skill 推荐提供输入。",
        "steps": [
            "1. 捕获搜索查询（来源：EvoWork Search / 浏览器扩展）",
            "2. 记录搜索上下文（当前项目、正在解决的问题）",
            "3. 标记搜索结果是否满意",
            "4. 聚合相似查询，发现信息缺口",
            "5. 当同一主题搜索 ≥ 3 次时建议创建 Skill",
        ],
        "inputs": ["搜索查询", "搜索来源", "上下文项目", "结果满意度"],
        "outputs": ["search 类型事件 + Skill 推荐触发"],
        "success_criteria": "搜索模式准确聚类，重复主题自动发现",
        "failure_fallback": "仅记录原始查询，不做聚类分析",
        "agent_assistable": True,
        "agent_assistable_parts": ["查询聚类", "Skill 缺口分析", "推荐生成"],
        "system_skill": True,
        "enabled": False,
    },
    {
        "id": "sys_skill_context_switch",
        "name": "上下文切换检测",
        "category": "reusable",
        "source": "system",
        "trigger": "检测到项目/工具/窗口频繁切换时触发",
        "content": "检测工作中的上下文切换模式，量化切换频率和效率损失，帮助识别碎片化工作时段。",
        "steps": [
            "1. 监听窗口/项目/工具的切换事件",
            "2. 计算连续切换间隔（< 5 分钟视为碎片化）",
            "3. 记录切换来源和目标",
            "4. 生成 context_switch 类型事件",
            "5. 累计到日报中，标注碎片化时段",
        ],
        "inputs": ["窗口切换时间戳", "来源项目/工具", "目标项目/工具"],
        "outputs": ["context_switch 类型 habit 事件"],
        "success_criteria": "切换事件准确捕获，碎片化评分合理",
        "failure_fallback": "仅记录切换次数，不做深度分析",
        "agent_assistable": True,
        "agent_assistable_parts": ["碎片化评分", "专注时段建议"],
        "system_skill": True,
        "enabled": False,
    },
    {
        "id": "sys_skill_shell_collector",
        "name": "终端 Shell 历史采集",
        "category": "reusable",
        "source": "system",
        "trigger": "每条 shell 命令执行后自动触发（PROMPT_COMMAND / precmd hook）",
        "content": "通过 shell hook 实时捕获终端命令执行记录，自动分类命令类型（编码/部署/运维/工具），"
                 "记录退出码和工作目录，推断项目上下文，并支持从历史文件批量回溯。",
        "steps": [
            "1. shell hook（bash PROMPT_COMMAND / zsh precmd）在每条命令执行后触发",
            "2. 捕获命令文本、退出码、当前工作目录、shell 类型",
            "3. 从工作目录推断项目名称（取最后一级目录名）",
            "4. 通过 /api/collect/shell 推送到采集服务",
            "5. 基于命令模式自动分类：git→coding, pip/npm→setup, ssh→ops, curl→research 等",
            "6. 命令哈希+时间戳去重，过滤高频噪声命令（cd/ls/clear）",
        ],
        "inputs": ["command", "exit_code", "cwd", "shell_type", "executed_at"],
        "outputs": ["coding/ops/research/debug 类型 habit 事件"],
        "success_criteria": "命令实时入库，分类准确，噪声命令被过滤",
        "failure_fallback": "EvoWork 服务不可达时命令追加到本地 ~/.evowork_shell_buffer.log，下次批量补发",
        "agent_assistable": True,
        "agent_assistable_parts": ["命令模式→event_type 映射配置", "噪声命令过滤规则", "项目名推断"],
        "system_skill": True,
        "enabled": True,
    },
]


def seed_system_skills(db: Session) -> None:
    """幂等播种系统 Skill：仅添加尚不存在的。"""
    existing_ids = set(
        row[0] for row in db.execute(select(Skill.id).where(Skill.system_skill == True)).all()  # noqa: E712
    )

    added = 0
    for skill_data in SYSTEM_SKILLS:
        if skill_data["id"] in existing_ids:
            continue
        skill = Skill(**skill_data)
        db.add(skill)
        added += 1

    if added > 0:
        db.commit()
        print(f"[System Skills] Seeded {added} system skills.")
    else:
        print("[System Skills] All system skills already exist.")
