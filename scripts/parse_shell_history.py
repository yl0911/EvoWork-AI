#!/usr/bin/env python3
"""EvoWork-AI Shell 历史文件解析器 — 从 ~/.bash_history / ~/.zsh_history 批量回溯命令。

用法:
    # 自动检测并解析最近的 500 条命令
    python parse_shell_history.py

    # 指定文件和数量
    python parse_shell_history.py --file ~/.bash_history --limit 1000

    # 仅解析，不发送（dry-run）
    python parse_shell_history.py --dry-run

    # 指定时间范围（最近 N 小时内的命令）
    python parse_shell_history.py --hours 24
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

EVOWORK_SHELL_BATCH_API = os.environ.get(
    "EVOWORK_SHELL_BATCH_API", "http://127.0.0.1:8000/api/collect/shell/batch"
)
DEFAULT_BATCH_SIZE = 100  # 每批发送数量


def _detect_history_file() -> tuple[Path, str]:
    """自动检测当前 shell 的历史文件。"""
    home = Path.home()
    shell = os.environ.get("SHELL", "bash")

    if "zsh" in shell:
        return home / ".zsh_history", "zsh"
    return home / ".bash_history", "bash"


def parse_bash_history(path: Path, limit: int | None = None) -> list[dict]:
    """解析 bash 历史文件。

    bash 历史格式（带 HISTTIMEFORMAT 时）:
        #1234567890
        command text

    不带时间戳时:
        command text
    """
    if not path.exists():
        print(f"[EvoWork] History file not found: {path}")
        return []

    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    commands: list[dict] = []
    i = 0

    while i < len(lines):
        line = lines[i]

        # bash 时间戳行: #EPOCH
        if line.startswith("#") and line[1:].isdigit():
            timestamp = int(line[1:])
            i += 1
            if i < len(lines):
                cmd = lines[i].strip()
                if cmd:
                    commands.append({
                        "command": cmd,
                        "executed_at": datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(),
                    })
        else:
            # 无时间戳的行
            cmd = line.strip()
            if cmd:
                commands.append({"command": cmd, "executed_at": None})
        i += 1

    if limit:
        commands = commands[-limit:]
    return commands


def parse_zsh_history(path: Path, limit: int | None = None) -> list[dict]:
    """解析 zsh 历史文件。

    zsh EXTENDED_HISTORY 格式:
        : 1234567890:0;command text

    普通格式:
        command text
    """
    if not path.exists():
        print(f"[EvoWork] History file not found: {path}")
        return []

    content = path.read_text(encoding="utf-8", errors="replace")
    # zsh 可能用 \0 分隔
    lines = content.replace("\x00", "\n").splitlines()

    zsh_pattern = re.compile(r"^:\s*(\d+):\d+;(.+)$")
    commands: list[dict] = []

    for line in lines:
        m = zsh_pattern.match(line)
        if m:
            timestamp = int(m.group(1))
            cmd = m.group(2).strip()
            if cmd:
                commands.append({
                    "command": cmd,
                    "executed_at": datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(),
                })
        else:
            cmd = line.strip()
            if cmd and not cmd.startswith(":"):
                commands.append({"command": cmd, "executed_at": None})

    if limit:
        commands = commands[-limit:]
    return commands


def send_batch(commands: list[dict], shell_type: str, dry_run: bool = False) -> None:
    """分批发送到 EvoWork-AI 采集服务。"""
    total = len(commands)
    sent = 0
    created = 0
    skipped = 0
    errors = 0

    for start in range(0, total, DEFAULT_BATCH_SIZE):
        batch = commands[start:start + DEFAULT_BATCH_SIZE]
        payload = {
            "source": f"shell_history_{shell_type}",
            "commands": [
                {
                    "command": c["command"],
                    "exit_code": 0,
                    "cwd": None,
                    "shell_type": shell_type,
                    "executed_at": c.get("executed_at"),
                }
                for c in batch
            ],
        }

        if dry_run:
            sent += len(batch)
            created += len(batch)
            continue

        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                EVOWORK_SHELL_BATCH_API,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=30)
            result = json.loads(resp.read())
            sent += len(batch)
            created += result.get("created", 0)
            skipped += result.get("skipped", 0)
            errors += result.get("errors", 0)
        except Exception as e:
            print(f"[EvoWork] Batch {start // DEFAULT_BATCH_SIZE + 1} failed: {e}", file=sys.stderr)
            errors += len(batch)

    print(f"[EvoWork] History import complete:")
    print(f"  Total:    {total}")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped} (duplicates/noise)")
    print(f"  Errors:   {errors}")
    if dry_run:
        print("  (dry-run mode, no data was sent)")


def main():
    parser = argparse.ArgumentParser(description="Parse and import shell history to EvoWork-AI")
    parser.add_argument("--file", type=str, help="Path to shell history file")
    parser.add_argument("--shell", choices=["bash", "zsh", "auto"], default="auto")
    parser.add_argument("--limit", type=int, default=500, help="Max commands to import (default: 500)")
    parser.add_argument("--hours", type=int, help="Only import commands from the last N hours")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't send")
    args = parser.parse_args()

    # 检测历史文件
    if args.file:
        history_path = Path(args.file).expanduser()
        shell_type = args.shell if args.shell != "auto" else "bash"
    else:
        history_path, shell_type = _detect_history_file()
        if args.shell != "auto":
            shell_type = args.shell
            if shell_type == "zsh":
                history_path = Path.home() / ".zsh_history"
            else:
                history_path = Path.home() / ".bash_history"

    print(f"[EvoWork] Shell: {shell_type}")
    print(f"[EvoWork] History file: {history_path}")

    # 解析
    if shell_type == "zsh":
        commands = parse_zsh_history(history_path, limit=args.limit)
    else:
        commands = parse_bash_history(history_path, limit=args.limit)

    print(f"[EvoWork] Parsed {len(commands)} commands")

    # 时间过滤
    if args.hours and commands:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=args.hours)
        filtered = []
        for c in commands:
            if c.get("executed_at"):
                try:
                    ts = datetime.fromisoformat(c["executed_at"])
                    if ts >= cutoff:
                        filtered.append(c)
                except (ValueError, TypeError):
                    filtered.append(c)  # 无时间戳的保留
            else:
                filtered.append(c)
        print(f"[EvoWork] After time filter (last {args.hours}h): {len(filtered)} commands")
        commands = filtered

    if not commands:
        print("[EvoWork] No commands to import")
        return

    # 发送
    send_batch(commands, shell_type, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
