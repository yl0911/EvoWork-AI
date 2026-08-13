#!/usr/bin/env python3
"""EvoWork-AI 数据采集器一键配置脚本。

在新机器上运行此脚本，自动配置所有可用的数据采集器：
  - Git post-commit hook（需要指定仓库路径）
  - Shell PROMPT_COMMAND hook
  - VSCode IDE 扩展（编译 + 生成 VSIX）
  - ActivityWatch 导入（生成 cron 配置建议）
  - Browser 扩展（打印安装指引）

用法:
  python scripts/setup_collectors.py
  python scripts/setup_collectors.py --server-url http://my-server:8000
  python scripts/setup_collectors.py --repos ~/project/a ~/project/b
  python scripts/setup_collectors.py --api-key my-secret-key
  python scripts/setup_collectors.py --skip-git --skip-vscode
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

# ── 项目根目录 ────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# ── ANSI colors ────────────────────────────────────────
IS_WIN = sys.platform == "win32"
GREEN = "\033[92m" if not IS_WIN else ""
YELLOW = "\033[93m" if not IS_WIN else ""
RED = "\033[91m" if not IS_WIN else ""
CYAN = "\033[96m" if not IS_WIN else ""
BOLD = "\033[1m" if not IS_WIN else ""
RESET = "\033[0m" if not IS_WIN else ""


def ok(msg: str) -> None:
    print(f"  {GREEN}[OK]{RESET} {msg}")


def warn(msg: str) -> None:
    print(f"  {YELLOW}[--]{RESET} {msg}")


def fail(msg: str) -> None:
    print(f"  {RED}[!!]{RESET} {msg}")


def info(msg: str) -> None:
    print(f"  {CYAN}[ii]{RESET} {msg}")


def header(msg: str) -> None:
    print(f"\n{BOLD}=== {msg} ==={RESET}")


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def find_python() -> str:
    """找到可用的 Python 解释器路径。"""
    if sys.executable:
        return sys.executable
    for name in ("python3", "python"):
        p = shutil.which(name)
        if p:
            return p
    return "python"


def find_node() -> str | None:
    """找到 Node.js。"""
    return shutil.which("node") or shutil.which("node.exe")


def find_npm() -> str | None:
    """找到 npm。"""
    return shutil.which("npm") or shutil.which("npm.cmd")


# ── 1. Git Hook ────────────────────────────────────────

def setup_git(repos: list[str], server_url: str, api_key: str) -> list[str]:
    """为每个指定仓库安装 post-commit hook。"""
    header("1/5  Git post-commit hook")
    results = []

    if not repos:
        warn("未指定仓库路径 (--repos)，跳过 Git hook 安装")
        info("后续可手动安装: python scripts/install_git_hook.py --repo /path/to/repo")
        return results

    installer = SCRIPT_DIR / "install_git_hook.py"
    python = find_python()

    # 写入 server URL 到环境变量文件（git hook 运行时读取）
    for repo_path in repos:
        repo = Path(repo_path).expanduser().resolve()
        git_dir = repo / ".git"
        if not git_dir.exists():
            fail(f"{repo} 不是 Git 仓库，跳过")
            continue

        # 设置环境变量（hook 脚本通过 EVOWORK_API 读取）
        env_file = repo / ".git" / "evowork-env"
        with open(env_file, "w", encoding="utf-8") as f:
            f.write(f"EVOWORK_API={server_url}/api/collect/git\n")
            if api_key:
                f.write(f"EVOWORK_API_KEY={api_key}\n")
        info(f"写入环境配置: .git/evowork-env")

        r = run([python, str(installer), str(repo)])
        if r.returncode == 0:
            ok(f"{repo.name} — hook 已安装")
            results.append(f"git:{repo.name}")
        else:
            fail(f"{repo.name} — 安装失败: {r.stderr.strip()}")

    return results


# ── 2. Shell Hook ──────────────────────────────────────

def setup_shell(server_url: str, api_key: str) -> list[str]:
    """安装 Shell PROMPT_COMMAND hook。"""
    header("2/5  Shell hook")
    results = []

    installer = SCRIPT_DIR / "install_shell_hook.py"
    python = find_python()

    # 检测 shell 类型
    shell_env = os.environ.get("SHELL", "")
    shell_type = "zsh" if "zsh" in shell_env else "bash"
    if IS_WIN:
        shell_type = "bash"  # Git Bash on Windows

    rc_file = Path.home() / (".zshrc" if shell_type == "zsh" else ".bashrc")
    info(f"检测到 shell: {shell_type}, 配置文件: {rc_file}")

    r = run([python, str(installer), "--shell", shell_type])
    if r.returncode == 0:
        ok(f"Shell hook 已安装到 {rc_file}")
        results.append(f"shell:{shell_type}")
    else:
        fail(f"Shell hook 安装失败: {r.stderr.strip()}")
        return results

    # 写入自定义配置到 hook 配置文件
    config_file = Path.home() / ".evowork_shell_config"
    with open(config_file, "w", encoding="utf-8") as f:
        f.write(f"# EvoWork Shell Configuration\n")
        f.write(f"export EVOWORK_SHELL_API=\"{server_url}/api/collect/shell\"\n")
        f.write(f"export EVOWORK_SHELL_BATCH_API=\"{server_url}/api/collect/shell/batch\"\n")
        if api_key:
            f.write(f"export EVOWORK_API_KEY=\"{api_key}\"\n")
    ok(f"写入 shell 配置: {config_file}")

    # 在 rc 文件中 source 配置文件（如果还没有）
    config_source_line = f'[ -f "{config_file}" ] && source "{config_file}"'
    if rc_file.exists():
        content = rc_file.read_text(encoding="utf-8")
        if str(config_file) not in content:
            with open(rc_file, "a", encoding="utf-8") as f:
                f.write(f"\n# EvoWork-AI Shell Config\n{config_source_line}\n")
            ok(f"配置文件已添加到 {rc_file}")
        else:
            info("配置文件已在 rc 中")

    info(f"重启终端或执行 source {rc_file} 使配置生效")
    return results


# ── 3. VSCode Extension ───────────────────────────────

def setup_vscode(server_url: str, api_key: str) -> list[str]:
    """编译并打包 VSCode 扩展。"""
    header("3/5  VSCode IDE 扩展")
    results = []

    ext_dir = PROJECT_ROOT / "collectors" / "vscode-extension"
    if not ext_dir.exists():
        warn(f"扩展目录不存在: {ext_dir}")
        return results

    npm = find_npm()
    node = find_node()
    if not node or not npm:
        warn("未检测到 Node.js/npm，跳过 VSCode 扩展编译")
        info("安装 Node.js 后重新运行此脚本")
        return results

    info("安装依赖...")
    r = run([npm, "install", "--silent"], cwd=str(ext_dir))
    if r.returncode != 0:
        fail(f"npm install 失败: {r.stderr.strip()}")
        return results
    ok("npm install 完成")

    info("编译 TypeScript...")
    r = run([npm, "run", "compile"], cwd=str(ext_dir))
    if r.returncode != 0:
        fail(f"编译失败: {r.stderr.strip()}")
        return results
    ok("编译完成")

    # 尝试打包 VSIX
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if npx:
        info("打包 VSIX...")
        r = run([npx, "@vscode/vsce", "package", "--no-dependencies"], cwd=str(ext_dir))
        if r.returncode == 0:
            # 找到生成的 .vsix 文件
            vsix_files = list(ext_dir.glob("*.vsix"))
            if vsix_files:
                vsix = max(vsix_files, key=lambda p: p.stat().st_mtime)
                ok(f"VSIX 已生成: {vsix.name}")
                info(f"在 VSCode 中安装: Ctrl+Shift+P -> Extensions: Install from VSIX -> 选择 {vsix}")
                results.append(f"vscode:{vsix.name}")
            else:
                warn("VSIX 打包完成但未找到输出文件")
        else:
            warn(f"VSIX 打包失败（不影响手动编译安装）: {r.stderr.strip()[:200]}")
            info("可手动编译: cd collectors/vscode-extension && npm run compile")

    # 提示配置 server URL
    info(f"安装后在 VSCode Settings 中搜索 evowork，设置 Server URL 为: {server_url}")
    if api_key:
        info(f"同时设置 evowork.apiKey 为: {api_key}")

    return results


# ── 4. ActivityWatch ──────────────────────────────────

def setup_activitywatch(server_url: str) -> list[str]:
    """检测 ActivityWatch 并生成 cron 建议。"""
    header("4/5  ActivityWatch")
    results = []

    # 检测 ActivityWatch 是否运行
    import urllib.request
    import urllib.error
    aw_url = "http://localhost:5600/api/0/buckets"
    try:
        req = urllib.request.Request(aw_url, method="GET")
        with urllib.request.urlopen(req, timeout=3) as resp:
            buckets = json.loads(resp.read().decode())
            ok(f"ActivityWatch 运行中，发现 {len(buckets)} 个 bucket")
            aw_running = True
    except Exception:
        warn("ActivityWatch 未运行 (http://localhost:5600 不可达)")
        aw_running = False

    import_script = SCRIPT_DIR / "activitywatch_import.py"
    python = find_python()

    if aw_running:
        # 执行一次初始导入
        info("执行初始导入（最近 24 小时）...")
        r = run([python, str(import_script), "--hours", "24"])
        if r.returncode == 0:
            ok("初始导入完成")
            results.append("activitywatch:imported")
        else:
            warn(f"初始导入失败: {r.stderr.strip()[:200]}")

    # 打印 cron 建议
    info("建议配置定时导入（每 6 小时增量同步）：")
    if IS_WIN:
        info("  Windows 任务计划程序:")
        info(f"    操作: 启动程序 -> {python}")
        info(f"    参数: {import_script} --hours 6")
        info("    触发器: 每天 6:00, 12:00, 18:00, 0:00")
    else:
        info(f"  crontab -e 添加:")
        info(f"    0 */6 * * * {python} {import_script} --hours 6")

    return results


# ── 5. Browser Extension ──────────────────────────────

def setup_browser(server_url: str) -> list[str]:
    """打印浏览器扩展安装指引。"""
    header("5/5  Browser 扩展")
    results = []

    ext_dir = PROJECT_ROOT / "collectors" / "chrome-extension"
    if not ext_dir.exists():
        warn(f"扩展目录不存在: {ext_dir}")
        return results

    ok(f"Chrome 扩展源码位于: {ext_dir}")
    info("安装步骤:")
    info("  1. Chrome -> 地址栏输入 chrome://extensions")
    info("  2. 开启「开发者模式」（右上角）")
    info(f"  3. 点击「加载已解压的扩展程序」-> 选择 {ext_dir}")
    info(f"  4. 点击扩展图标 -> 输入服务器地址: {server_url}")
    info("  5. 确认连接状态变为绿色")
    results.append("browser:guide_shown")

    return results


# ── Main ───────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="EvoWork-AI 数据采集器一键配置",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python scripts/setup_collectors.py
  python scripts/setup_collectors.py --server-url http://192.168.1.100:8000
  python scripts/setup_collectors.py --repos ~/code/project-a ~/code/project-b
  python scripts/setup_collectors.py --api-key my-secret --skip-browser
        """,
    )
    parser.add_argument(
        "--server-url",
        default="http://127.0.0.1:8000",
        help="EvoWork 服务器地址 (默认: http://127.0.0.1:8000)",
    )
    parser.add_argument(
        "--repos",
        nargs="*",
        default=[],
        help="要安装 Git hook 的仓库路径（可多个）",
    )
    parser.add_argument(
        "--api-key",
        default="",
        help="API Key（如果服务器启用了认证）",
    )
    parser.add_argument("--skip-git", action="store_true", help="跳过 Git hook")
    parser.add_argument("--skip-shell", action="store_true", help="跳过 Shell hook")
    parser.add_argument("--skip-vscode", action="store_true", help="跳过 VSCode 扩展")
    parser.add_argument("--skip-activitywatch", action="store_true", help="跳过 ActivityWatch")
    parser.add_argument("--skip-browser", action="store_true", help="跳过 Browser 扩展指引")

    args = parser.parse_args()

    print(f"\n{BOLD}EvoWork-AI 数据采集器一键配置{RESET}")
    print(f"  服务器: {CYAN}{args.server_url}{RESET}")
    print(f"  系统:   {platform.system()} {platform.release()} ({platform.machine()})")
    print(f"  Python: {sys.version.split()[0]}")

    all_results: list[str] = []

    if not args.skip_git:
        all_results.extend(setup_git(args.repos, args.server_url, args.api_key))

    if not args.skip_shell:
        all_results.extend(setup_shell(args.server_url, args.api_key))

    if not args.skip_vscode:
        all_results.extend(setup_vscode(args.server_url, args.api_key))

    if not args.skip_activitywatch:
        all_results.extend(setup_activitywatch(args.server_url))

    if not args.skip_browser:
        all_results.extend(setup_browser(args.server_url))

    # ── 汇总 ─────────────────────────────────────────
    header("配置汇总")
    if all_results:
        ok(f"已配置 {len(all_results)} 个采集器:")
        for r in all_results:
            collector, detail = r.split(":", 1)
            print(f"      {collector:16s} {detail}")
    else:
        warn("未配置任何采集器")

    print(f"\n{BOLD}后续步骤:{RESET}")
    print("  1. 启动 EvoWork 服务器（如未启动）:")
    print(f"     python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload")
    print("  2. 重启终端（使 Shell hook 生效）")
    print("  3. 打开浏览器访问 EvoWork Config 页面验证连接状态")
    print()


if __name__ == "__main__":
    main()
