#!/usr/bin/env python3
"""EvoWork-AI Chrome 浏览历史导入工具 — 从 Chrome History SQLite 批量回溯。

用法:
    # 自动检测 Chrome 并导入最近 7 天
    python chrome_history_import.py

    # 指定时间范围
    python chrome_history_import.py --hours 168

    # 指定 History 文件路径
    python chrome_history_import.py --db /path/to/History

    # 按域名过滤
    python chrome_history_import.py --domain github.com

    # 仅预览
    python chrome_history_import.py --dry-run

注意: Chrome 运行时会锁定 History 数据库，脚本会自动复制到临时文件读取。
"""

import argparse
import json
import os
import platform
import shutil
import sqlite3
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone, timedelta
from pathlib import Path

EVOWORK_BROWSER_API = os.environ.get(
    "EVOWORK_BROWSER_API", "http://127.0.0.1:8000/api/collect/browser"
)
DEFAULT_BATCH_SIZE = 100

# Chrome epoch: microseconds since 1601-01-01 00:00:00 UTC
_CHROME_EPOCH_OFFSET = 11644473600  # seconds between 1601 and 1970


def _find_chrome_history() -> tuple[Path | None, str]:
    """自动检测 Chrome / Edge History 数据库路径。返回 (path, browser_name)。"""
    system = platform.system()

    if system == "Windows":
        local_app = os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local"))
        chrome = [
            Path(local_app) / "Google" / "Chrome" / "User Data" / "Default" / "History",
            Path(local_app) / "Google" / "Chrome" / "User Data" / "Profile 1" / "History",
            Path(local_app) / "Google" / "Chrome" / "User Data" / "Profile 2" / "History",
        ]
        edge = [
            Path(local_app) / "Microsoft" / "Edge" / "User Data" / "Default" / "History",
            Path(local_app) / "Microsoft" / "Edge" / "User Data" / "Profile 1" / "History",
        ]
    elif system == "Darwin":
        chrome = [
            Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "History",
            Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Profile 1" / "History",
        ]
        edge = [
            Path.home() / "Library" / "Application Support" / "Microsoft Edge" / "Default" / "History",
        ]
    else:  # Linux
        chrome = [
            Path.home() / ".config" / "google-chrome" / "Default" / "History",
            Path.home() / ".config" / "google-chrome" / "Profile 1" / "History",
            Path.home() / ".config" / "chromium" / "Default" / "History",
        ]
        edge = [
            Path.home() / ".config" / "microsoft-edge" / "Default" / "History",
        ]

    for c in chrome:
        if c.exists():
            return c, "Chrome"
    for c in edge:
        if c.exists():
            return c, "Edge"
    return None, "unknown"


def _chrome_timestamp_to_iso(chrome_ts: int) -> str:
    """Chrome 时间戳 (microseconds since 1601-01-01) → ISO 8601。"""
    if chrome_ts == 0:
        return ""
    unix_seconds = (chrome_ts / 1_000_000) - _CHROME_EPOCH_OFFSET
    return datetime.fromtimestamp(unix_seconds, tz=timezone.utc).isoformat()


def read_chrome_history(
    db_path: Path,
    hours: int | None = None,
    limit: int = 500,
    domain_filter: str | None = None,
) -> list[dict]:
    """从 Chrome History SQLite 读取浏览记录。

    提取 visits 表中的每次访问（而非 urls 表的汇总），
    这样可以获得精确的访问时间和次数。
    """
    if not db_path.exists():
        print(f"[EvoWork] History file not found: {db_path}")
        return []

    # Chrome 锁定数据库，复制到临时文件
    tmp_fd, tmp_path = tempfile.mkstemp(suffix=".sqlite")
    os.close(tmp_fd)
    try:
        shutil.copy2(str(db_path), tmp_path)
        # WAL 文件也需要复制
        wal_path = Path(str(db_path) + "-wal")
        if wal_path.exists():
            shutil.copy2(str(wal_path), tmp_path + "-wal")
    except (PermissionError, OSError) as e:
        print(f"[EvoWork] Cannot copy History file (Chrome locked?): {e}")
        os.unlink(tmp_path)
        return []

    events: list[dict] = []
    try:
        conn = sqlite3.connect(tmp_path)
        cursor = conn.cursor()

        # 构建查询
        query = """
            SELECT u.url, u.title, v.visit_time, v.visit_duration, u.visit_count
            FROM visits v
            JOIN urls u ON v.url = u.id
            WHERE v.visit_duration > 0
        """
        params: list = []

        if hours:
            # 计算 Chrome 时间戳
            cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
            chrome_cutoff = int((cutoff.timestamp() + _CHROME_EPOCH_OFFSET) * 1_000_000)
            query += " AND v.visit_time >= ?"
            params.append(chrome_cutoff)

        if domain_filter:
            query += " AND u.url LIKE ?"
            params.append(f"%{domain_filter}%")

        query += " ORDER BY v.visit_time DESC LIMIT ?"
        params.append(limit)

        cursor.execute(query, params)

        for row in cursor.fetchall():
            url, title, visit_time, visit_duration, visit_count = row
            timestamp = _chrome_timestamp_to_iso(visit_time)

            # visit_duration 可能是 0 或不可靠的大数值
            # 合理范围: 5 秒 ~ 4 小时
            duration_seconds = 60  # 默认 1 分钟
            if visit_duration and 0 < visit_duration:
                # 尝试按毫秒转换
                dur_ms = visit_duration
                dur_s = dur_ms / 1000
                if 5 <= dur_s <= 14400:  # 5s ~ 4h
                    duration_seconds = dur_s
                elif dur_s > 14400:
                    duration_seconds = 300  # 超长时默认 5 分钟

            events.append({
                "url": url,
                "title": title or "",
                "duration_seconds": duration_seconds,
                "timestamp": timestamp,
            })

        conn.close()
    except sqlite3.Error as e:
        print(f"[EvoWork] SQLite error: {e}")
    finally:
        os.unlink(tmp_path)
        if os.path.exists(tmp_path + "-wal"):
            os.unlink(tmp_path + "-wal")

    return events


def send_events(events: list[dict], dry_run: bool = False) -> None:
    """分批发送到 EvoWork-AI browser 采集端点。"""
    total = len(events)
    created = 0
    skipped = 0
    errors = 0

    for start in range(0, total, DEFAULT_BATCH_SIZE):
        batch = events[start:start + DEFAULT_BATCH_SIZE]
        payload = {
            "source": "browser",
            "events": batch,
        }

        if dry_run:
            created += len(batch)
            continue

        try:
            data = json.dumps(payload).encode("utf-8")
            req = urllib.request.Request(
                EVOWORK_BROWSER_API,
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

    print(f"\n[EvoWork] Chrome history import complete:")
    print(f"  Total:    {total}")
    print(f"  Created:  {created}")
    print(f"  Skipped:  {skipped}")
    print(f"  Errors:   {errors}")
    if dry_run:
        print("  (dry-run mode, no data was sent)")


def main():
    parser = argparse.ArgumentParser(description="Import Chrome browsing history to EvoWork-AI")
    parser.add_argument("--db", type=str, help="Path to Chrome History SQLite file")
    parser.add_argument("--hours", type=int, default=168, help="Import visits from the last N hours (default: 168 = 7 days)")
    parser.add_argument("--limit", type=int, default=500, help="Max visits to import (default: 500)")
    parser.add_argument("--domain", type=str, help="Filter by domain (e.g. github.com)")
    parser.add_argument("--dry-run", action="store_true", help="Parse but don't send")
    args = parser.parse_args()

    # 查找 History 数据库
    if args.db:
        db_path = Path(args.db).expanduser()
        browser_name = "Custom"
    else:
        db_path, browser_name = _find_chrome_history()
        if not db_path:
            print("[EvoWork] Chrome/Edge History not found. Use --db to specify the path.")
            print("  Common locations:")
            print("    Windows: %LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\History")
            print("             %LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\History")
            print("    macOS:   ~/Library/Application Support/Google/Chrome/Default/History")
            print("    Linux:   ~/.config/google-chrome/Default/History")
            return

    print(f"[EvoWork] Browser: {browser_name}")
    print(f"[EvoWork] History DB: {db_path}")

    # 读取
    events = read_chrome_history(db_path, hours=args.hours, limit=args.limit, domain_filter=args.domain)
    print(f"[EvoWork] Found {len(events)} visits")

    if not events:
        print("[EvoWork] No visits to import")
        return

    # 预览
    if args.dry_run:
        print(f"\n[EvoWork] Preview (top 15):")
        for e in events[:15]:
            title = (e["title"] or "(no title)")[:40]
            ts = e["timestamp"][:16] if e["timestamp"] else "no-time"
            dur = int(e["duration_seconds"])
            domain = e["url"].split("/")[2] if "/" in e["url"] else "?"
            print(f"  {ts} | {dur:>4}s | {domain[:20]:<20} | {title}")
        if len(events) > 15:
            print(f"  ... ({len(events)} total)")

    send_events(events, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
