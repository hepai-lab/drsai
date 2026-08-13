# api/config.py

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URI: str = "sqlite:///./drsai_ui.db"
    # API_DOCS: bool = False
    API_DOCS: bool = True
    CLEANUP_INTERVAL: int = 300  # 5 minutes
    SESSION_TIMEOUT: int = 3600 * 24  # 24 hour
    CONFIG_DIR: str = "configs"  # Default config directory relative to app_root
    DEFAULT_USER_ID: str = "guestuser@gmail.com"
    UPGRADE_DATABASE: bool = False
    DEFAULT_ADMIN_USER: str = "admin"
    DEFAULT_ADMIN_PASSWORD: str = "DrSai@Admin2024!"
    DEFAULT_DEV_USER: str = "dev"
    DEFAULT_DEV_PASSWORD: str = "DrSai@Dev2024!"
    # Optional relocation of the single built-in skills root. If unset, the
    # server walks up from the package to find skills/skills.
    AGENT_SKILLS_CATALOG_DIR: str | None = None

    # ── Skills GFS (unified — public + user share one bucket) ─────────────────
    # Single bucket 20294-skills-square with two folder prefixes:
    #   public_skills/{slug}.zip   and   user_skills/{user_id}/{source}/{slug}.zip
    GFS_SKILLS_AK: str = ""
    GFS_SKILLS_SK: str = ""
    GFS_SKILLS_BUCKET: str = "20294-skills-square"
    GFS_SKILLS_ENDPOINT: str = "https://fgws3-gfs.ihep.ac.cn"

    # URL for the API key → user_id verification service.
    API_KEY_VERIFY_URL: str = "https://aiapi.ihep.ac.cn/apiv2/user"

    model_config = {"env_prefix": "DRSAI_UI_"}

# TODO: 通过.env设置Settings
settings = Settings()
