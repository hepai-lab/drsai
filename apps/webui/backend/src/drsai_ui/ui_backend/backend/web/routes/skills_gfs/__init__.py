"""__init__.py — Unified skills router using the new SkillMeta + SkillDetail models."""

from ._constants import router, _SLUG_RE, _MAX_UPLOAD_BYTES, _MAX_PROFILE_BYTES, _PROFILE_EXT_WHITELIST, SkillType, logger
from ._auth import _get_db, _require_user_id, _resolve_user_from_apikey, _skillmeta_to_dict, _skilldetail_to_dict
from ._gfs import _gfs_zip_path, _require_gfs, _gfs_user_zip_path

# Import route modules to register their endpoints on the shared router
from . import _list       # noqa: E402, F401
from . import _get        # noqa: E402, F401
from . import _upload     # noqa: E402, F401
from . import _update     # noqa: E402, F401
from . import _delete     # noqa: E402, F401
from . import _toggle     # noqa: E402, F401
from . import _download   # noqa: E402, F401