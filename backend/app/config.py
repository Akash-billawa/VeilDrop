from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

# Load .env from the backend directory (one level up from this file)
_env_path = Path(__file__).parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: os.getenv("VEILDROP_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("VEILDROP_PORT", "8000")))
    database_url: str = field(
        default_factory=lambda: os.getenv(
            "VEILDROP_DATABASE_URL",
            "postgresql://veildrop:veildrop@localhost:5432/veildrop",
        )
    )
    database_max_connections: int = field(default_factory=lambda: int(os.getenv("VEILDROP_DB_MAX_CONN", "10")))
    log_level: str = field(default_factory=lambda: os.getenv("VEILDROP_LOG_LEVEL", "INFO"))
    log_format: str = field(default_factory=lambda: os.getenv("VEILDROP_LOG_FORMAT", "text"))
    # /metrics is disabled unless a token is set: an open metrics endpoint leaks
    # route inventory and traffic volume. Set VEILDROP_METRICS_TOKEN and have the
    # scraper send it as `Authorization: Bearer <token>`.
    metrics_token: str = field(default_factory=lambda: os.getenv("VEILDROP_METRICS_TOKEN", ""))

    session_secret: str = field(default_factory=lambda: os.getenv("VEILDROP_SESSION_SECRET", ""))
    session_expire_minutes: int = field(default_factory=lambda: int(os.getenv("VEILDROP_SESSION_EXPIRE_MIN", "480")))
    session_idle_minutes: int = field(default_factory=lambda: int(os.getenv("VEILDROP_SESSION_IDLE_MIN", "30")))

    default_case_ttl_days: int = field(default_factory=lambda: int(os.getenv("VEILDROP_DEFAULT_TTL_DAYS", "30")))
    max_case_ttl_days: int = field(default_factory=lambda: int(os.getenv("VEILDROP_MAX_TTL_DAYS", "90")))
    max_upload_size: int = field(default_factory=lambda: int(os.getenv("VEILDROP_MAX_UPLOAD_SIZE", "104857600")))
    max_files_per_case: int = field(default_factory=lambda: int(os.getenv("VEILDROP_MAX_FILES_PER_CASE", "20")))

    rate_limit_case_per_min: int = field(default_factory=lambda: int(os.getenv("VEILDROP_RATE_CASE", "5")))
    rate_limit_auth_per_min: int = field(default_factory=lambda: int(os.getenv("VEILDROP_RATE_AUTH", "10")))

    upload_dir: str = field(default_factory=lambda: os.getenv("VEILDROP_UPLOAD_DIR", "data/uploads"))

    crypto_active_version: int = field(default_factory=lambda: int(os.getenv("VEILDROP_CRYPTO_VERSION", "1")))
    argon2_time_cost: int = field(default_factory=lambda: int(os.getenv("VEILDROP_ARGON2_TIME", "3")))
    argon2_memory_cost: int = field(default_factory=lambda: int(os.getenv("VEILDROP_ARGON2_MEMORY", "65536")))
    argon2_parallelism: int = field(default_factory=lambda: int(os.getenv("VEILDROP_ARGON2_PARALLEL", "4")))

    # The SPA is served same-origin by this app, so no cross-origin allowance is
    # needed by default. Empty means "no cross-origin requests permitted".
    # Wildcard is rejected outright in get_settings(): the API is authenticated
    # with credentials, and `*` + credentials lets any site drive it.
    cors_origins: list[str] = field(default_factory=lambda: _parse_origins(os.getenv("VEILDROP_CORS_ORIGINS", "")))


def _parse_origins(raw: str) -> list[str]:
    return [o.strip() for o in raw.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.session_secret:
        raise RuntimeError("VEILDROP_SESSION_SECRET must be set in production")
    if "*" in s.cors_origins:
        raise RuntimeError(
            "VEILDROP_CORS_ORIGINS must not be '*': this API is credentialed, "
            "so a wildcard origin would let any website issue authenticated "
            "requests on a logged-in investigator's behalf. List exact origins "
            "(e.g. https://veildrop.example), or leave it empty — the SPA is "
            "served same-origin and needs no CORS allowance."
        )
    return s
