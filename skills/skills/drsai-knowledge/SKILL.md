---
name: drsai-knowledge
description: "Search DrSai knowledge bases (local files + remote RAGFlow) via the Gateway API, returning chunk-level evidence with scores. Use when the user asks to search, retrieve, or read from knowledge bases."
---

# DrSai Knowledge Base Query

DrSai Desktop manages knowledge bases through a local Gateway process (`127.0.0.1:28643`).
The script talks to the Gateway REST API and supports both KB types via the same `search-preview` endpoint:

| Type | Description |
|------|-------------|
| `local-files` | Local workspace files indexed in DrSai Desktop |
| `ragflow`     | Remote RAGFlow datasets |

## When to Use

Activate this skill when the user asks to:
- Search / retrieve / read from "知识库" (knowledge base)
- Look up information in RAGFlow datasets or local indexed documents
- Find content in saved knowledge sources

## How to Use

Run the bundled script `scripts/query_kb.py` with the Codex primary Python runtime.

### List available knowledge bases:
```
python scripts/query_kb.py --list
```

### Search all knowledge bases:
```
python scripts/query_kb.py --query "your search term"
```

### Filter by type:
```
python scripts/query_kb.py --query "keyword" --kb-type local-files
python scripts/query_kb.py --query "keyword" --kb-type ragflow
```

### Filter by KB name:
```
python scripts/query_kb.py --query "keyword" --kb-name <display_name>
```

### Search an unregistered local folder:
If the local folder is not yet registered in DrSai Desktop:
```
python scripts/query_kb.py --query "keyword" --local-path /path/to/docs
```
Or set the `DRSAI_LOCAL_KB` environment variable.

## Output

Each result includes:
- **KB name** and **type** (local-files / ragflow)
- **Source document path** within the KB
- **Relevance score** (0-1)
- **Content snippet** (up to 600 chars of the matched chunk)

## Important Notes

- DrSai Desktop must be running (Gateway at `127.0.0.1:28643`)
- The instance token is auto-detected from `~/.drsai-prod/runtime/instance-token`
- Both KB types use the same `search-preview` API
- The script auto-discovers the DrSai home directory (`.drsai-prod` / `.drsai` / `.drsai-dev`)
- If no knowledge bases are configured, guide the user to add one in DrSai Desktop

## Architecture

```
query_kb.py → Gateway REST (127.0.0.1:28643)
  ├── GET    /v1/config/knowledge-bases                  (list KBs)
  └── POST   /v1/config/knowledge-bases/{id}/search-preview  (search)
        → returns evidence[] with content, score, source
```
