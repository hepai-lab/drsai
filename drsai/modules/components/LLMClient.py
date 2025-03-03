from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_ext.models.openai.config import OpenAIClientConfiguration
from autogen_core.models import ModelFamily

from typing_extensions import Unpack
import os

class HepAIChatCompletionClient(OpenAIChatCompletionClient):

    def __init__(self, **kwargs: Unpack[OpenAIClientConfiguration]):

        if "api_key" not in kwargs:
            kwargs["api_key"] = os.environ.get("HEPAI_API_KEY")
        if "base_url" not in kwargs:
            kwargs["base_url"] = "https://aiapi.ihep.ac.cn/apiv2"

        if "model_info" not in kwargs:
            model_info={
                "vision": False,
                "function_calling": False,  # You must sure that the model can handle function calling
                "json_output": False,
                "family": ModelFamily.UNKNOWN,
            }
            kwargs["model_info"] = model_info
        allowed_models = [
        "gpt-4o",
        "o1",
        "o3",
        "gpt-4",
        "gpt-35",
        "r1",
        "gemini-1.5-flash",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "claude-3-haiku",
        "claude-3-sonnet",
        "claude-3-opus",
        "claude-3.5-haiku",
        "claude-3.5-sonnet"]
        for allowed_model in allowed_models:
            model = kwargs.get("model", "")
            if allowed_model in model:
                kwargs["model_info"]["family"] = allowed_model
                kwargs["model_info"]["function_calling"] = True
                break

        super().__init__(**kwargs)
