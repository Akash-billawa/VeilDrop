from __future__ import annotations

import base64
import hashlib
import pathlib
import re

import pytest

FRONTEND_DIR = pathlib.Path(__file__).resolve().parents[2] / "frontend"
INDEX_HTML = FRONTEND_DIR / "index.html"

_TAG_RE = re.compile(r"<(link|script)\b(?P<tag>[^>]*)>")
_ATTR_RE = re.compile(r'\b(?P<name>href|src|integrity|crossorigin)="(?P<value>[^"]*)"')


def _sha384_b64(data: bytes) -> str:
    return base64.b64encode(hashlib.sha384(data).digest()).decode("ascii")


def _assets() -> dict[str, dict]:
    if not INDEX_HTML.exists():
        pytest.skip("frontend/index.html not found")
    html = INDEX_HTML.read_text(encoding="utf-8")
    assets: dict[str, dict] = {}
    for tag_match in _TAG_RE.finditer(html):
        attrs = dict(_ATTR_RE.findall(tag_match.group("tag")))
        path = attrs.get("href") or attrs.get("src")
        if not path:
            continue
        if not (path.startswith("css/") or path.startswith("js/")):
            continue
        assets[path.split("?")[0]] = {
            "integrity": attrs.get("integrity"),
            "crossorigin": attrs.get("crossorigin"),
        }
    return assets


class TestSRI:
    """Every self-hosted stylesheet and script must carry a matching SRI hash."""

    def test_all_local_assets_have_sri(self):
        assets = _assets()
        assert assets, "no self-hosted css/js assets found in index.html"
        missing = [p for p, a in assets.items() if not a["integrity"]]
        assert not missing, f"assets missing SRI integrity: {missing}"

    def test_all_local_assets_have_crossorigin(self):
        assets = _assets()
        missing = [p for p, a in assets.items() if a["crossorigin"] != "anonymous"]
        assert not missing, f"assets missing crossorigin=anonymous: {missing}"

    def test_hashes_match_file_content(self):
        for path, attrs in _assets().items():
            fpath = FRONTEND_DIR / path
            assert fpath.is_file(), f"referenced asset does not exist: {path}"
            expected = "sha384-" + _sha384_b64(fpath.read_bytes())
            assert attrs["integrity"] == expected, f"SRI hash mismatch for {path}"

    def test_all_assets_actually_referenced(self):
        """Every css/js file in frontend/ must be referenced from index.html."""
        referenced = set(_assets())
        on_disk = {
            p.relative_to(FRONTEND_DIR).as_posix() for p in FRONTEND_DIR.rglob("*") if p.suffix in (".css", ".js")
        }
        unreferenced = on_disk - referenced
        assert not unreferenced, f"assets not referenced in index.html: {sorted(unreferenced)}"
