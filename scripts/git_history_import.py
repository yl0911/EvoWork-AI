#!/usr/bin/env python3
"""EvoWork-AI Git 历史回溯工具 — 从 git log 批量导入提交记录。

用法:
    # 当前仓库最近 200 条提交
    python git_history_import.py

    # 指定仓库
    python git_history_import.py --repo /path/to/repo

    # 扫描父目录下所有 git 仓库
    python git_history_import.py --all-repos --repo D:/yl/project

    # 按作者过滤
    python git_history_import.py --author yelei

    # 最近 7 天
    python git_history_import.py --hours 168

    # 仅预览，不发送
    python git_history_import.py --dry-run
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

EVOWORK_GIT_API = os.environ.get(
    "EVOWORK_GIT_API", "http://127.0.0.1:8000/api/collect/git"
)
DEFAULT_BATCH_SIZE = 50


def _run_git(repo_path: Path, *args: str) -> str:
    return subprocess.check_output(
        ["git"] + list(args), cwd=str(repo_path), stderr=subprocess.DEVNULL
    ).decode("utf-8", errors="replace").strip()


def parse_git_log(
    repo_path: Path,
    limit: int = 200,
    author: str | None = None,
    hours: int | None = None,
) -> list[dict]:
    """从 git log 解析提交记录。"""
    repo_path = Path(repo_path).resolve()
    if not (repo_path / ".git").exists():
        print(f"[EvoWork] Not a git repository: {repo_path}")
        return []

    try:
        repo_name = repo_path.name
    except Exception:
        repo_name = "unknown"

    # 使用唯一记录分隔符，%x00 输出 NUL 字符
    cmd = [
        "log",
        f"--max-count={limit}",
        "--format=%x00%H%n%s%n%an%n%ae%n%aI%nBODY%n%B%nENDBODY",
    ]

    if author:
        cmd.append(f"--author={author}")
    if hours:
        since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        cmd.append(f"--since={since}")

    try:
        output = _run_git(repo_path, *cmd)
    except subprocess.CalledProcessError as e:
        print(f"[EvoWork] git log failed: {e}")
        return []

    if not output:
        return []

    commits: list[dict] = []
    # 按 NUL 分隔每条记录
    records = output.split("\x00")

    for record in records:
        record = record.strip()
        if not record:
            continue
        lines = record.split("\n")
        if len(lines) < 5:
            continue

        sha = lines[0].strip()
        subject = lines[1].strip()
        author_name = lines[2].strip()
        author_email = lines[3].strip()
        committed_at = lines[4].strip()

        if not sha or len(sha) < 7:
            continue

        # 提取 commit body（BODY 和 ENDBODY 之间的内容）
        message = subject  # 默认用 subject
        try:
            body_start = lines.index("BODY") + 1
            body_end = lines.index("ENDBODY")
            body_lines = lines[body_start:body_end]
            if body_lines:
                full_body = "\n".join(body_lines).strip()
                if full_body:
                    message = full_body
        except ValueError:
            pass  # BODY/ENDBODY 标记不存在，使用 subject

        # 获取变更文件列表
        files_changed: list[str] = []
        insertions = deletions = 0
        try:
            diff_out = _run_git(repo_path, "diff", "--name-only", f"{sha}~1", sha)
            files_changed = [f for f in diff_out.split("\n") if f]
        except (subprocess.CalledProcessError, Exception):
            pass  # 首次提交或 merge commit 可能失败

        try:
            stat = _run_git(repo_path, "diff", "--shortstat", f"{sha}~1", sha)
            import re
            m_ins = re.search(r"(\d+) insertion", stat)
            m_del = re.search(r"(\d+) deletion", stat)
            if m_ins:
                insertions = int(m_ins.group(1))
            if m_del:
                deletions = int(m_del.group(1))
        except (subprocess.CalledProcessError, Exception):
            pass

        # 尝试获取当前分支
        branch = None
        try:
            branch = _run_git(repo_path, "branch", "--show-current")
        except (subprocess.CalledProcessError, Exception):
            pass

        commits.append({
            "sha": sha,
            "message": message,
            "author_name": author_name,
            "author_email": author_email,
            "branch": branch or None,
            "repo_name": repo_name,
            "files_changed": files_changed[:30],  # 限制数量避免 payload 过大
            "insertions": insertions,
            "deletions": deletions,
            "committed_at": committed_at,
        })

    return commits


def send_commits(commits: list[dict], dry_run: bool = False) -> None:
    """逐条发送到 EvoWork-AI（git endpoint 是单条接口）。"""
    total = len(commits)
    created = 0
    skipped = 0
    errors = 0

    for i, commit in enumerate(commits):
        if dry_run:
            created += 1
            continue

        try:
            data = json.dumps(commit).encode("utf-8")
            req = urllib.request.Request(
                EVOWORK_GIT_API,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            resp = urllib.request.urlopen(req, timeout=10)
            result = json.loads(resp.read())
            status = result.get("status", "unknown")
            if status == "created":
                created += 1
            elif status == "skipped_duplicate":
                skipped += 1
            else:
                errors += 1
        except Exception as e:
            errors += 1
            if errors <= 3:  # 只打印前 3 个错误
                print(f"[EvoWork] Commit {commit['sha'][:8]} failed: {e}", file=sys.stderr)

        # 进度
        if (i + 1) % 50 == 0:
            print(f"[EvoWork] Progress: {i + 1}/{total}")

    print(f"\n[EvoWork] Git history import complete:")
    print(f"  Total:    {total}")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped} (duplicates)")
    print(f"  Errors:   {errors}")
    if dry_run:
        print("  (dry-run mode, no data was sent)")


def main():
    parser = argparse.ArgumentParser(description="Import git log history to EvoWork-AI")
    parser.add_argument("--repo", type=str, help="Path to git repository (default: cwd)")
    parser.add_argument("--author", type=str, help="Filter by author name or email")
    parser.add_argument("--limit", type=int, default=200, help="Max commits to import (default: 200)")
    parser.add_argument("--hours", type=int, help="Only import commits from the last N hours")
    parser.add_argument("--all-repos", action="store_true", help="Scan all repos in a parent directory")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't send")
    args = parser.parse_args()

    if args.all_repos:
        parent = Path(args.repo).resolve() if args.repo else Path.cwd().parent
        if not parent.is_dir():
            print(f"[EvoWork] Directory not found: {parent}")
            return
        repos = sorted(d for d in parent.iterdir() if d.is_dir() and (d / ".git").exists())
        print(f"[EvoWork] Found {len(repos)} repos in {parent}")
        all_commits: list[dict] = []
        for repo_path in repos:
            commits = parse_git_log(repo_path, limit=args.limit, author=args.author, hours=args.hours)
            print(f"  {repo_path.name}: {len(commits)} commits")
            all_commits.extend(commits)
    else:
        repo_path = Path(args.repo).resolve() if args.repo else Path.cwd()
        print(f"[EvoWork] Repository: {repo_path}")
        all_commits = parse_git_log(repo_path, limit=args.limit, author=args.author, hours=args.hours)

    print(f"[EvoWork] Total commits: {len(all_commits)}")

    if not all_commits:
        print("[EvoWork] No commits to import")
        return

    # 预览
    if args.dry_run:
        print(f"\n[EvoWork] Preview (top 10):")
        for c in all_commits[:10]:
            msg_line = c["message"].split("\n")[0][:60]
            ts = c.get("committed_at", "")[:16]
            print(f"  {c['sha'][:8]} | {ts} | {c['repo_name']} | {msg_line}")
        if len(all_commits) > 10:
            print(f"  ... ({len(all_commits)} total)")

    send_commits(all_commits, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
