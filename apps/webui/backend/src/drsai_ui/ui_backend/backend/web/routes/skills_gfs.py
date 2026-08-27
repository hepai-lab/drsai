"""Legacy skills_gfs router — redirects to the unified skills_gfs/ package."""

from .skills_gfs._constants import router  # noqa: F401

# Re-export for backwards compatibility
from .skills_gfs._constants import _SLUG_RE, _MAX_UPLOAD_BYTES, _MAX_PROFILE_BYTES, _PROFILE_EXT_WHITELIST, SkillType  # noqa: F401
from .skills_gfs._auth import _get_db, _require_user_id, _resolve_user_from_apikey  # noqa: F401
from .skills_gfs._gfs import _gfs_zip_path, _require_gfs  # noqa: F401