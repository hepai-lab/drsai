"""Shared admin / org role checks for API routes."""

from __future__ import annotations

import os
from typing import Optional

from ..datamodel.db import OrganizationMember, UserRole
from ..database import DatabaseManager


def is_test_all_admin_mode() -> bool:
    """
    Testing convenience:
    - In non-PROD environments, treat all users as admin by default.
    - Override via DEFAULT_ALL_ADMIN=true|false.
    """
    v = os.getenv("DEFAULT_ALL_ADMIN")
    if v is not None:
        return v.lower() == "true"
    return os.getenv("SERVICE_MODE", "DEV") != "PROD"


def get_is_platform_admin(db: DatabaseManager, user_id: str) -> bool:
    if not user_id:
        return False
    if is_test_all_admin_mode():
        return True
    role_resp = db.get(UserRole, filters={"user_id": user_id}, return_json=False)
    if role_resp.status and role_resp.data:
        role: UserRole = role_resp.data[0]
        return bool(role.is_admin)
    return False


def get_org_membership(db: DatabaseManager, user_id: str) -> Optional[OrganizationMember]:
    if not user_id:
        return None
    resp = db.get(OrganizationMember, filters={"user_id": user_id}, return_json=False)
    if resp.status and resp.data:
        return resp.data[0]
    return None


def is_org_admin(db: DatabaseManager, user_id: str, org_id: int) -> bool:
    m = get_org_membership(db, user_id)
    if not m or m.org_id != org_id:
        return False
    return str(m.role) == "org_admin"
