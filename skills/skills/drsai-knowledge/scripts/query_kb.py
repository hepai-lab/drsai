#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Search DrSai knowledge bases through two channels:

Channel 1 - Gateway API: queries KBs registered in DrSai Desktop (ragflow + local-files)
Channel 2 - Local folder: scans files directly under a local folder path
             supports .docx, .doc, .md, .pdf, .txt

Usage:
  python query_kb.py --list
  python query_kb.py --query "keyword"
  python query_kb.py --query "keyword" --local-path /path/to/docs
  DRSAI_LOCAL_KB=/path/to/docs python query_kb.py --query "keyword"
"""
import argparse, json, os, re, sys, urllib.request
from pathlib import Path

GATEWAY_HOST = "127.0.0.1"
GATEWAY_PORT = "28643"


def _find_home():
    env = os.environ.get("DRSAI_HOME", "")
    if env:
        p = Path(env)
        if (p / "runtime" / "instance-token").exists():
            return p
    for cand in (".drsai-prod", ".drsai", ".drsai-dev"):
        p = Path.home() / cand
        if (p / "runtime" / "instance-token").exists():
            return p
    return None


def _load_token(home):
    return (home / "runtime" / "instance-token").read_text(encoding="utf-8").strip()


def _req(path, token, data=None):
    url = "http://{}:{}{}".format(GATEWAY_HOST, GATEWAY_PORT, path)
    req = urllib.request.Request(url, data=data, method="POST" if data else "GET")
    req.add_header("X-OpenDrSai-Gateway-Token", token)
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


# -- Channel 1: Gateway API ------------------------------------------


def _list_gateway_kbs(token):
    return _req("/v1/config/knowledge-bases", token).get("data", [])


def _search_gateway_kb(kid, query, top_k, token):
    return _req(
        "/v1/config/knowledge-bases/{}/search-preview".format(kid),
        token,
        json.dumps({"query": query, "top_k": top_k, "score_threshold": 0}).encode(),
    )


def cmd_list_gateway(kbs):
    if not kbs:
        print("  (none configured)")
        sys.exit(0)
    for kb in kbs:
        t = kb.get("type", "?")
        s = kb.get("status", "?")
        cfg = kb.get("config", {})
        loc = cfg.get("root_path", cfg.get("base_url", "?"))
        print("  [{}] {}  ({}, {}, {})".format(kb["knowledge_id"], kb["display_name"], t, s, loc))


def search_gateway(kbs, query, top_k, token):
    results = []
    for kb in kbs:
        kid = kb["knowledge_id"]
        name = kb["display_name"]
        try:
            resp = _search_gateway_kb(kid, query, top_k, token)
        except Exception as e:
            print("  [{}] search failed: {}".format(name, e), file=sys.stderr)
            continue
        for ev in resp.get("evidence", []):
            results.append({
                "kb": name,
                "kb_type": kb.get("type", "?"),
                "source": ev.get("source", ""),
                "score": ev.get("score", 0),
                "content": ev.get("content", ""),
            })
    return results


# -- Channel 2: Local folder -----------------------------------------


def _read_file_text(path):
    ext = path.suffix.lower()
    try:
        if ext in (".txt", ".md"):
            return path.read_text(encoding="utf-8", errors="replace")
        elif ext == ".docx":
            from docx import Document
            doc = Document(str(path))
            return "\n".join(p.text for p in doc.paragraphs)
        elif ext == ".doc":
            try:
                import olefile
                ole = olefile.OleFileIO(str(path))
                if ole.exists("WordDocument"):
                    stream = ole.openstream("WordDocument")
                    data = stream.read()
                    ole.close()
                    text = data.decode("utf-8", errors="replace")
                    return re.sub(r"[^\u0020-\u007e\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\n]", "", text)
                ole.close()
            except Exception:
                pass
            return "[Binary .doc file: {}]".format(path.name)
        elif ext == ".pdf":
            texts = []
            try:
                import pdfplumber
                with pdfplumber.open(str(path)) as pdf:
                    texts.extend(page.extract_text() or "" for page in pdf.pages)
            except Exception:
                try:
                    import pypdf
                    reader = pypdf.PdfReader(str(path))
                    texts.extend(page.extract_text() or "" for page in reader.pages)
                except Exception:
                    pass
            return "\n".join(texts)
    except Exception:
        return ""
    return ""


def _simple_search(text, query):
    if not text or not query:
        return 0.0
    low_text = text.lower()
    low_query = query.lower()
    terms = low_query.split()
    hits = sum(low_text.count(t) for t in terms)
    if hits == 0:
        return 0.0
    score = min(1.0, hits / max(1, len(text) / 500))
    return score


def search_local_folder(local_path, query, top_k):
    if not local_path.exists():
        print("  Local KB folder not found: {}".format(local_path), file=sys.stderr)
        return []

    supported = {".docx", ".doc", ".md", ".pdf", ".txt"}
    files = [p for p in local_path.rglob("*") if p.suffix.lower() in supported]
    if not files:
        print("  No supported files found in {}".format(local_path), file=sys.stderr)
        return []

    hits = []
    for fp in files:
        rel = fp.relative_to(local_path)
        text = _read_file_text(fp)
        if not text:
            continue
        score = _simple_search(text, query)
        if score > 0:
            low_text = text.lower()
            low_query = query.lower()
            idx = low_text.find(low_query)
            if idx == -1:
                idx = 0
            start = max(0, idx - 100)
            end = min(len(text), idx + len(query) + 200)
            snippet = text[start:end].replace("\n", " ").strip()
            hits.append((score, str(rel), snippet))

    hits.sort(key=lambda x: x[0], reverse=True)
    results = []
    for score, rel, snippet in hits[:top_k]:
        results.append({
            "kb": str(local_path),
            "kb_type": "local-folder",
            "source": str(rel),
            "score": score,
            "content": snippet[:600],
        })
    return results


# -- Main -------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Search DrSai knowledge bases (Gateway + local folder)",
    )
    parser.add_argument("--query", help="Search query")
    parser.add_argument("--kb-name", help="Filter Gateway KB by display name (substring)")
    parser.add_argument("--kb-type", choices=["local-files", "ragflow"], help="Filter Gateway KB by type")
    parser.add_argument("--top-k", type=int, default=5, help="Max results per source")
    parser.add_argument("--list", action="store_true", help="List available KB sources and exit")
    parser.add_argument("--gateway", action="store_true", help="Search registered KBs only")
    parser.add_argument("--local", action="store_true", help="Search local folder only")
    parser.add_argument("--local-path", help="Path to local KB folder (overrides DRSAI_LOCAL_KB env var)")
    args = parser.parse_args()

    # Resolve local path: CLI arg > env var
    local_kb_path = None
    if args.local_path:
        local_kb_path = Path(args.local_path)
    elif os.environ.get("DRSAI_LOCAL_KB"):
        local_kb_path = Path(os.environ["DRSAI_LOCAL_KB"])

    if args.list:
        print("=== Knowledge Base Sources ===\n")
        print("1) Gateway (DrSai Desktop registered KBs):")
        home = _find_home()
        token = _load_token(home) if home else None
        if token:
            try:
                kbs = _list_gateway_kbs(token)
                cmd_list_gateway(kbs)
            except Exception as e:
                print("  (unreachable: {})".format(e))
        else:
            print("  (DrSai Desktop not running)")

        if local_kb_path:
            print("\n2) Local folder ({}):".format(local_kb_path))
            if local_kb_path.exists():
                supported = {".docx", ".doc", ".md", ".pdf", ".txt"}
                files = [p for p in local_kb_path.rglob("*") if p.suffix.lower() in supported]
                if files:
                    for fp in files:
                        rel = fp.relative_to(local_kb_path)
                        sz = fp.stat().st_size
                        print("  {}  ({:,} bytes)".format(rel, sz))
                else:
                    print("  (no supported files)")
            else:
                print("  (not found)")
        else:
            print("\n2) Local folder: not configured (set --local-path or DRSAI_LOCAL_KB)")
        sys.exit(0)

    if not args.query:
        print("Use --query to search or --list to list available sources.")
        parser.print_help()
        sys.exit(0)

    all_results = []

    # Channel 1: Gateway
    if not args.local:
        home = _find_home()
        token = _load_token(home) if home else None
        if token:
            try:
                kbs = _list_gateway_kbs(token)
                if args.kb_type:
                    kbs = [kb for kb in kbs if kb.get("type") == args.kb_type]
                if args.kb_name:
                    kbs = [kb for kb in kbs if args.kb_name.lower() in kb["display_name"].lower()]
                if kbs:
                    gw = search_gateway(kbs, args.query, args.top_k, token)
                    all_results.extend(gw)
            except Exception as e:
                print("[Gateway] unreachable: {}".format(e), file=sys.stderr)

    # Channel 2: Local folder
    if not args.gateway and local_kb_path:
        local_results = search_local_folder(local_kb_path, args.query, args.top_k)
        all_results.extend(local_results)

    if not all_results:
        print("No results for '{}' in any knowledge source.".format(args.query))
        if not local_kb_path:
            print("Hint: Set --local-path or DRSAI_LOCAL_KB to search local files.")
        sys.exit(0)

    all_results.sort(key=lambda r: r["score"], reverse=True)
    print("Found {} result(s) for '{}':\n".format(len(all_results), args.query))
    for i, r in enumerate(all_results, 1):
        snippet = r["content"][:600]
        print("[{}] KB: {} ({})".format(i, r["kb"], r["kb_type"]))
        print("    Source: {}".format(r["source"]))
        print("    Score:  {:.0%}".format(r["score"]))
        print("    ---")
        print("    {}".format(snippet))
        print()
