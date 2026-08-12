"""采集服务核心 — 转换、去重、持久化、索引。"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import WorkEvent
from app.models.work_event import infer_event_layer
from app.services.indexing import index_event
from app.schemas.collector import (
    ActivityWatchEventPayload,
    BatchIngestResult,
    GitCommitPayload,
    ImportItem,
    IngestResult,
    ShellCommandPayload,
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


# ── Git commit 消息关键词 → 标签/类型映射 ────────────

_KEYWORD_MAP: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"\bfix(?:ed|es)?|bugfix|hotfix|patch\b", re.I), "debug", "bugfix"),
    (re.compile(r"\brefactor|restructur|cleanup\b", re.I), "coding", "refactor"),
    (re.compile(r"\bdocs?|readme|changelog\b", re.I), "writing", "docs"),
    (re.compile(r"\btest|spec\b", re.I), "coding", "testing"),
    (re.compile(r"\bfeat(?:ure)?|add(?:ed)?|implement\b", re.I), "coding", "feature"),
    (re.compile(r"\bchore|deps?|bump|ci\b", re.I), "coding", "chore"),
    (re.compile(r"\bstyle|format|lint\b", re.I), "coding", "style"),
    (re.compile(r"\bperf|optim|speed\b", re.I), "coding", "performance"),
]


def _infer_git_event(message: str) -> tuple[str, list[str]]:
    """从 commit message 推断 event_type 和额外 tags。"""
    subject = message.split("\n")[0]  # 只看第一行
    best_type = "coding"
    tags: list[str] = []
    for pattern, evt_type, tag in _KEYWORD_MAP:
        if pattern.search(subject):
            best_type = evt_type
            tags.append(tag)
            break
    return best_type, tags


# ── Shell 命令模式 → 事件类型/标签 ─────────────────

_SHELL_CMD_MAP: list[tuple[re.Pattern, str, str]] = [
    # 编码 / 构建
    (re.compile(r"^(?:git|gh)\b", re.I), "coding", "git"),
    (re.compile(r"^(?:docker|docker-compose|podman|kubectl|k8s|helm)\b", re.I), "coding", "container"),
    (re.compile(r"^(?:make|cmake|cargo|go\s+(?:build|run|test))\b", re.I), "coding", "build"),
    (re.compile(r"^(?:npm|yarn|pnpm|bun|npx|node)\b", re.I), "coding", "node"),
    (re.compile(r"^(?:pip|python|uv|poetry|conda|pipenv)\b", re.I), "coding", "python"),
    (re.compile(r"^(?:vite|webpack|tsc|eslint|pytest|jest|vitest)\b", re.I), "coding", "toolchain"),
    # 运维
    (re.compile(r"^(?:ssh|scp|rsync|sftp)\b", re.I), "ops", "remote"),
    (re.compile(r"^(?:systemctl|service|journalctl|top|htop|ps\b|kill)\b", re.I), "ops", "process"),
    (re.compile(r"^(?:chmod|chown|mount|umount|fdisk|lsblk)\b", re.I), "ops", "filesystem"),
    (re.compile(r"^(?:netstat|ss\b|curl|wget|ping|traceroute|dig|nslookup|ip\b|ifconfig)\b", re.I), "ops", "network"),
    (re.compile(r"^(?:apt|yum|dnf|brew|pacman|choco|winget)\b", re.I), "ops", "package-manager"),
    # 调试
    (re.compile(r"^(?:gdb|lldb|strace|dmesg|valgrind)\b", re.I), "debug", "debugger"),
    # 研究 / 学习
    (re.compile(r"^(?:man\b|tldr\b)", re.I), "research", "docs-lookup"),
    # 写作
    (re.compile(r"^(?:pandoc|latex|pdflatex|wkhtmltopdf)\b", re.I), "writing", "document"),
]

# 噪声命令：高频、无分析价值，默认过滤
_SHELL_NOISE_CMDS: set[str] = {
    "ls", "ll", "la", "cd", "pwd", "clear", "cls", "exit", "history",
    "echo", "date", "whoami", "which", "type",
    "",  # empty command
}


def _infer_shell_event(command: str) -> tuple[str, str, list[str]]:
    """推断 shell 命令的事件类型和标签。

    Returns: (event_type, title, tags)
    """
    # 取命令的第一段（去掉管道/重定向之前的部分）
    first_cmd = command.split("|")[0].split(">")[0].split(";")[0].strip()
    base_cmd = first_cmd.split()[0] if first_cmd.split() else ""

    for pattern, evt_type, tag in _SHELL_CMD_MAP:
        if pattern.search(first_cmd):
            title = first_cmd[:120]
            return evt_type, title, [tag]

    # 默认分类
    title = first_cmd[:120]
    return "note", title, ["shell"]


def _is_noise_command(command: str) -> bool:
    """判断是否为噪声命令（高频无分析价值）。"""
    base = command.strip().split()[0] if command.strip() else ""
    # 去掉 sudo / env 前缀
    if base in ("sudo", "env", "time"):
        parts = command.strip().split()
        base = parts[1] if len(parts) > 1 else base
    return base.lower() in _SHELL_NOISE_CMDS


# ── ActivityWatch 应用名 → 事件类型/标签 ───────────

_AW_APP_MAP: list[tuple[re.Pattern, str, list[str]]] = [
    # IDE / 编辑器 → coding
    (re.compile(r"visual studio code|vscode|cursor|vscodium", re.I), "coding", ["ide"]),
    (re.compile(r"jetbrains|intellij|pycharm|webstorm|goland|rubymine|phpstorm|clion|rider", re.I), "coding", ["ide", "jetbrains"]),
    (re.compile(r"vim|neovim|sublime|atom|emacs", re.I), "coding", ["editor"]),
    # 终端 → coding
    (re.compile(r"terminal|iterm|windows terminal|hyper|alacritty|kitty|warp|powershell|cmd", re.I), "coding", ["terminal"]),
    # 浏览器 → browser（后续可能根据 URL 再分类）
    (re.compile(r"chrome|chromium|firefox|brave|edge|safari|opera|vivaldi|arc", re.I), "browser", ["browser"]),
    # 通讯 → communication
    (re.compile(r"slack|discord|teams|telegram|wechat|wecom|钉钉|feishu|lark|zoom|meet", re.I), "communication", ["communication"]),
    # 设计 → design
    (re.compile(r"figma|sketch|adobe|photoshop|illustrator|xd|invision|canva", re.I), "design", ["design"]),
    # 文档 → writing
    (re.compile(r"notion|obsidian|typora|logseq|word|pages|onenote", re.I), "writing", ["notes"]),
    # 项目管理 → planning
    (re.compile(r"jira|asana|trello|linear|clickup|monday", re.I), "planning", ["pm-tool"]),
    # 数据库 → debug
    (re.compile(r"datagrip|dbeaver|tableplus|pgadmin|mysql workbench|studio 3t", re.I), "debug", ["database"]),
    # 容器/运维 → ops
    (re.compile(r"docker desktop|rancher|portainer", re.I), "ops", ["container"]),
]

# 浏览器 URL 模式 → 事件类型（更精细的浏览器分类）
_AW_URL_MAP: list[tuple[re.Pattern, str, list[str]]] = [
    (re.compile(r"github\.com|gitlab\.com|bitbucket\.org", re.I), "coding", ["git-web"]),
    (re.compile(r"stackoverflow\.com|stackexchange\.com|dev\.to", re.I), "research", ["qa-site"]),
    (re.compile(r"docs\.python|developer\.mozilla|mdn|reactjs\.org|vuejs\.org|angular\.io", re.I), "research", ["docs"]),
    (re.compile(r"youtube\.com|bilibili\.com|udemy\.com|coursera\.org", re.I), "learning", ["video"]),
    (re.compile(r"twitter\.com|x\.com|reddit\.com|weibo\.com|zhihu\.com", re.I), "browsing", ["social"]),
    (re.compile(r"mail\.google|outlook\.com|gmail\.com", re.I), "communication", ["email"]),
    (re.compile(r"chat\.openai|claude\.ai|poe\.com|bard\.google", re.I), "coding", ["ai-chat"]),
    (re.compile(r"localhost|127\.0\.0\.1|192\.168\.", re.I), "coding", ["local-dev"]),
]


def _infer_aw_event(app: str, title: str, url: str | None) -> tuple[str, str, list[str]]:
    """推断 ActivityWatch 事件类型。

    Returns: (event_type, display_title, tags)
    """
    # 优先用 URL 分类（浏览器场景更精确）
    if url:
        for pattern, evt_type, tags in _AW_URL_MAP:
            if pattern.search(url):
                display = title[:120] if title else url[:120]
                return evt_type, display, tags

    # 再用 app 名分类
    for pattern, evt_type, tags in _AW_APP_MAP:
        if pattern.search(app):
            display = f"{app}: {title[:80]}" if title else app
            return evt_type, display[:200], tags

    # 默认
    display = f"{app}: {title[:80]}" if title else (app or "Unknown")
    return "app_usage", display[:200], ["app"]


def _infer_project_from_title(title: str, url: str | None = None) -> str | None:
    """从窗口标题或 URL 推断项目名。

    优先级：
    1. GitHub/GitLab URL → repo 名
    2. 已知文档站域名 → 项目名映射
    3. StackOverflow URL → 提取 tag
    4. 通用域名提取
    5. 窗口标题 "file - project - IDE" 模式
    """
    if not title and not url:
        return None

    # ── URL-based inference ──
    if url:
        # 1. GitHub / GitLab: github.com/user/repo → Repo
        m = re.match(r"https?://(?:www\.)?(?:github|gitlab|bitbucket)\.com/([^/]+)/([^/]+)", url)
        if m:
            return m.group(2).replace("-", " ").replace(".git", "").title()

        # 2. 已知文档站 → 项目名映射
        _DOMAIN_PROJECT: list[tuple[re.Pattern, str]] = [
            # JS/TS 生态
            (re.compile(r"reactjs\.org|react\.dev|reactnative", re.I), "React"),
            (re.compile(r"vuejs\.org|vue\.js|vitejs\.dev", re.I), "Vue"),
            (re.compile(r"angular\.io|angular\.dev", re.I), "Angular"),
            (re.compile(r"nextjs\.org", re.I), "Next.js"),
            (re.compile(r"nuxt\.com", re.I), "Nuxt"),
            (re.compile(r"svelte\.dev|svelte\.js", re.I), "Svelte"),
            (re.compile(r"tailwindcss\.com", re.I), "Tailwind CSS"),
            (re.compile(r"typescriptlang\.org", re.I), "TypeScript"),
            (re.compile(r"nodejs\.org", re.I), "Node.js"),
            (re.compile(r"deno\.com|deno\.land", re.I), "Deno"),
            (re.compile(r"bun\.sh", re.I), "Bun"),
            # Python 生态
            (re.compile(r"docs\.python\.org|python\.org", re.I), "Python"),
            (re.compile(r"djangoproject\.com|docs\.django", re.I), "Django"),
            (re.compile(r"fastapi\.tiangolo|fastapi", re.I), "FastAPI"),
            (re.compile(r"flask\.palletsprojects|flask", re.I), "Flask"),
            (re.compile(r"sqlalchemy\.org", re.I), "SQLAlchemy"),
            (re.compile(r"pandas\.pydata|pandas", re.I), "Pandas"),
            (re.compile(r"numpy\.org", re.I), "NumPy"),
            (re.compile(r"pytorch\.org", re.I), "PyTorch"),
            (re.compile(r"tensorflow\.org", re.I), "TensorFlow"),
            (re.compile(r"huggingface\.co", re.I), "Hugging Face"),
            (re.compile(r"paddlepaddle", re.I), "PaddlePaddle"),
            (re.compile(r"pypi\.org", re.I), "PyPI"),
            # DevOps / 工具
            (re.compile(r"docker\.com|docs\.docker", re.I), "Docker"),
            (re.compile(r"kubernetes\.io|k8s", re.I), "Kubernetes"),
            (re.compile(r"terraform\.io", re.I), "Terraform"),
            (re.compile(r"ansible\.com", re.I), "Ansible"),
            (re.compile(r"nginx\.org|nginx\.com", re.I), "Nginx"),
            (re.compile(r"redis\.io", re.I), "Redis"),
            (re.compile(r"postgresql\.org|postgres", re.I), "PostgreSQL"),
            (re.compile(r"mongodb\.com", re.I), "MongoDB"),
            (re.compile(r"elastic\.co|elasticsearch", re.I), "Elasticsearch"),
            # 前端工具
            (re.compile(r"webpack\.js\.org", re.I), "Webpack"),
            (re.compile(r"esbuild|rollup\.js", re.I), "Bundler"),
            (re.compile(r"recharts\.org|recharts", re.I), "Recharts"),
            (re.compile(r"d3js\.org", re.I), "D3.js"),
            (re.compile(r"storybook\.js\.org", re.I), "Storybook"),
            # 平台 / 服务
            (re.compile(r"vercel\.com", re.I), "Vercel"),
            (re.compile(r"netlify\.com", re.I), "Netlify"),
            (re.compile(r"cloudflare\.com|workers\.dev", re.I), "Cloudflare"),
            (re.compile(r"aws\.amazon|docs\.aws", re.I), "AWS"),
            (re.compile(r"cloud\.google", re.I), "GCP"),
            (re.compile(r"learn\.microsoft|docs\.microsoft", re.I), "Microsoft"),
            (re.compile(r"developer\.mozilla|mdn", re.I), "MDN"),
            # AI / LLM
            (re.compile(r"openai\.com|platform\.openai", re.I), "OpenAI"),
            (re.compile(r"anthropic\.com|docs\.anthropic", re.I), "Anthropic"),
            (re.compile(r"langchain", re.I), "LangChain"),
            (re.compile(r"chromadb|trychroma", re.I), "ChromaDB"),
            (re.compile(r"onnxruntime|onnx\.ai", re.I), "ONNX"),
            # QA / 社区
            (re.compile(r"stackoverflow\.com|stackexchange\.com", re.I), "Stack Overflow"),
            (re.compile(r"dev\.to", re.I), "DEV Community"),
            (re.compile(r"hashnode\.com", re.I), "Hashnode"),
        ]

        for pattern, project_name in _DOMAIN_PROJECT:
            if pattern.search(url):
                return project_name

        # 3. 通用域名提取（取二级域名作为项目名）
        m = re.match(r"https?://(?:www\.)?([^.]+)\.", url)
        if m:
            domain = m.group(1).lower()
            # 过滤通用无意义域名
            _SKIP_DOMAINS = {
                "localhost", "127", "192", "10", "172",
                "google", "bing", "yahoo", "baidu",
                "youtube", "bilibili", "twitter", "weibo", "zhihu",
                "reddit", "medium", "dev",
                "gmail", "outlook", "mail",
                "slack", "discord", "teams",
            }
            if domain not in _SKIP_DOMAINS and len(domain) > 2:
                return domain.replace("-", " ").title()

    # ── Title-based inference ──
    if not title:
        return None

    # 已知 IDE / 编辑器名称（用于判断标题末尾是否为工具名）
    _IDE_NAMES = {
        "vs code", "vscode", "visual studio code", "visual studio",
        "intellij", "intellij idea", "pycharm", "webstorm", "goland",
        "rubymine", "phpstorm", "clion", "rider", "datagrip",
        "sublime", "sublime text", "atom", "emacs", "vim", "neovim",
        "notepad++", "notepad", "textmate", "cursor",
        "android studio", "xcode", "eclipse", "netbeans",
    }

    # 仅按有间距的分隔符切分： " - " " | " " – " " — "
    parts = re.split(r'\s+(?:[-–—|])\s+', title)

    if len(parts) >= 3:
        last = parts[-1].strip().lower()
        if last in _IDE_NAMES:
            # "file - ProjectName - IDE" → ProjectName
            candidate = parts[-2].strip()
        else:
            # "ProjectName - file - context" → 取倒数第二个
            candidate = parts[-2].strip()
        if 2 < len(candidate) < 50:
            return candidate

    elif len(parts) == 2:
        last = parts[-1].strip().lower()
        first = parts[0].strip().lower()
        if last in _IDE_NAMES:
            # "ProjectName - IDE" → ProjectName
            candidate = parts[0].strip()
        elif first in _IDE_NAMES:
            # "IDE - ProjectName" → ProjectName
            candidate = parts[-1].strip()
        elif re.match(r'^[\w.-]+\.\w{1,6}$', parts[0].strip()):
            # "filename.ext - ProjectName" → ProjectName（首段像文件名）
            candidate = parts[-1].strip()
        else:
            # 不确定时取第一个（"ProjectName | Tool" 模式更常见）
            candidate = parts[0].strip()
        if 2 < len(candidate) < 50:
            return candidate

    return None


class CollectorService:
    def __init__(self, db: Session):
        self.db = db

    # ── Git Commit ──────────────────────────────────

    def ingest_git_commit(self, payload: GitCommitPayload) -> IngestResult:
        # 1. 去重：同一 SHA 不重复录入
        if self._has_git_commit(payload.sha):
            return IngestResult(status="skipped_duplicate", detail=f"SHA {payload.sha[:12]} already recorded")

        # 2. 推断类型和标签
        event_type, auto_tags = _infer_git_event(payload.message)
        subject = payload.message.split("\n")[0]
        body = "\n".join(payload.message.split("\n")[1:]).strip() or None

        # 3. 构建事件
        started_at = payload.committed_at or utc_now()
        event = WorkEvent(
            event_layer=infer_event_layer(event_type),
            source="git",
            event_type=event_type,
            title=subject[:200],
            content=body,
            project=payload.repo_name,
            tags=auto_tags + ([payload.branch] if payload.branch else []),
            duration_minutes=0,
            outcome="resolved",
            started_at=started_at,
            collector_metadata={
                "collector": "git",
                "ref": payload.sha,
                "branch": payload.branch,
                "author": payload.author_name,
                "files_changed": len(payload.files_changed),
                "insertions": payload.insertions,
                "deletions": payload.deletions,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    # ── Batch Import ────────────────────────────────

    def ingest_batch(self, items: list[ImportItem], default_source: str = "external") -> BatchIngestResult:
        results: list[IngestResult] = []
        for item in items:
            try:
                r = self._ingest_single(item, default_source)
                results.append(r)
            except Exception as e:
                results.append(IngestResult(status="error", detail=str(e)))

        created = sum(1 for r in results if r.status == "created")
        skipped = sum(1 for r in results if r.status == "skipped_duplicate")
        errors = sum(1 for r in results if r.status == "error")
        return BatchIngestResult(
            total=len(items), created=created, skipped=skipped, errors=errors, results=results,
        )

    def _ingest_single(self, item: ImportItem, default_source: str) -> IngestResult:
        # 去重
        if item.external_id and self._has_external_id(item.external_id):
            return IngestResult(status="skipped_duplicate", detail=f"external_id={item.external_id}")

        source = item.source if item.source != "manual" else default_source
        event_type = item.event_type
        event_layer = item.event_layer or infer_event_layer(event_type)
        started_at = item.started_at or utc_now()

        event = WorkEvent(
            event_layer=event_layer,
            source=source,
            event_type=event_type,
            title=item.title[:200],
            content=item.content,
            project=item.project,
            tags=item.tags,
            duration_minutes=item.duration_minutes,
            outcome=item.outcome,
            started_at=started_at,
            collector_metadata={
                "collector": source,
                "external_id": item.external_id,
                **item.metadata,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    # ── Shell Command ───────────────────────────────

    def ingest_shell_command(self, payload: ShellCommandPayload) -> IngestResult:
        """处理单条 shell 命令：过滤噪声 → 推断类型 → 去重 → 入库。"""
        # 噪声过滤
        if _is_noise_command(payload.command):
            return IngestResult(status="skipped_duplicate", detail="noise command filtered")

        # 去重：短时间内相同命令不重复
        if self._has_shell_command(payload.command, payload.executed_at):
            return IngestResult(status="skipped_duplicate", detail="duplicate command")

        event_type, title, auto_tags = _infer_shell_event(payload.command)
        project = self._infer_project(payload.cwd)
        started_at = payload.executed_at or utc_now()

        # 非零退出码标记为 debug 类
        outcome = "resolved" if payload.exit_code == 0 else "failed"
        if payload.exit_code != 0:
            auto_tags.append("error-exit")

        event = WorkEvent(
            event_layer=infer_event_layer(event_type),
            source="shell",
            event_type=event_type,
            title=title,
            content=payload.command,
            project=project,
            tags=auto_tags + ([payload.shell_type] if payload.shell_type else []),
            duration_minutes=0,
            outcome=outcome,
            started_at=started_at,
            collector_metadata={
                "collector": "shell",
                "command": payload.command,
                "exit_code": payload.exit_code,
                "cwd": payload.cwd,
                "shell_type": payload.shell_type,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    def ingest_shell_batch(self, commands: list[ShellCommandPayload], source: str = "shell") -> BatchIngestResult:
        """批量导入 shell 命令（历史文件解析或离线缓冲区补发）。"""
        results: list[IngestResult] = []
        for cmd in commands:
            try:
                r = self.ingest_shell_command(cmd)
                results.append(r)
            except Exception as e:
                results.append(IngestResult(status="error", detail=str(e)))

        created = sum(1 for r in results if r.status == "created")
        skipped = sum(1 for r in results if r.status == "skipped_duplicate")
        errors = sum(1 for r in results if r.status == "error")
        return BatchIngestResult(
            total=len(commands), created=created, skipped=skipped, errors=errors, results=results,
        )

    # ── ActivityWatch ────────────────────────────────

    def ingest_activitywatch_batch(
        self, events: list[ActivityWatchEventPayload],
    ) -> BatchIngestResult:
        """批量导入 ActivityWatch 事件。

        流程：按 (app, title) 聚合相邻事件为 session → 分类 → 去重 → 入库。
        """
        # 1. 按 (app, title) 聚合相邻事件为 session
        sessions = self._aggregate_aw_sessions(events)

        results: list[IngestResult] = []
        for session in sessions:
            try:
                r = self._ingest_aw_session(session)
                results.append(r)
            except Exception as e:
                results.append(IngestResult(status="error", detail=str(e)))

        created = sum(1 for r in results if r.status == "created")
        skipped = sum(1 for r in results if r.status == "skipped_duplicate")
        errors = sum(1 for r in results if r.status == "error")
        return BatchIngestResult(
            total=len(sessions), created=created, skipped=skipped, errors=errors, results=results,
        )

    @staticmethod
    def _aggregate_aw_sessions(
        events: list[ActivityWatchEventPayload], gap_seconds: float = 300,
    ) -> list[dict]:
        """将相邻同 (app, title) 事件聚合为 session。

        gap_seconds: 间隔超过此值则视为不同 session（默认 5 分钟）。
        """
        if not events:
            return []

        # 按 timestamp 排序
        sorted_events = sorted(events, key=lambda e: e.timestamp or utc_now())

        sessions: list[dict] = []
        current: dict | None = None

        for ev in sorted_events:
            key = (ev.app.lower().strip(), ev.title.strip() if ev.title else "")
            ts = ev.timestamp or utc_now()
            dur = ev.duration_seconds

            if current and current["_key"] == key:
                # 检查时间间隔是否在 gap 内
                gap = (ts - current["_end"]).total_seconds()
                if gap <= gap_seconds:
                    # 合并到当前 session
                    current["duration_seconds"] += dur
                    current["_end"] = ts + __import__("datetime").timedelta(seconds=dur)
                    if ev.url and not current.get("url"):
                        current["url"] = ev.url
                    continue

            # 新 session
            if current:
                sessions.append(current)
            from datetime import timedelta
            current = {
                "_key": key,
                "app": ev.app,
                "title": ev.title,
                "url": ev.url,
                "started_at": ts,
                "duration_seconds": dur,
                "_end": ts + timedelta(seconds=dur),
            }

        if current:
            sessions.append(current)

        return sessions

    def _ingest_aw_session(self, session: dict) -> IngestResult:
        """将一个 ActivityWatch session 转为 WorkEvent。"""
        app = session["app"]
        title = session.get("title", "")
        url = session.get("url")
        started_at = session["started_at"]
        duration_sec = session["duration_seconds"]
        duration_min = max(1, round(duration_sec / 60))  # 至少 1 分钟

        # 过滤太短的 session（< 30 秒视为噪声）
        if duration_sec < 30:
            return IngestResult(status="skipped_duplicate", detail=f"too short ({duration_sec:.0f}s)")

        # 去重：检查时间窗口重叠
        if self._has_aw_overlap(app, title, started_at, duration_sec):
            return IngestResult(
                status="skipped_duplicate",
                detail=f"overlaps existing: {app} {title[:30]}",
            )

        # 分类
        event_type, display_title, auto_tags = _infer_aw_event(app, title, url)
        project = _infer_project_from_title(title, url)

        event = WorkEvent(
            event_layer="habit",
            source="activitywatch",
            event_type=event_type,
            title=display_title[:200],
            content=f"App: {app}\nTitle: {title}" + (f"\nURL: {url}" if url else ""),
            project=project,
            tags=auto_tags + ["activitywatch"],
            duration_minutes=duration_min,
            outcome="resolved",
            started_at=started_at,
            collector_metadata={
                "collector": "activitywatch",
                "app": app,
                "window_title": title,
                "url": url,
                "duration_seconds": duration_sec,
            },
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        index_event(event)
        return IngestResult(event_id=event.id, status="created")

    # ── Dedup helpers ───────────────────────────────

    def _has_git_commit(self, sha: str) -> bool:
        """检查是否已有同一 SHA 的 git 事件。"""
        stmt = select(WorkEvent).where(
            WorkEvent.source == "git",
            WorkEvent.collector_metadata.isnot(None),
        )
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("ref", "").startswith(sha) or sha.startswith(meta.get("ref", "")):
                return True
        return False

    def _has_external_id(self, external_id: str) -> bool:
        """检查是否已有同一 external_id 的事件。"""
        stmt = select(WorkEvent).where(WorkEvent.collector_metadata.isnot(None))
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("external_id") == external_id:
                return True
        return False

    def _has_shell_command(self, command: str, executed_at: datetime | None) -> bool:
        """短时间窗口（60s）内相同命令去重。"""
        if executed_at is None:
            return False
        from datetime import timedelta
        window_start = executed_at - timedelta(seconds=60)
        stmt = select(WorkEvent).where(
            WorkEvent.source == "shell",
            WorkEvent.started_at >= window_start,
            WorkEvent.started_at <= executed_at,
            WorkEvent.collector_metadata.isnot(None),
        )
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("command") == command:
                return True
        return False

    def _has_aw_overlap(self, app: str, title: str, started_at: datetime, duration_sec: float) -> bool:
        """检查 ActivityWatch session 是否与已有事件时间窗口重叠。

        同 app 在 session 时间段内有重叠即视为重复。
        """
        from datetime import timedelta
        end_at = started_at + timedelta(seconds=duration_sec)
        # 统一为 naive datetime 避免 tz-aware/naive 比较报错
        end_at_naive = end_at.replace(tzinfo=None)
        started_naive = started_at.replace(tzinfo=None)
        stmt = select(WorkEvent).where(
            WorkEvent.source == "activitywatch",
            WorkEvent.started_at < end_at_naive,
            WorkEvent.collector_metadata.isnot(None),
        )
        events = list(self.db.execute(stmt).scalars())
        for ev in events:
            meta = ev.collector_metadata or {}
            if meta.get("app", "").lower() == app.lower():
                ev_dur = meta.get("duration_seconds", 0)
                ev_start = ev.started_at
                if ev_start:
                    ev_start_naive = ev_start.replace(tzinfo=None) if ev_start.tzinfo else ev_start
                    ev_end = ev_start_naive + timedelta(seconds=ev_dur)
                    # 时间窗口重叠判断
                    if started_naive < ev_end and end_at_naive > ev_start_naive:
                        return True
        return False

    @staticmethod
    def _infer_project(cwd: str | None) -> str | None:
        """从工作目录推断项目名（取最后一级目录）。"""
        if not cwd:
            return None
        parts = cwd.replace("\\", "/").rstrip("/").rsplit("/", 1)
        return parts[-1] if parts else None
