#!/usr/bin/env python3
"""将 EvoWork-AI post-commit hook 安装到目标 Git 仓库。

用法:
    python scripts/install_git_hook.py <repo_path>
    python scripts/install_git_hook.py                    # 安装到当前目录

示例:
    python scripts/install_git_hook.py D:/yl/project/capsolver-core
    python scripts/install_git_hook.py .
"""

import os
import stat
import sys
from pathlib import Path

SCRIPT_PATH = Path(__file__).resolve().parent / "git_hook_post_commit.py"

HOOK_TEMPLATE = """\
#!/bin/sh
# EvoWork-AI post-commit hook — 自动记录代码提交到 EvoWork-AI
python3 "{script_path}" &
"""

HOOK_TEMPLATE_WIN = """\
@echo off
REM EvoWork-AI post-commit hook — 自动记录代码提交到 EvoWork-AI
start /B python "{script_path}"
"""


def install(repo_path: str) -> None:
    git_dir = Path(repo_path) / ".git"
    if not git_dir.is_dir():
        print(f"Error: {repo_path} is not a git repository (no .git/ found)")
        sys.exit(1)

    hooks_dir = git_dir / "hooks"
    hooks_dir.mkdir(exist_ok=True)
    hook_file = hooks_dir / "post-commit"

    script_str = str(SCRIPT_PATH).replace("\\", "/")

    # Windows 用 .bat，其他用 shell
    if sys.platform == "win32":
        if not hook_file.exists():
            hook_file = hooks_dir / "post-commit"
            content = f"#!/bin/sh\n# EvoWork-AI post-commit hook\npython \"{script_str}\" &\n"
            hook_file.write_text(content, encoding="utf-8")
            # Git Bash on Windows 仍用 sh 格式
        else:
            existing = hook_file.read_text(encoding="utf-8")
            if "EvoWork-AI" in existing:
                print(f"Hook already installed in {repo_path}")
                return
            # 追加到已有 hook
            with open(hook_file, "a", encoding="utf-8") as f:
                f.write(f"\n# EvoWork-AI post-commit hook\npython \"{script_str}\" &\n")
    else:
        content = HOOK_TEMPLATE.format(script_path=script_str)
        if hook_file.exists():
            existing = hook_file.read_text()
            if "EvoWork-AI" in existing:
                print(f"Hook already installed in {repo_path}")
                return
            with open(hook_file, "a") as f:
                f.write(f"\n# EvoWork-AI post-commit hook\npython3 \"{script_str}\" &\n")
        else:
            hook_file.write_text(content)

    # 设置可执行权限
    hook_file.chmod(hook_file.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
    print(f"Installed post-commit hook in {repo_path}")
    print(f"  Hook script: {hook_file}")
    print(f"  Collector:   {SCRIPT_PATH}")


def main():
    if len(sys.argv) > 1:
        repo_path = sys.argv[1]
    else:
        repo_path = os.getcwd()

    repo_path = os.path.abspath(repo_path)
    install(repo_path)


if __name__ == "__main__":
    main()
