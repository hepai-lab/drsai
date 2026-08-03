"""Stable user-facing guidance for model configuration failures."""

from __future__ import annotations

from typing import Any

_GUIDANCE: dict[str, dict[str, Any]] = {
    "authentication_failed": {
        "title": "API Key is invalid",
        "message": "Check that the key is complete and has access to the selected model.",
        "actions": ["Re-enter the API Key", "Check account permissions", "Check the selected key source"],
        "retryable": False,
    },
    "credential_unavailable": {
        "title": "Stored credential is unavailable",
        "message": "The credential reference is missing, corrupted, or cannot be opened by this user account.",
        "actions": ["Enter the API Key again", "Choose an environment variable", "Restore a last-known-good configuration"],
        "retryable": False,
    },
    "config_conflict": {
        "title": "Configuration changed in another window",
        "message": "Reload the current configuration before saving your changes.",
        "actions": ["Reload configuration", "Review the latest values", "Apply the change again"],
        "retryable": True,
    },
    "model_not_found": {
        "title": "Model was not found",
        "message": "The service is reachable, but the selected model ID is not available.",
        "actions": ["Refresh the model list", "Check the model ID", "Check model permissions"],
        "retryable": False,
    },
    "protocol_mismatch": {
        "title": "API protocol does not match",
        "message": "The endpoint does not appear to implement the selected compatible API.",
        "actions": ["Switch OpenAI/Anthropic protocol", "Check the Base URL", "Use the provider preset"],
        "retryable": False,
    },
    "timeout": {
        "title": "Connection timed out",
        "message": "The model service did not respond before the timeout.",
        "actions": ["Check the network", "Check that the local service is running", "Try again"],
        "retryable": True,
    },
    "connection_failed": {
        "title": "Cannot reach the model service",
        "message": "The endpoint could not be reached without exposing network details.",
        "actions": ["Check the Base URL", "Check network or proxy settings", "Check that the local service is running"],
        "retryable": True,
    },
    "permission_denied": {
        "title": "The account lacks permission",
        "message": "The service accepted the credential but denied this operation.",
        "actions": ["Check account permissions", "Check model access", "Use a credential with the required scope"],
        "retryable": False,
    },
    "endpoint_not_found": {
        "title": "API endpoint was not found",
        "message": "The Base URL or compatible API path is incorrect.",
        "actions": ["Check the Base URL", "Check whether /v1 is required", "Check the selected protocol"],
        "retryable": False,
    },
    "invalid_response": {
        "title": "Unexpected service response",
        "message": "The endpoint responded but did not match the selected compatible API.",
        "actions": ["Check the API protocol", "Check the Base URL", "Use a matching provider preset"],
        "retryable": False,
    },
    "dns_failed": {
        "title": "Host name could not be resolved",
        "message": "DNS could not resolve the model service host.",
        "actions": ["Check the Base URL host", "Check DNS and network settings", "Try again"],
        "retryable": True,
    },
    "tls_failed": {
        "title": "Secure connection failed",
        "message": "The service certificate or TLS connection could not be validated.",
        "actions": ["Check the service certificate", "Check the system clock", "Use the correct HTTPS endpoint"],
        "retryable": False,
    },
    "rate_limited": {
        "title": "The service is rate limiting requests",
        "message": "The provider temporarily rejected the test due to request limits.",
        "actions": ["Wait and retry", "Check account quotas", "Reduce concurrent requests"],
        "retryable": True,
    },
}

_ZH: dict[str, tuple[str, str, list[str]]] = {
    "authentication_failed": ("API Key 无效", "请检查 Key 是否完整且有权访问所选模型。", ["重新输入 API Key", "检查账户权限", "检查 Key 来源"]),
    "credential_unavailable": ("凭据不可用", "保存的凭据缺失、损坏或当前账户无法读取。", ["重新输入 API Key", "改用环境变量", "恢复最后可用配置"]),
    "config_conflict": ("配置已被其他窗口修改", "请重新加载最新配置后再次保存。", ["重新加载配置", "检查最新值", "重新应用修改"]),
    "model_not_found": ("模型不存在", "服务可访问，但所选模型 ID 不可用。", ["刷新模型列表", "检查模型 ID", "检查模型权限"]),
    "protocol_mismatch": ("API 协议不匹配", "端点与所选兼容协议不一致。", ["切换协议", "检查 Base URL", "使用服务预设"]),
    "timeout": ("连接超时", "模型服务未在超时时间内响应。", ["检查网络", "确认本地服务已启动", "重试"]),
    "connection_failed": ("无法连接模型服务", "当前无法访问配置的端点。", ["检查 Base URL", "检查网络或代理", "确认本地服务已启动"]),
    "permission_denied": ("账户权限不足", "凭据有效，但没有执行该操作的权限。", ["检查账户权限", "检查模型权限", "更换有权限的凭据"]),
    "endpoint_not_found": ("API 端点不存在", "Base URL 或兼容 API 路径不正确。", ["检查 Base URL", "检查是否需要 /v1", "检查协议"]),
    "invalid_response": ("服务响应格式异常", "端点响应与所选兼容 API 不一致。", ["检查协议", "检查 Base URL", "使用匹配的预设"]),
    "dns_failed": ("域名解析失败", "DNS 无法解析模型服务地址。", ["检查主机名", "检查 DNS 和网络", "重试"]),
    "tls_failed": ("安全连接失败", "无法验证服务证书或建立 TLS 连接。", ["检查证书", "检查系统时间", "使用正确的 HTTPS 地址"]),
    "rate_limited": ("请求受到限流", "服务因请求额度暂时拒绝测试。", ["稍后重试", "检查账户配额", "减少并发请求"]),
}


def guidance_for(code: str) -> dict[str, Any]:
    value = _GUIDANCE.get(code, {
        "title": "Model configuration needs attention",
        "message": "Review the model service settings and try again.",
        "actions": ["Check configuration", "Run drsai config doctor"],
        "retryable": False,
    })
    zh = _ZH.get(code, ("模型配置需要处理", "请检查模型服务配置后重试。", ["检查配置", "运行 drsai config doctor"]))
    return {
        "code": code,
        **value,
        "localizations": {
            "en": {"title": value["title"], "message": value["message"], "actions": list(value["actions"])},
            "zh": {"title": zh[0], "message": zh[1], "actions": zh[2]},
        },
    }
