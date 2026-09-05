"""OIDC authentication + token storage for TUI gateway.

Provides Device Code Flow login and encrypted token persistence so the TUI
can authenticate against the HAI OIDC provider and use the resulting
access_token for model access via :mod:`drsai.platform_auth`.
"""

from .oidc_client import OidcClient
from .token_store import (
    load_auth_session,
    save_auth_session,
    clear_auth_session,
    is_token_expired,
)

__all__ = [
    "OidcClient",
    "load_auth_session",
    "save_auth_session",
    "clear_auth_session",
    "is_token_expired",
]
