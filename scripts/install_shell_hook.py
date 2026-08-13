#!/usr/bin/env python3
"""EvoWork-AI Shell Hook 安装器 — 将 shell hook 追加到 .bashrc / .zshrc。

用法:
    python install_shell_hook.py [--uninstall] [--shell bash|zsh|auto]

自动检测用户默认 shell，在对应 rc 文件末尾追加 source 行。
"""

import argparse
import os
import sys
from pathlib import Path

HOOK_SCRIPT = Path(__file__).resolve().parent / "shell_hook.sh"
SOURCE_LINE_TEMPLATE = '\n# EvoWork-AI Shell Hook\n[ -f "{hook}" ] && source "{hook}"\n'
MARKER = "# EvoWork-AI Shell Hook"


def _detect_shell() -> str:
    """检测用户默认 shell。"""
    shell = os.environ.get("SHELL", "")
    if "zsh" in shell:
        return "zsh"
    return "bash"


def _get_rc_file(shell_type: str) -> Path:
    """返回 shell rc 文件路径。"""
    home = Path.home()
    if shell_type == "zsh":
        return home / ".zshrc"
    return home / ".bashrc"


def _is_installed(rc_file: Path) -> bool:
    """检查是否已安装。"""
    if not rc_file.exists():
        return False
    return MARKER in rc_file.read_text(encoding="utf-8")


def install(shell_type: str) -> None:
    rc_file = _get_rc_file(shell_type)
    hook_path = str(HOOK_SCRIPT).replace("\\", "/")

    if _is_installed(rc_file):
        print(f"[EvoWork] Shell hook already installed in {rc_file}")
        return

    # 确保 rc 文件存在
    if not rc_file.exists():
        rc_file.touch()

    source_line = SOURCE_LINE_TEMPLATE.format(hook=hook_path)
    with open(rc_file, "a", encoding="utf-8") as f:
        f.write(source_line)

    print(f"[EvoWork] Shell hook installed in {rc_file}")
    print(f"[EvoWork] Hook script: {hook_path}")
    print(f"[EvoWork] Restart your shell or run: source {rc_file}")
    print()
    print("  Configuration (env vars):")
    print("    EVOWORK_SHELL_API    — API endpoint (default: http://127.0.0.1:8000/api/collect/shell)")
    print("    EVOWORK_SHELL_ENABLED — Set to 0 to disable (default: 1)")
    print()


def uninstall(shell_type: str) -> None:
    rc_file = _get_rc_file(shell_type)

    if not rc_file.exists() or not _is_installed(rc_file):
        print(f"[EvoWork] Shell hook not found in {rc_file}")
        return

    lines = rc_file.read_text(encoding="utf-8").splitlines(keepends=True)
    new_lines = []
    skip_next = False
    for line in lines:
        if MARKER in line:
            skip_next = True
            continue
        if skip_next and 'source "' in line:
            skip_next = False
            continue
        new_lines.append(line)

    rc_file.write_text("".join(new_lines), encoding="utf-8")
    print(f"[EvoWork] Shell hook removed from {rc_file}")


def main():
    parser = argparse.ArgumentParser(description="Install EvoWork-AI shell hook")
    parser.add_argument("--uninstall", action="store_true", help="Remove the shell hook")
    parser.add_argument(
        "--shell",
        choices=["bash", "zsh", "auto"],
        default="auto",
        help="Target shell (default: auto-detect)",
    )
    args = parser.parse_args()

    shell_type = _detect_shell() if args.shell == "auto" else args.shell
    print(f"[EvoWork] Detected shell: {shell_type}")

    if args.uninstall:
        uninstall(shell_type)
    else:
        install(shell_type)


if __name__ == "__main__":
    main()
