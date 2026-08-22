"""Unified skills router — public + user skills in one bucket, one CRUD surface.

Bucket layout:
  20294-skills-square/
  ├── public_skills/{slug}.zip, {slug}/meta.json, {slug}/profile.{ext}
  └── user_skills/{user_id}/{source}/{slug}.zip, {slug}/meta.json

Every route requires ?type=public or ?type=user.  The type parameter drives
GFS prefix, DB model, auth, and response format — one handler for both.
"""

from ._constants import router, _SLUG_RE, _MAX_UPLOAD_BYTES, _MAX_PROFILE_BYTES, _PROFILE_EXT_WHITELIST, SkillType, logger
from ._auth import _get_db, _require_user_id, _resolve_user_from_apikey
from ._gfs import _gfs_zip_path, _require_gfs

# Import route modules to register their endpoints on the shared router
from . import _list       # noqa: E402, F401
from . import _get        # noqa: E402, F401
from . import _upload     # noqa: E402, F401
from . import _update     # noqa: E402, F401
from . import _delete     # noqa: E402, F401
from . import _toggle     # noqa: E402, F401
from . import _download   # noqa: E402, F401