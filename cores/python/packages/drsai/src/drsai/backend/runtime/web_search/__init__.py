"""Public-web search support for the OpenDrSai Agent Runtime."""

from .bing_playwright import web_search_runtime_status
from .contracts import WebSearchResponse, WebSearchResult
from .tool import WebSearchTool, create_web_search_tool, web_search

__all__ = [
    "WebSearchResponse",
    "WebSearchResult",
    "WebSearchTool",
    "create_web_search_tool",
    "web_search",
    "web_search_runtime_status",
]
