"""Shared gateway state (singletons + lazy accessors + auth/workspace helpers).

Phase 0-1: the real singletons and accessors still live in the legacy monolith
(``gateway_legacy.py``), re-executed into the ``gateway`` package namespace by
``gateway/__init__.py``. Route modules access them through the package, e.g.::

    from drsai.backend import gateway
    ... gateway._runtime_engine() ...

As Phase 2+ moves accessors here, route modules will switch to
``from .._state import _runtime_engine``.
"""

from __future__ import annotations
