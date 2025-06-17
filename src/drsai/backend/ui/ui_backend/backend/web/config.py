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

    model_config = {"env_prefix": "DRSAI_UI_"}


settings = Settings()
