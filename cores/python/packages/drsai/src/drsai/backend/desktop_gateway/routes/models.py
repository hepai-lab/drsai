"""Model selection (feature 3.2) -- one read-only route, no CRUD.

``run_drsai_agent_factory.build_model_catalog()`` already returns exactly the
fields a picker needs, so this route is a pass-through::

    {"default_alias": ..., "models": [{"alias", "display_name", "client_type",
                                       "model", "token_limit", "max_tokens",
                                       "vision"}, ...]}

The chosen ``alias`` travels on the execute request and lands in
``create_agent(defult_config_name=alias)``. That is the entire feature. Legacy
instead resolves a model through an Agent model policy backed by a provider
registry, which is what the other 23 model routes exist to maintain -- none of
them are here, because the selection never leaves the request.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter

from drsai.backend.run_drsai_agent_factory import (
    build_model_catalog,
    get_llm_config_file_path,
    load_llm_mode_config,
)

api = APIRouter(tags=["models"])


@api.get("/v1/config/model-catalog", operation_id="getModelCatalog")
async def model_catalog():
    """The models configured in ``run_drsai_agent_factory``, for the picker."""
    # Reading the catalog touches the filesystem; keep it off the event loop so
    # a slow disk cannot stall an in-flight chat stream.
    config = await asyncio.to_thread(load_llm_mode_config, get_llm_config_file_path())
    return build_model_catalog(config)


def router() -> APIRouter:
    return api
