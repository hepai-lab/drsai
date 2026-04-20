#!/usr/bin/env python3
"""
One-off / maintenance: dedupe entries in userremoteagents.agents JSON
where mode is remote or custom and display name repeats (keeps last in list order).

Usage:
  python dedupe_user_remote_agents_db.py [--db PATH] [--dry-run] [--skip-useragents-cache]

By default updates both ``userremoteagents`` and ``useragents`` (merged list cache).
Default DB: ~/.drsai_ui/drsai_ui.db
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path


def _display_name(agent: dict) -> str:
    if not agent:
        return ""
    n = agent.get("name")
    if n is not None and str(n).strip():
        return str(n).strip()
    cfg = agent.get("config") or {}
    n2 = cfg.get("name")
    return str(n2).strip() if n2 is not None else ""


def _dedupe_key(agent: dict) -> tuple:
    mode = str(agent.get("mode") or "").lower()
    aid = str(agent.get("id") or "")
    if mode in ("remote", "custom"):
        name = _display_name(agent).casefold()
        if not name:
            return ("rc", mode, "", aid)
        return ("rc", mode, name)
    return ("id", aid)


def dedupe_remote_custom_list(agents: list) -> list:
    if len(agents) < 2:
        return agents
    last_index: dict[tuple, int] = {}
    for i, agent in enumerate(agents):
        last_index[_dedupe_key(agent)] = i
    keep_indices = sorted(last_index.values())
    return [agents[i] for i in keep_indices]


def dedupe_merged_agent_list(agents: list) -> list:
    """Same rules as get_user_agents: remote/custom by (mode, display name), else by id."""
    if len(agents) < 2:
        return agents
    last_index: dict[tuple, int] = {}
    for i, agent in enumerate(agents):
        last_index[_dedupe_key(agent)] = i
    keep_indices = sorted(last_index.values())
    return [agents[i] for i in keep_indices]


def main() -> int:
    default_db = Path.home() / ".drsai_ui" / "drsai_ui.db"
    ap = argparse.ArgumentParser(description="Dedupe remote/custom rows in userremoteagents JSON")
    ap.add_argument("--db", type=Path, default=default_db, help="Path to drsai_ui SQLite file")
    ap.add_argument("--dry-run", action="store_true", help="Print changes only, do not write")
    ap.add_argument(
        "--skip-useragents-cache",
        action="store_true",
        help="Only process userremoteagents; skip deduping useragents merged list",
    )
    args = ap.parse_args()

    if not args.db.is_file():
        print(f"Database not found: {args.db}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(args.db))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute("SELECT id, user_id, agents FROM userremoteagents").fetchall()

    total_removed = 0
    for row in rows:
        raw = row["agents"]
        if raw is None:
            continue
        if isinstance(raw, str):
            agents = json.loads(raw)
        else:
            agents = list(raw)
        if not agents:
            continue
        new_agents = dedupe_remote_custom_list(agents)
        removed = len(agents) - len(new_agents)
        if removed <= 0:
            continue
        total_removed += removed
        uid = row["user_id"]
        print(f"user_id={uid!r} row id={row['id']}: remove {removed} duplicate(s), {len(agents)} -> {len(new_agents)}")
        if not args.dry_run:
            cur.execute(
                "UPDATE userremoteagents SET agents = ? WHERE id = ?",
                (json.dumps(new_agents, ensure_ascii=False), row["id"]),
            )

    ua_removed = 0
    if not args.skip_useragents_cache:
        ua_rows = cur.execute("SELECT id, user_id, agents FROM useragents").fetchall()
        for row in ua_rows:
            raw = row["agents"]
            if raw is None:
                continue
            if isinstance(raw, str):
                agents = json.loads(raw)
            else:
                agents = list(raw)
            if len(agents) < 2:
                continue
            new_agents = dedupe_merged_agent_list(agents)
            removed = len(agents) - len(new_agents)
            if removed <= 0:
                continue
            ua_removed += removed
            uid = row["user_id"]
            print(
                f"[useragents] user_id={uid!r} row id={row['id']}: remove {removed} duplicate(s), "
                f"{len(agents)} -> {len(new_agents)}"
            )
            if not args.dry_run:
                cur.execute(
                    "UPDATE useragents SET agents = ? WHERE id = ?",
                    (json.dumps(new_agents, ensure_ascii=False), row["id"]),
                )

    if not args.dry_run and (total_removed or ua_removed):
        conn.commit()
    conn.close()

    if total_removed == 0 and ua_removed == 0:
        print("No duplicate entries found.")
    else:
        parts = []
        if total_removed:
            parts.append(f"userremoteagents: {total_removed}")
        if ua_removed:
            parts.append(f"useragents: {ua_removed}")
        print("Done. " + ", ".join(parts) + (" (dry-run, not saved)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
