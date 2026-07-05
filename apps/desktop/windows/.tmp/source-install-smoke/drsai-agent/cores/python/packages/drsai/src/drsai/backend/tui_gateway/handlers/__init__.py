"""RPC handlers package — split by domain to keep server.py thin.

Each submodule registers ``@method("name")`` decorators against the global
:data:`server._methods` registry. Importing this package (or any submodule)
triggers registration as a side effect.
"""

# Importing each handler module registers its @method decorators.
# Order matters: handlers import from server.py, so server must be imported
# (which is done at gateway startup before this package is imported).

from . import session  # noqa: F401
from . import prompt  # noqa: F401
from . import tools  # noqa: F401
from . import slash  # noqa: F401
from . import setup  # noqa: F401
from . import paste  # noqa: F401
from . import skills  # noqa: F401
from . import scheduler  # noqa: F401
from . import wechat  # noqa: F401
from . import daemon  # noqa: F401 — daemon RPC handlers
