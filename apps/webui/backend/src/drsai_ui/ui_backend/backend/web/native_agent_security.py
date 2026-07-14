"""Execution-target policy for server-held remote agent configuration."""
from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from typing import Any
from urllib.parse import urlparse


URL_KEYS = {"url", "base_url", "ragflow_url", "endpoint", "sse_url"}
BLOCKED_SUFFIXES = (".local", ".localhost", ".internal", ".invalid", ".test")


def validate_agent_execution_targets(agent: dict[str, Any]) -> set[str]:
    mode = str(agent.get("mode") or "").lower()
    hosts: set[str] = set()
    for url in _collect_urls(agent):
        hosts.add(validate_public_https_url(url, mode=mode))
    return hosts


async def resolve_and_validate_agent_execution_targets(agent: dict[str, Any]) -> set[str]:
    hosts = validate_agent_execution_targets(agent)
    for host in hosts:
        try:
            addresses = await asyncio.wait_for(_resolve_host(host), timeout=3)
        except (asyncio.TimeoutError, OSError) as error:
            raise ValueError("Remote agent target DNS resolution failed") from error
        if not addresses:
            raise ValueError("Remote agent target DNS resolution returned no addresses")
        for raw_address in addresses:
            address = ipaddress.ip_address(raw_address)
            if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast:
                raise ValueError("Remote agent target DNS resolved to a non-public address")
    return hosts


async def _resolve_host(host: str) -> set[str]:
    loop = asyncio.get_running_loop()
    results = await loop.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    return {str(item[4][0]) for item in results}


def validate_public_https_url(url: str, *, mode: str = "remote") -> str:
    parsed = urlparse(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("Remote agent targets must use HTTPS")
    if parsed.username or parsed.password:
        raise ValueError("Remote agent target URLs must not contain credentials")
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(BLOCKED_SUFFIXES) or "." not in host:
        raise ValueError("Remote agent target host is not allowed")
    try:
        address = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        address = None
    if address and (address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast):
        raise ValueError("Remote agent target address is not public")
    allowlist = {
        item.strip().lower()
        for item in os.getenv("OPENDRSAI_NATIVE_REMOTE_HOST_ALLOWLIST", "").split(",")
        if item.strip()
    }
    if mode == "ddf":
        allowlist.update({"aiapi.ihep.ac.cn", "ai-dev.ihep.ac.cn", "ai.ihep.ac.cn"})
    if allowlist and not any(host == allowed or host.endswith(f".{allowed}") for allowed in allowlist):
        raise ValueError("Remote agent target host is outside the allowlist")
    return host


def _collect_urls(value: Any, key: str = "") -> list[str]:
    if isinstance(value, dict):
        urls: list[str] = []
        for child_key, child in value.items():
            urls.extend(_collect_urls(child, str(child_key).lower()))
        return urls
    if isinstance(value, list):
        return [url for child in value for url in _collect_urls(child, key)]
    if isinstance(value, str) and (key in URL_KEYS or key.endswith("_url")) and value.strip():
        return [value.strip()]
    return []
