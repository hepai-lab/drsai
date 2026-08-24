"""Modular gateway package.

This package is the new home for the DrSai desktop HTTP gateway, gradually
extracted from the legacy monolithic ``gateway.py`` (now ``gateway_legacy.py``).

Phase 0 scaffolding: the package re-executes the legacy monolith's source
**into this module's own namespace**, so every function, class, and singleton
defined there lives in ``drsai.backend.gateway`` with ``gateway.__dict__`` as
its ``__globals__``. This is essential because a large test suite patches the
gateway in place::

    monkeypatch.setattr(gateway, "commit_model_config_update", fake)
    gateway.put_model_provider_config(...)   # resolves the *patched* global

A plain ``from gateway_legacy import *`` would NOT preserve this: imported
functions keep ``gateway_legacy.__dict__`` as their globals, so patching
``gateway`` would be invisible to them. Executing the source text into our
namespace makes ``gateway`` and the legacy definitions share one ``__dict__``,
preserving in-place patching with zero behavioural change.

Subsequent phases move route groups and core classes out of ``gateway_legacy``
into dedicated modules here (``_state``, ``_models``, ``_agent_manager``,
``_agent_backend``, ``routes/*``); each migration replaces a chunk of the
legacy source with a real import.
"""

from __future__ import annotations

import pathlib

# The legacy monolith lives one directory up, as ``gateway_legacy.py``.
_LEGACY_SOURCE_PATH = (
    pathlib.Path(__file__).resolve().parent.parent / "gateway_legacy.py"
)

# Re-execute the legacy source inside THIS module's namespace so that every
# defined name is owned by ``drsai.backend.gateway`` (same globals dict), which
# keeps in-place ``monkeypatch.setattr(gateway, ...)`` semantics identical to
# the original single-file module. ``__name__`` is already
# ``drsai.backend.gateway``; the compiled source therefore sees itself as
# ``gateway``, so its own ``if __name__ == "__main__"`` guards and relative
# ``__file__``-based logic behave as in the original file.
_source = _LEGACY_SOURCE_PATH.read_text(encoding="utf-8")
exec(compile(_source, str(_LEGACY_SOURCE_PATH), "exec"), globals())

# Dependency-direction contract for the eventual split. These submodule imports
# are present so the package layout is wired as soon as route modules are added;
# in Phase 0 they are thin re-exports of the legacy namespace.
from . import _state  # noqa: F401,E402
from . import _models  # noqa: F401,E402
from . import _agent_manager  # noqa: F401,E402
from . import _agent_backend  # noqa: F401,E402
from . import _app  # noqa: F401,E402
from . import routes  # noqa: F401,E402

# Mount routers extracted from the legacy monolith. ``app`` was created by the
# legacy source executed above, so it already exists in this namespace.
_app.mount_routers(app)

__all__ = [n for n in list(globals()) if not n.startswith("_") and n != "annotations"]
