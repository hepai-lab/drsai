"""Model-visible web_search tool backed by the controlled P1 browser service."""

from __future__ import annotations

import asyncio
from typing import Any

from autogen_core import CancellationToken
from autogen_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from .bing_playwright import WebSearchRuntimeError, search_bing_with_playwright


async def web_search(
    query: str,
    max_results: int = 8,
    cancellation_token: CancellationToken | None = None,
) -> dict[str, Any]:
    """Search the public web for current or verifiable information and return cited results."""
    task = asyncio.create_task(search_bing_with_playwright(query, max_results))
    if cancellation_token is not None:
        loop = asyncio.get_running_loop()
        cancellation_token.add_callback(lambda: loop.call_soon_threadsafe(task.cancel))
    try:
        return (await task).public_dict()
    except asyncio.CancelledError:
        raise
    except WebSearchRuntimeError:
        raise


class WebSearchArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(
        description=(
            "Concise search terms, not a copy of the full user question. "
            "For entity-definition questions, use the entity name and distinguishing year/version only."
        ),
        min_length=1,
        max_length=500,
    )
    max_results: int = Field(default=8, description="Maximum number of results to return.", ge=1, le=10)


class WebSearchTool(BaseTool[WebSearchArguments, dict[str, Any]]):
    def __init__(self) -> None:
        super().__init__(
            WebSearchArguments,
            dict[str, Any],
            "web_search",
            "Search the public web for current or verifiable information and return cited results.",
        )

    async def run(
        self,
        args: WebSearchArguments,
        cancellation_token: CancellationToken,
    ) -> dict[str, Any]:
        return await web_search(args.query, args.max_results, cancellation_token)


def create_web_search_tool() -> WebSearchTool:
    return WebSearchTool()
