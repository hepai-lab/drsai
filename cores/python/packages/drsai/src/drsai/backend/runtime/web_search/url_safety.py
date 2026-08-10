"""SSRF-resistant URL admission for the P1 browser search tool."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from collections.abc import Callable
from urllib.parse import urlsplit


_BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.aws.internal",
}


class UnsafeWebUrl(ValueError):
    """Raised when a URL can reach a non-public network target."""


def _is_public_address(value: str) -> bool:
    address = ipaddress.ip_address(value.split("%", 1)[0])
    return bool(address.is_global)


def validate_url_shape(url: str) -> tuple[str, int]:
    if not isinstance(url, str) or len(url) > 4096:
        raise UnsafeWebUrl("web_search_url_invalid")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeWebUrl("web_search_url_scheme_denied")
    if parsed.username is not None or parsed.password is not None:
        raise UnsafeWebUrl("web_search_url_credentials_denied")
    host = parsed.hostname.rstrip(".").casefold()
    if host in _BLOCKED_HOSTS or host.endswith(".localhost"):
        raise UnsafeWebUrl("web_search_url_private_denied")
    try:
        literal_address = ipaddress.ip_address(host.split("%", 1)[0])
    except ValueError:
        literal_address = None
    if literal_address is not None and not literal_address.is_global:
        raise UnsafeWebUrl("web_search_url_private_denied")
    try:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise UnsafeWebUrl("web_search_url_port_invalid") from exc
    return host, port


async def ensure_public_url(
    url: str,
    *,
    resolver: Callable[..., list[tuple]] = socket.getaddrinfo,
) -> str:
    host, port = validate_url_shape(url)
    try:
        addresses = await asyncio.to_thread(resolver, host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UnsafeWebUrl("web_search_url_dns_failed") from exc
    if not addresses:
        raise UnsafeWebUrl("web_search_url_dns_failed")
    for entry in addresses:
        sockaddr = entry[4]
        if not sockaddr or not _is_public_address(str(sockaddr[0])):
            raise UnsafeWebUrl("web_search_url_private_denied")
    return url
