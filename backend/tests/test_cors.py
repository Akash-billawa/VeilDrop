"""CORS configuration hardening: no wildcard with credentials, no accidental default."""

from __future__ import annotations

import pytest
from app.config import Settings, _parse_origins, get_settings


class TestParseOrigins:
    def test_empty_means_no_origins(self) -> None:
        assert _parse_origins("") == []
        assert _parse_origins("   ") == []
        assert _parse_origins(",,") == []

    def test_strips_and_splits(self) -> None:
        assert _parse_origins("https://a.example, https://b.example") == [
            "https://a.example",
            "https://b.example",
        ]


class TestCorsDefaults:
    def test_default_is_closed_not_wildcard(self, monkeypatch) -> None:
        monkeypatch.delenv("VEILDROP_CORS_ORIGINS", raising=False)
        assert Settings().cors_origins == []

    def test_wildcard_refuses_to_start(self, monkeypatch) -> None:
        monkeypatch.setenv("VEILDROP_CORS_ORIGINS", "*")
        monkeypatch.setenv("VEILDROP_SESSION_SECRET", "test-secret-not-for-production")
        get_settings.cache_clear()
        try:
            with pytest.raises(RuntimeError, match="must not be '\\*'"):
                get_settings()
        finally:
            get_settings.cache_clear()

    def test_wildcard_among_valid_origins_still_refuses(self, monkeypatch) -> None:
        monkeypatch.setenv("VEILDROP_CORS_ORIGINS", "https://ok.example,*")
        monkeypatch.setenv("VEILDROP_SESSION_SECRET", "test-secret-not-for-production")
        get_settings.cache_clear()
        try:
            with pytest.raises(RuntimeError, match="must not be '\\*'"):
                get_settings()
        finally:
            get_settings.cache_clear()

    def test_exact_origins_accepted(self, monkeypatch) -> None:
        monkeypatch.setenv("VEILDROP_CORS_ORIGINS", "https://veildrop.example")
        monkeypatch.setenv("VEILDROP_SESSION_SECRET", "test-secret-not-for-production")
        get_settings.cache_clear()
        try:
            assert get_settings().cors_origins == ["https://veildrop.example"]
        finally:
            get_settings.cache_clear()

    def test_missing_session_secret_refuses(self, monkeypatch) -> None:
        monkeypatch.setenv("VEILDROP_SESSION_SECRET", "")
        get_settings.cache_clear()
        try:
            with pytest.raises(RuntimeError, match="SESSION_SECRET"):
                get_settings()
        finally:
            get_settings.cache_clear()
