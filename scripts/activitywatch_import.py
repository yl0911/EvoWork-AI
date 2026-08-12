#!/usr/bin/env python3
"""ActivityWatch → EvoWork AI 数据导入脚本。

从本地 ActivityWatch REST API 读取窗口活动和浏览器活动事件，
转换为 EvoWork 格式并批量导入。

用法:
    # 导入最近 24 小时的数据
    python scripts/activitywatch_import.py

    # 导入最近 7 天
    python scripts/activitywatch_import.py --hours 168

    # 指定 ActivityWatch URL
    python scripts/activitywatch_import.py --aw-url http://localhost:5666

    # 从 JSON 文件导入（ActivityWatch 导出格式）
    python scripts/activitywatch_import.py --file events.json

    # 仅预览，不实际导入
    python scripts/activitywatch_import.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path


DEFAULT_AW_URL = "http://localhost:5600"
DEFAULT_EVOWORK_URL = "http://localhost:8000"


def fetch_json(url: str) -> dict | list:
    """从 URL 获取 JSON 数据。"""
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"  [ERROR] Failed to fetch {url}: {e}")
        raise


def get_aw_buckets(aw_url: str) -> list[dict]:
    """获取 ActivityWatch 所有 bucket 信息。"""
    data = fetch_json(f"{aw_url}/api/0/buckets")
    if isinstance(data, dict):
        return [{"id": k, **v} for k, v in data.items()]
    return data


def get_aw_events(aw_url: str, bucket_id: str, start: str, end: str) -> list[dict]:
    """获取指定 bucket 在时间范围内的事件。"""
    url = f"{aw_url}/api/0/buckets/{bucket_id}/events?start={start}&end={end}&limit=1000"
    return fetch_json(url)


def aw_event_to_payload(ev: dict, bucket_type: str) -> dict:
    """将 ActivityWatch 事件转换为导入格式。"""
    data = ev.get("data", {})
    ts = ev.get("timestamp", "")
    dur = ev.get("duration", 0)  # ActivityWatch 用秒（float）

    if bucket_type == "web":
        # 浏览器事件
        return {
            "app": data.get("title", "").split(" - ")[-1] if " - " in data.get("title", "") else "Browser",
            "title": data.get("title", ""),
            "url": data.get("url"),
            "timestamp": ts,
            "duration_seconds": max(0, dur),
        }
    else:
        # 窗口事件
        return {
            "app": data.get("app", ""),
            "title": data.get("title", ""),
            "url": None,
            "timestamp": ts,
            "duration_seconds": max(0, dur),
        }


def import_from_aw_api(
    aw_url: str,
    evowork_url: str,
    hours: float,
    dry_run: bool = False,
    bucket_filter: str | None = None,
) -> dict:
    """从 ActivityWatch REST API 导入事件。"""
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=hours)
    start_iso = start.isoformat()
    end_iso = now.isoformat()

    print(f"[ActivityWatch Import]")
    print(f"  AW URL:     {aw_url}")
    print(f"  EvoWork:    {evowork_url}")
    print(f"  Time range: {start_iso[:19]} → {end_iso[:19]}")
    print(f"  Dry run:    {dry_run}")
    print()

    # 获取 buckets
    try:
        buckets = get_aw_buckets(aw_url)
    except Exception:
        print("[ERROR] 无法连接 ActivityWatch API。确保 ActivityWatch 正在运行。")
        return {"error": "Cannot connect to ActivityWatch"}

    # 过滤相关 bucket（排除 AFK 等）
    relevant = []
    for b in buckets:
        bid = b.get("id", "")
        btype = b.get("type", "")

        # 只导入 window 和 web 类型
        if "afk" in bid.lower():
            continue
        if bucket_filter and bucket_filter.lower() not in bid.lower():
            continue
        if btype in ("afkstatus", "currentwindow"):
            continue

        # 识别 bucket 类型
        is_web = "web" in bid.lower()
        relevant.append({
            "id": bid,
            "type": "web" if is_web else "window",
            "hostname": b.get("hostname", ""),
        })

    if not relevant:
        print("[WARN] 未找到可导入的 bucket。")
        print(f"  Available buckets: {[b.get('id') for b in buckets]}")
        return {"total": 0, "created": 0}

    print(f"  Found {len(relevant)} relevant bucket(s):")
    for b in relevant:
        print(f"    - {b['id']} ({b['type']})")
    print()

    all_events = []
    for bucket in relevant:
        bid = bucket["id"]
        btype = bucket["type"]
        print(f"  Fetching {bid}...", end=" ")

        try:
            raw_events = get_aw_events(aw_url, bid, start_iso, end_iso)
        except Exception as e:
            print(f"FAILED ({e})")
            continue

        converted = [aw_event_to_payload(ev, btype) for ev in raw_events]
        # 过滤 duration=0 的事件
        converted = [ev for ev in converted if ev["duration_seconds"] > 0]
        all_events.extend(converted)
        print(f"{len(converted)} events")

    if not all_events:
        print("\n[INFO] 没有可导入的事件。")
        return {"total": 0, "created": 0}

    print(f"\n  Total events to import: {len(all_events)}")

    # 按 duration 排序（长的优先，减少短事件噪声）
    all_events.sort(key=lambda e: e["duration_seconds"], reverse=True)

    if dry_run:
        print("\n[DRY RUN] 预览前 20 条事件：")
        for ev in all_events[:20]:
            dur_min = ev["duration_seconds"] / 60
            app = ev["app"]
            title = ev["title"][:60]
            print(f"  {ev['timestamp'][:19]}  {dur_min:6.1f}m  {app:25s}  {title}")
        if len(all_events) > 20:
            print(f"  ... and {len(all_events) - 20} more")
        return {"total": len(all_events), "created": 0, "dry_run": True}

    # 发送到 EvoWork API
    payload = {
        "source": "activitywatch",
        "events": all_events,
    }

    print(f"\n  Sending to {evowork_url}/api/collect/activitywatch ...")
    req = urllib.request.Request(
        f"{evowork_url}/api/collect/activitywatch",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(f"\n  Result:")
            print(f"    Sessions: {result.get('total', 0)}")
            print(f"    Created:  {result.get('created', 0)}")
            print(f"    Skipped:  {result.get('skipped', 0)}")
            print(f"    Errors:   {result.get('errors', 0)}")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"\n[ERROR] API returned {e.code}: {body[:200]}")
        return {"error": f"HTTP {e.code}"}
    except Exception as e:
        print(f"\n[ERROR] Failed: {e}")
        return {"error": str(e)}


def import_from_file(
    filepath: str,
    evowork_url: str,
    dry_run: bool = False,
) -> dict:
    """从 JSON 文件导入 ActivityWatch 事件。

    支持两种格式:
    1. 直接的事件列表 [{timestamp, duration, data: {app, title}}, ...]
    2. ActivityWatch 导出格式 {buckets: {bucket_id: {events: [...]}}}
    """
    path = Path(filepath)
    if not path.exists():
        print(f"[ERROR] File not found: {filepath}")
        return {"error": "file not found"}

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    all_events = []

    if isinstance(data, list):
        # 直接事件列表
        for ev in data:
            ev_data = ev.get("data", ev)
            all_events.append({
                "app": ev_data.get("app", ""),
                "title": ev_data.get("title", ""),
                "url": ev_data.get("url"),
                "timestamp": ev.get("timestamp", ""),
                "duration_seconds": max(0, ev.get("duration", 0)),
            })
    elif isinstance(data, dict) and "buckets" in data:
        # ActivityWatch 导出格式
        for bucket_id, bucket in data["buckets"].items():
            is_web = "web" in bucket_id.lower()
            for ev in bucket.get("events", []):
                ev_data = ev.get("data", {})
                all_events.append(aw_event_to_payload(ev, "web" if is_web else "window"))
    else:
        print(f"[ERROR] Unrecognized file format")
        return {"error": "unrecognized format"}

    # 过滤空时长事件
    all_events = [ev for ev in all_events if ev["duration_seconds"] > 0]

    print(f"[File Import] {filepath}")
    print(f"  Events: {len(all_events)}")

    if dry_run:
        print("\n[DRY RUN] 预览前 20 条事件：")
        for ev in all_events[:20]:
            dur_min = ev["duration_seconds"] / 60
            print(f"  {ev['timestamp'][:19]}  {dur_min:6.1f}m  {ev['app']:25s}  {ev['title'][:60]}")
        return {"total": len(all_events), "created": 0, "dry_run": True}

    payload = {"source": "activitywatch", "events": all_events}
    req = urllib.request.Request(
        f"{evowork_url}/api/collect/activitywatch",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(f"\n  Result: total={result.get('total')} created={result.get('created')} "
                  f"skipped={result.get('skipped')} errors={result.get('errors')}")
            return result
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"\n[ERROR] API returned {e.code}: {body[:200]}")
        return {"error": f"HTTP {e.code}"}


def main():
    parser = argparse.ArgumentParser(description="ActivityWatch → EvoWork AI importer")
    parser.add_argument("--aw-url", default=DEFAULT_AW_URL,
                        help=f"ActivityWatch API URL (default: {DEFAULT_AW_URL})")
    parser.add_argument("--evowork-url", default=DEFAULT_EVOWORK_URL,
                        help=f"EvoWork API URL (default: {DEFAULT_EVOWORK_URL})")
    parser.add_argument("--hours", type=float, default=24,
                        help="Hours of history to import (default: 24)")
    parser.add_argument("--file", type=str, default=None,
                        help="Import from JSON file instead of AW API")
    parser.add_argument("--bucket", type=str, default=None,
                        help="Filter buckets by name substring")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview events without importing")
    args = parser.parse_args()

    if args.file:
        result = import_from_file(args.file, args.evowork_url, dry_run=args.dry_run)
    else:
        result = import_from_aw_api(
            args.aw_url, args.evowork_url, args.hours,
            dry_run=args.dry_run, bucket_filter=args.bucket,
        )

    if result.get("error"):
        sys.exit(1)


if __name__ == "__main__":
    main()
