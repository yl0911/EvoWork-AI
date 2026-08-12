#!/usr/bin/env python3
"""Git post-commit hook: 将提交信息发送到 EvoWork-AI 采集器。

用法: 由 git post-commit hook 调用，无需手动运行。
配置: 修改 EVOBOOK_API 指向你的 EvoWork-AI 服务地址。
"""

import json
import re
import subprocess
import sys
import urllib.request

EVOBOOK_API = "http://127.0.0.1:8000/api/collect/git"


def _run_git(*args: str) -> str:
    return subprocess.check_output(["git"] + list(args)).decode("utf-8", errors="replace").strip()


def get_commit_info() -> dict:
    sha = _run_git("rev-parse", "HEAD")
    message = _run_git("log", "-1", "--format=%B")
    author_name = _run_git("log", "-1", "--format=%an")
    author_email = _run_git("log", "-1", "--format=%ae")

    try:
        branch = _run_git("branch", "--show-current")
    except subprocess.CalledProcessError:
        branch = ""

    try:
        repo_name = _run_git("rev-parse", "--show-toplevel").replace("\\", "/").rsplit("/", 1)[-1]
    except subprocess.CalledProcessError:
        repo_name = "unknown"

    # 变更文件列表
    files_changed: list[str] = []
    try:
        diff_out = _run_git("diff", "--name-only", "HEAD~1", "HEAD")
        files_changed = [f for f in diff_out.split("\n") if f]
    except subprocess.CalledProcessError:
        pass  # 首次提交没有 HEAD~1

    # 插入/删除行数
    insertions = deletions = 0
    try:
        stat = _run_git("diff", "--shortstat", "HEAD~1", "HEAD")
        m_ins = re.search(r"(\d+) insertion", stat)
        m_del = re.search(r"(\d+) deletion", stat)
        if m_ins:
            insertions = int(m_ins.group(1))
        if m_del:
            deletions = int(m_del.group(1))
    except subprocess.CalledProcessError:
        pass

    return {
        "sha": sha,
        "message": message,
        "author_name": author_name,
        "author_email": author_email,
        "branch": branch or None,
        "repo_name": repo_name,
        "files_changed": files_changed,
        "insertions": insertions,
        "deletions": deletions,
    }


def main():
    try:
        info = get_commit_info()
        data = json.dumps(info).encode("utf-8")
        req = urllib.request.Request(
            EVOBOOK_API,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        result = json.loads(resp.read())
        status = result.get("status", "unknown")
        print(f"[EvoWork] Commit {info['sha'][:8]} → {status}")
    except Exception as e:
        # 不阻断 commit 流程
        print(f"[EvoWork] Failed to record commit: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()
