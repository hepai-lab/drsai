"""Constants and shared router for skills_gfs package."""

from __future__ import annotations

import logging
import re
from typing import Literal

from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter()

_SLUG_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
_MAX_UPLOAD_BYTES = 32 * 1024 * 1024
_MAX_PROFILE_BYTES = 2 * 1024 * 1024
_PROFILE_EXT_WHITELIST = frozenset({".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"})

SkillType = Literal["public", "user"]