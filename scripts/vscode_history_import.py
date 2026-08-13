#!/usr/bin/env python3
"""EvoWork-AI VS Code 编辑历史导入工具 — 从 VS Code 工作区数据批量回溯。

扫描 VS Code 的 workspaceStorage 目录，从 recentlyUsed.json 和 backups/
中提取最近的编辑活动，作为 IDE 事件批量导入。

用法:
    # 自动检测 VS Code 并导入最近 7 天
    python vscode_history_import.py

    # 指定时间范围
    python vscode_history_import.py --hours 168

    # 指定 VS Code 用户目录
    python vscode_history_import.py --vscode-dir /path/to/Code/User

    # 仅预览
    python vscode_history_import.py --dry-run
"""

import argparse
import json
import os
import platform
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

EVOWORK_IDE_API = os.environ.get(
    "EVOWORK_IDE_API", "http://127.0.0.1:8000/api/collect/ide"
)
DEFAULT_BATCH_SIZE = 100

# 文件扩展名 → 编程语言映射
_EXT_LANG_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "typescript", ".jsx": "javascript", ".rs": "rust",
    ".go": "go", ".java": "java", ".cpp": "cpp", ".c": "c",
    ".h": "c", ".hpp": "cpp", ".cs": "csharp", ".rb": "ruby",
    ".php": "php", ".swift": "swift", ".kt": "kotlin",
    ".scala": "scala", ".html": "html", ".css": "css",
    ".scss": "scss", ".less": "less", ".json": "json",
    ".yaml": "yaml", ".yml": "yaml", ".toml": "toml",
    ".md": "markdown", ".sql": "sql", ".sh": "shell",
    ".ps1": "powershell", ".bat": "batch", ".dockerfile": "docker",
    ".xml": "xml", ".vue": "vue", ".svelte": "svelte",
    ".lua": "lua", ".r": "r", ".dart": "dart",
}


def _detect_language(file_path: str) -> str:
    """从文件扩展名推断编程语言。"""
    ext = Path(file_path).suffix.lower()
    if ext in _EXT_LANG_MAP:
        return _EXT_LANG_MAP[ext]
    # 特殊文件名
    name = Path(file_path).name.lower()
    if name == "dockerfile":
        return "docker"
    if name == "makefile":
        return "makefile"
    if name.endswith(".test.ts") or name.endswith(".spec.ts"):
        return "typescript"
    return ""


def _extract_project_name(workspace_path: str) -> str:
    """从 workspace 路径中提取项目名。"""
    # VS Code 工作区路径可能是 file:///path 或纯路径
    path = workspace_path.replace("file:///", "").replace("file://", "")
    # Windows 路径处理
    if platform.system() == "Windows" and len(path) > 1 and path[1] == ":":
        pass  # already a path
    return Path(path).name if path else "unknown"


def _find_vscode_user_dir() -> Path | None:
    """自动检测 VS Code 用户目录。"""
    system = platform.system()

    if system == "Windows":
        appdata = os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming"))
        candidates = [
            Path(appdata) / "Code" / "User",
            Path(appdata) / "Code - Insiders" / "User",
        ]
    elif system == "Darwin":
        candidates = [
            Path.home() / "Library" / "Application Support" / "Code" / "User",
        ]
    else:  # Linux
        candidates = [
            Path.home() / ".config" / "Code" / "User",
            Path.home() / ".config" / "Code - Insiders" / "User",
        ]

    for c in candidates:
        if c.exists():
            return c
    return None


def _scan_local_history(user_dir: Path, cutoff: datetime | None) -> list[dict]:
    """扫描 VS Code 的 History/ 目录获取文件编辑历史。

    VS Code 在 User/History/ 下为每个追踪过的文件创建一个目录：
    - entries.json: {"resource": "file:///...", "entries": [{"id": "xxx", "timestamp": 123}]}
    - {id}/ : 该时间点的文件内容备份（可选，可能已被清理）
    """
    events: list[dict] = []
    history_dir = user_dir / "History"
    if not history_dir.exists():
        print(f"[EvoWork] History directory not found: {history_dir}")
        return events

    for file_dir in history_dir.iterdir():
        if not file_dir.is_dir():
            continue

        entries_json = file_dir / "entries.json"
        if not entries_json.exists():
            continue

        try:
            data = json.loads(entries_json.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        # 解析原始文件路径
        resource = data.get("resource", "")
        if not resource:
            continue

        # 解码 file URL: file:///d%3A/yl/project/... → d:/yl/project/...
        try:
            from urllib.parse import unquote
            file_path = unquote(resource.replace("file:///", "").replace("file://", ""))
        except Exception:
            file_path = resource

        if not file_path:
            continue

        # 推断项目名（取路径中常见的项目标识）
        project_name = "unknown"
        path_parts = Path(file_path).parts
        # 尝试从路径中识别项目名：通常在 project/ 或 workspace/ 后面
        for i, part in enumerate(path_parts):
            if part.lower() in ("project", "projects", "workspace", "workspaces", "dev", "code", "repos", "src"):
                if i + 1 < len(path_parts):
                    project_name = path_parts[i + 1]
                    break
        if project_name == "unknown" and len(path_parts) >= 2:
            # 回退：用倒数第二级目录名
            project_name = path_parts[-2] if path_parts[-2] != file_dir.name else path_parts[-3] if len(path_parts) >= 3 else "unknown"

        language = _detect_language(file_path)

        # 处理每条 history entry
        for entry in data.get("entries", []):
            if not isinstance(entry, dict):
                continue

            ts_ms = entry.get("timestamp", 0)
            if not ts_ms:
                continue

            try:
                ts = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            except (ValueError, OSError, OverflowError):
                continue

            if cutoff and ts < cutoff:
                continue

            events.append({
                "file_path": file_path,
                "language": language,
                "action": "save",
                "project": project_name,
                "duration_seconds": 60,
                "lines_changed": 0,
                "timestamp": ts.isoformat(),
                "editor": "vscode",
            })

    return events


def _scan_recent_files(user_dir: Path, cutoff: datetime | None) -> list[dict]:
    """扫描 VS Code 的 recently-opened 状态文件。

    尝试从 state.vscdb（SQLite）或 JSON 文件中读取最近打开的文件列表。
    """
    events: list[dict] = []

    # 尝试从 globalStorage 中查找
    global_storage = user_dir / "globalStorage"
    if global_storage.exists():
        for state_file in global_storage.rglob("state.vscdb"):
            try:
                import sqlite3
                conn = sqlite3.connect(str(state_file))
                cursor = conn.cursor()
                cursor.execute("SELECT key, value FROM ItemTable WHERE key LIKE '%recent%'")
                for key, value in cursor.fetchall():
                    try:
                        data = json.loads(value)
                        if isinstance(data, list):
                            for item in data:
                                if isinstance(item, dict) and "path" in item:
                                    events.append({
                                        "file_path": item["path"],
                                        "language": _detect_language(item["path"]),
                                        "action": "open",
                                        "project": "unknown",
                                        "duration_seconds": 60,
                                        "lines_changed": 0,
                                        "timestamp": datetime.now(timezone.utc).isoformat(),
                                        "editor": "vscode",
                                    })
                    except (json.JSONDecodeError, TypeError):
                        pass
                conn.close()
            except Exception:
                pass

    return events


def send_events(events: list[dict], dry_run: bool = False) -> None:
    """分批发送到 EvoWork-AI IDE 采集端点。"""
    total = len(events)
    created = 0
    skipped = 0
    errors = 0

    for start in range(0, total, DEFAULT_BATCH_SIZE):
        batch = events[start:start + DEFAULT_BATCH_SIZE]
        payload = {
            "source": "ide",
            "events": batch,
        }

        if dry_run:
            created += len(batch)
            continue

        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                EVOWORK_IDE_API,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=30)
            result = json.loads(resp.read())
            created += result.get("created", 0)
            skipped += result.get("skipped", 0)
            errors += result.get("errors", 0)
        except Exception as e:
            print(f"[EvoWork] Batch {start // DEFAULT_BATCH_SIZE + 1} failed: {e}", file=sys.stderr)
            errors += len(batch)

    print(f"\n[EvoWork] VS Code history import complete:")
    print(f"  Total:    {total}")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped}")
    print(f"  Errors:   {errors}")
    if dry_run:
        print("  (dry-run mode, no data was sent)")


def main():
    parser = argparse.ArgumentParser(description="Import VS Code editing history to EvoWork-AI")
    parser.add_argument("--vscode-dir", type=str, help="Path to VS Code User directory")
    parser.add_argument("--hours", type=int, default=168, help="Import events from the last N hours (default: 168 = 7 days)")
    parser.add_argument("--dry-run", action="store_true", help="Scan but don't send")
    args = parser.parse_args()

    # 检测 VS Code 目录
    if args.vscode_dir:
        user_dir = Path(args.vscode_dir).expanduser()
    else:
        user_dir = _find_vscode_user_dir()
        if not user_dir:
            print("[EvoWork] VS Code User directory not found. Use --vscode-dir to specify.")
            print("  Common locations:")
            print("    Windows: %APPDATA%\\Code\\User")
            print("    macOS:   ~/Library/Application Support/Code/User")
            print("    Linux:   ~/.config/Code/User")
            return

    print(f"[EvoWork] VS Code User directory: {user_dir}")

    cutoff = None
    if args.hours:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)
        print(f"[EvoWork] Cutoff: {cutoff.isoformat()[:16]} (last {args.hours}h)")

    # 扫描 History/ 目录（VS Code 本地文件历史）
    print(f"[EvoWork] Scanning History: {user_dir / 'History'}")
    events = _scan_local_history(user_dir, cutoff)
    print(f"[EvoWork] From local history: {len(events)} events")

    # 扫描全局 recent files
    recent = _scan_recent_files(user_dir, cutoff)
    print(f"[EvoWork] From global recent: {len(recent)} events")
    events.extend(recent)

    # 按时间排序（最新优先）
    events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)

    print(f"[EvoWork] Total events: {len(events)}")

    if not events:
        print("[EvoWork] No events to import")
        return

    # 预览
    if args.dry_run:
        projects = {}
        for e in events:
            p = e.get("project", "unknown")
            projects[p] = projects.get(p, 0) + 1
        print(f"\n[EvoWork] Projects found:")
        for name, count in sorted(projects.items(), key=lambda x: -x[1])[:15]:
            print(f"  {name}: {count} events")

        print(f"\n[EvoWork] Preview (top 15 by lines_changed):")
        top = sorted(events, key=lambda e: -e["lines_changed"])[:15]
        for e in top:
            ts = e["timestamp"][:16] if e["timestamp"] else "no-time"
            lang = e["language"] or "?"
            print(f"  {ts} | {e['action']:<5} | {lang:<12} | {e['project']:<20} | {e['file_path'][-40:]}")

    send_events(events, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
